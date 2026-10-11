import { Injectable } from '@nestjs/common';

import { auditActorType, type CurrentActor } from '../../auth/auth.types';
import {
  ConnectorRunTrigger,
  Prisma,
  type ConnectorInstance,
  type ConnectorRun,
  type ConnectorSecretReference,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSecretReference } from '../../secrets/secret-reference.types';
import { ConnectorDefinitionRegistry } from '../connector-definition.registry';
import { ConnectorFrameworkError } from '../connector-framework.errors';
import { ConnectorRunService } from '../connector-run.service';
import type { ConnectorDefinition } from '../connector-framework.types';
import {
  connectorConfigurationFingerprint,
  parseConnectorConfiguration,
  type SafeConnectorConfiguration,
} from './connector-configuration';
import type { CreateConnectorInstanceDto } from './dto/create-connector-instance.dto';
import type { DeleteConnectorSecretReferenceDto } from './dto/delete-connector-secret-reference.dto';
import type { SetConnectorSecretReferenceDto } from './dto/set-connector-secret-reference.dto';
import type { UpdateConnectorInstanceDto } from './dto/update-connector-instance.dto';

type InstanceWithReferences = ConnectorInstance & {
  secretReferences: ConnectorSecretReference[];
};

type RunWithInstance = ConnectorRun & {
  connectorInstance: Pick<ConnectorInstance, 'id' | 'name' | 'connectorType'>;
};

@Injectable()
export class ConnectorManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly definitions: ConnectorDefinitionRegistry,
    private readonly runs: ConnectorRunService,
  ) {}

  listDefinitions() {
    return this.definitions.list().map((definition) => ({
      connectorType: definition.connectorType,
      configurationSchemaVersion: definition.configurationSchemaVersion,
      capabilities: [...definition.capabilities],
      supportedObservationTypes: [...definition.supportedObservationTypes],
      requiredSecretSlots: [...definition.requiredSecretSlots],
    }));
  }

  async listInstances() {
    const instances = await this.prisma.connectorInstance.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: { secretReferences: { orderBy: { slot: 'asc' } } },
    });
    return instances.map((instance) => this.presentInstance(instance));
  }

  async createInstance(dto: CreateConnectorInstanceDto, actor: CurrentActor) {
    const definition = this.definitions.get(dto.connectorType);
    const name = validateName(dto.name);
    const configuration = validateForDefinition(definition, dto.configuration);
    const fingerprint = connectorConfigurationFingerprint(configuration);

    const created = await this.prisma.$transaction(async (transaction) => {
      const instance = await transaction.connectorInstance.create({
        data: {
          connectorType: definition.connectorType,
          name,
          configuration,
          configurationVersion: definition.configurationSchemaVersion,
        },
        include: { secretReferences: true },
      });
      await transaction.auditLog.create({
        data: {
          actorType: auditActorType(actor),
          actorId: actor.id,
          action: 'CONNECTOR_INSTANCE_CREATED',
          entityType: 'ConnectorInstance',
          entityId: instance.id,
          after: {
            connectorType: instance.connectorType,
            name: instance.name,
            enabled: false,
            configurationVersion: instance.configurationVersion,
            instanceVersion: instance.version,
            configurationFingerprint: fingerprint,
          },
        },
      });
      return instance;
    });
    return this.presentInstance(created);
  }

  async getInstance(id: string) {
    const instance = await this.prisma.connectorInstance.findUnique({
      where: { id },
      include: { secretReferences: { orderBy: { slot: 'asc' } } },
    });
    if (!instance) throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_NOT_FOUND');
    return this.presentInstance(instance);
  }

  async updateInstance(id: string, dto: UpdateConnectorInstanceDto, actor: CurrentActor) {
    if (dto.name === undefined && dto.configuration === undefined && dto.enabled === undefined) {
      throw new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const current = await lockInstance(transaction, id);
      assertExpectedVersion(current.version, dto.expectedVersion);

      const name = dto.name === undefined ? current.name : validateName(dto.name);
      let configuration = parseConnectorConfiguration(current.configuration);
      let definition: ConnectorDefinition | undefined;
      if (dto.configuration !== undefined || dto.enabled === true) {
        definition = this.definitions.get(current.connectorType);
      }
      if (dto.configuration !== undefined) {
        if (current.configurationVersion !== definition!.configurationSchemaVersion) {
          throw new ConnectorFrameworkError('CONNECTOR_CONFIG_VERSION_UNSUPPORTED');
        }
        configuration = validateForDefinition(definition!, dto.configuration);
      }
      const enabled = dto.enabled ?? current.enabled;
      if (dto.enabled === true) {
        validateEnable(current, definition!, configuration);
      }

      const previousFingerprint = connectorConfigurationFingerprint(
        parseConnectorConfiguration(current.configuration),
      );
      const nextFingerprint = connectorConfigurationFingerprint(configuration);
      const changedFields = [
        ...(dto.name === undefined || name === current.name ? [] : ['name']),
        ...(dto.configuration === undefined || nextFingerprint === previousFingerprint
          ? []
          : ['configuration']),
        ...(dto.enabled === undefined || enabled === current.enabled ? [] : ['enabled']),
      ];
      if (changedFields.length === 0) {
        throw new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
      }
      const action =
        changedFields.length === 1 && changedFields[0] === 'enabled'
          ? enabled
            ? 'CONNECTOR_INSTANCE_ENABLED'
            : 'CONNECTOR_INSTANCE_DISABLED'
          : 'CONNECTOR_INSTANCE_UPDATED';
      const versionAfter = current.version + 1;
      const instance = await transaction.connectorInstance.update({
        where: { id },
        data: {
          name,
          enabled,
          ...(dto.configuration === undefined ? {} : { configuration }),
          version: versionAfter,
        },
        include: { secretReferences: { orderBy: { slot: 'asc' } } },
      });
      await transaction.auditLog.create({
        data: {
          actorType: auditActorType(actor),
          actorId: actor.id,
          action,
          entityType: 'ConnectorInstance',
          entityId: id,
          before: {
            enabled: current.enabled,
            name: current.name,
            version: current.version,
            configurationFingerprint: previousFingerprint,
          },
          after: {
            enabled: instance.enabled,
            name: instance.name,
            version: versionAfter,
            configurationFingerprint: nextFingerprint,
          },
          metadata: { changedFields, versionBefore: current.version, versionAfter },
        },
      });
      return instance;
    });
    return this.presentInstance(updated);
  }

  async setSecretReference(
    id: string,
    slot: string,
    dto: SetConnectorSecretReferenceDto,
    actor: CurrentActor,
  ) {
    const reference = parseSecretReference({
      providerKind: dto.providerKind,
      logicalKey: dto.logicalKey,
    });
    const updated = await this.prisma.$transaction(async (transaction) => {
      const current = await lockInstance(transaction, id);
      assertExpectedVersion(current.version, dto.expectedVersion);
      const definition = this.definitions.get(current.connectorType);
      assertDeclaredSlot(definition, slot);
      const existing = current.secretReferences.find((item) => item.slot === slot);
      await transaction.connectorSecretReference.upsert({
        where: { connectorInstanceId_slot: { connectorInstanceId: id, slot } },
        create: { connectorInstanceId: id, slot, ...reference },
        update: reference,
      });
      const versionAfter = current.version + 1;
      const instance = await transaction.connectorInstance.update({
        where: { id },
        data: { version: versionAfter },
        include: { secretReferences: { orderBy: { slot: 'asc' } } },
      });
      await transaction.auditLog.create({
        data: {
          actorType: auditActorType(actor),
          actorId: actor.id,
          action: 'CONNECTOR_SECRET_REFERENCE_SET',
          entityType: 'ConnectorInstance',
          entityId: id,
          metadata: {
            slot,
            configuredBefore: existing !== undefined,
            configuredAfter: true,
            versionBefore: current.version,
            versionAfter,
          },
        },
      });
      return instance;
    });
    return this.presentInstance(updated);
  }

  async removeSecretReference(
    id: string,
    slot: string,
    dto: DeleteConnectorSecretReferenceDto,
    actor: CurrentActor,
  ) {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const current = await lockInstance(transaction, id);
      assertExpectedVersion(current.version, dto.expectedVersion);
      const definition = this.definitions.get(current.connectorType);
      assertDeclaredSlot(definition, slot);
      if (!current.secretReferences.some((item) => item.slot === slot)) {
        throw new ConnectorFrameworkError('CONNECTOR_SECRET_SLOT_MISSING');
      }
      await transaction.connectorSecretReference.delete({
        where: { connectorInstanceId_slot: { connectorInstanceId: id, slot } },
      });
      const autoDisabled = current.enabled && definition.requiredSecretSlots.includes(slot);
      const versionAfter = current.version + 1;
      const instance = await transaction.connectorInstance.update({
        where: { id },
        data: { version: versionAfter, ...(autoDisabled ? { enabled: false } : {}) },
        include: { secretReferences: { orderBy: { slot: 'asc' } } },
      });
      await transaction.auditLog.create({
        data: {
          actorType: auditActorType(actor),
          actorId: actor.id,
          action: 'CONNECTOR_SECRET_REFERENCE_REMOVED',
          entityType: 'ConnectorInstance',
          entityId: id,
          metadata: {
            slot,
            configuredBefore: true,
            configuredAfter: false,
            autoDisabled,
            versionBefore: current.version,
            versionAfter,
          },
        },
      });
      return instance;
    });
    return this.presentInstance(updated);
  }

  async requestRun(id: string, actor: CurrentActor, idempotencyKey: string) {
    if (!/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) {
      throw new ConnectorFrameworkError('CONNECTOR_RUN_REQUEST_INVALID');
    }
    const result = await this.runs.create({
      connectorInstanceId: id,
      trigger: ConnectorRunTrigger.REQUESTED,
      triggerActor: { kind: actor.kind, id: actor.id },
      requestIdentity: idempotencyKey,
    });
    const run = await this.prisma.connectorRun.findUnique({
      where: { id: result.run.id },
      include: { connectorInstance: { select: { id: true, name: true, connectorType: true } } },
    });
    if (!run) throw new ConnectorFrameworkError('CONNECTOR_RUN_NOT_FOUND');
    return { run: presentRun(run), replayed: result.replayed };
  }

  async listRuns() {
    const runs = await this.prisma.connectorRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { connectorInstance: { select: { id: true, name: true, connectorType: true } } },
    });
    return runs.map(presentRun);
  }

  async getRun(id: string) {
    const run = await this.prisma.connectorRun.findUnique({
      where: { id },
      include: { connectorInstance: { select: { id: true, name: true, connectorType: true } } },
    });
    if (!run) throw new ConnectorFrameworkError('CONNECTOR_RUN_NOT_FOUND');
    return presentRun(run);
  }

  private presentInstance(instance: InstanceWithReferences) {
    const configuration = parseConnectorConfiguration(instance.configuration);
    return {
      id: instance.id,
      connectorType: instance.connectorType,
      name: instance.name,
      enabled: instance.enabled,
      configurationVersion: instance.configurationVersion,
      version: instance.version,
      configuration,
      secretSlots: instance.secretReferences
        .map(({ slot }) => ({ slot, configured: true }))
        .sort((left, right) => left.slot.localeCompare(right.slot)),
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    };
  }
}

async function lockInstance(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<InstanceWithReferences> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "connector_instances"
    WHERE "id" = CAST(${id} AS uuid)
    FOR UPDATE
  `);
  if (rows.length === 0) throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_NOT_FOUND');
  const instance = await transaction.connectorInstance.findUnique({
    where: { id },
    include: { secretReferences: { orderBy: { slot: 'asc' } } },
  });
  if (!instance) throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_NOT_FOUND');
  return instance;
}

function assertExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_VERSION_CONFLICT');
  }
}

function validateName(input: string): string {
  const name = input.trim();
  if (name.length < 1 || name.length > 200) {
    throw new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
  }
  return name;
}

function validateForDefinition(
  definition: ConnectorDefinition,
  input: unknown,
): SafeConnectorConfiguration {
  const configuration = parseConnectorConfiguration(input);
  try {
    definition.validateConfig(configuration);
  } catch {
    throw new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
  }
  return configuration;
}

function validateEnable(
  instance: InstanceWithReferences,
  definition: ConnectorDefinition,
  configuration: SafeConnectorConfiguration,
): void {
  if (instance.configurationVersion !== definition.configurationSchemaVersion) {
    throw new ConnectorFrameworkError('CONNECTOR_CONFIG_VERSION_UNSUPPORTED');
  }
  validateForDefinition(definition, configuration);
  const configured = new Set(instance.secretReferences.map(({ slot }) => slot));
  if (definition.requiredSecretSlots.some((slot) => !configured.has(slot))) {
    throw new ConnectorFrameworkError('CONNECTOR_SECRET_SLOT_MISSING');
  }
}

function assertDeclaredSlot(definition: ConnectorDefinition, slot: string): void {
  if (!definition.requiredSecretSlots.includes(slot)) {
    throw new ConnectorFrameworkError('CONNECTOR_SECRET_SLOT_NOT_DECLARED');
  }
}

function presentRun(run: RunWithInstance) {
  return {
    id: run.id,
    connectorInstanceId: run.connectorInstanceId,
    connectorInstance: run.connectorInstance,
    status: run.status,
    trigger: run.trigger,
    triggerActorType: run.triggerActorType,
    triggerActorId: run.triggerActorId,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    observedCount: run.observedCount,
    ingestedCount: run.ingestedCount,
    rejectedCount: run.rejectedCount,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
