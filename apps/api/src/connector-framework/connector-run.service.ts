import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConnectorExecutionService } from '../connector-execution/connector-execution.service';
import { createAtlasJobEnvelope } from '../connector-execution/connector-execution-envelope';
import { ConnectorRunTrigger, type ConnectorRun } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { connectorQueueName, ConnectorDefinitionRegistry } from './connector-definition.registry';
import { ConnectorFrameworkError } from './connector-framework.errors';
import type { ConnectorRunJobPayload, CreateConnectorRunInput } from './connector-framework.types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_IDENTITY_PATTERN = /^[\x20-\x7e]{1,200}$/;
const ACTOR_ID_PATTERN = /^[\x21-\x7e]{1,255}$/;

export interface CreateConnectorRunResult {
  readonly run: ConnectorRun;
  readonly replayed: boolean;
}

@Injectable()
export class ConnectorRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: ConnectorExecutionService,
    private readonly definitions: ConnectorDefinitionRegistry,
  ) {}

  async create(input: CreateConnectorRunInput): Promise<CreateConnectorRunResult> {
    const normalized = normalizeRequest(input);
    const requestFingerprint = fingerprintRequest(normalized);
    const replay = await this.prisma.connectorRun.findUnique({
      where: { requestFingerprint },
    });
    if (replay) return { run: assertReplay(replay, normalized), replayed: true };

    const instance = await this.prisma.connectorInstance.findUnique({
      where: { id: normalized.connectorInstanceId },
      select: {
        id: true,
        enabled: true,
        connectorType: true,
        configurationVersion: true,
        configuration: true,
      },
    });
    if (!instance) throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_NOT_FOUND');
    if (!instance.enabled) throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_DISABLED');

    const definition = this.definitions.get(instance.connectorType);
    if (instance.configurationVersion !== definition.configurationSchemaVersion) {
      throw new ConnectorFrameworkError('CONNECTOR_CONFIG_VERSION_UNSUPPORTED');
    }
    try {
      definition.validateConfig(instance.configuration);
    } catch {
      throw new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
    }

    const runId = randomUUID();
    const payload: ConnectorRunJobPayload = Object.freeze({
      schemaVersion: 1,
      connectorInstanceId: instance.id,
    });

    try {
      const run = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.connectorRun.create({
          data: {
            id: runId,
            connectorInstanceId: instance.id,
            trigger: normalized.trigger,
            triggerActorType: normalized.triggerActor.kind,
            triggerActorId: normalized.triggerActor.id,
            requestFingerprint,
            ...(normalized.scheduledFor === undefined
              ? {}
              : { scheduledFor: normalized.scheduledFor }),
          },
        });
        await this.execution.enqueueWithinTransaction(
          transaction,
          connectorQueueName(instance.connectorType),
          createAtlasJobEnvelope({
            runId,
            payload,
            idempotencyKey: requestFingerprint,
            ...(normalized.correlationId === undefined
              ? {}
              : { correlationId: normalized.correlationId }),
            maxBytes: this.execution.config.payloadMaxBytes,
          }),
          { singletonKey: runId },
        );
        return created;
      });
      return { run, replayed: false };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.connectorRun.findUnique({
        where: { requestFingerprint },
      });
      if (!existing) throw error;
      return { run: assertReplay(existing, normalized), replayed: true };
    }
  }
}

type NormalizedRunRequest = Readonly<{
  connectorInstanceId: string;
  trigger: ConnectorRunTrigger;
  triggerActor: Readonly<{ kind: 'HUMAN' | 'SERVICE' | 'SYSTEM'; id: string }>;
  requestIdentity: string;
  scheduledFor?: Date;
  correlationId?: string;
}>;

function normalizeRequest(input: CreateConnectorRunInput): NormalizedRunRequest {
  const actorId = input.triggerActor.id.trim();
  const requestIdentity = input.requestIdentity.trim();
  if (input.scheduledFor !== undefined && !(input.scheduledFor instanceof Date)) {
    throw new ConnectorFrameworkError('CONNECTOR_RUN_REQUEST_INVALID');
  }
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor.getTime()) : undefined;
  const requestedActor =
    input.triggerActor.kind === 'HUMAN' || input.triggerActor.kind === 'SERVICE';
  const systemActor = input.triggerActor.kind === 'SYSTEM' && actorId.startsWith('system:atlas:');
  const actorMatchesTrigger =
    (input.trigger === ConnectorRunTrigger.REQUESTED && requestedActor) ||
    (input.trigger !== ConnectorRunTrigger.REQUESTED && systemActor);
  const scheduleMatchesTrigger =
    (input.trigger === ConnectorRunTrigger.SCHEDULE && scheduledFor !== undefined) ||
    (input.trigger !== ConnectorRunTrigger.SCHEDULE && scheduledFor === undefined);

  if (
    !UUID_V4_PATTERN.test(input.connectorInstanceId) ||
    !Object.values(ConnectorRunTrigger).includes(input.trigger) ||
    !ACTOR_ID_PATTERN.test(actorId) ||
    !REQUEST_IDENTITY_PATTERN.test(requestIdentity) ||
    !actorMatchesTrigger ||
    !scheduleMatchesTrigger ||
    (scheduledFor !== undefined && Number.isNaN(scheduledFor.getTime())) ||
    (input.correlationId !== undefined && !UUID_V4_PATTERN.test(input.correlationId))
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_RUN_REQUEST_INVALID');
  }

  return Object.freeze({
    connectorInstanceId: input.connectorInstanceId.toLowerCase(),
    trigger: input.trigger,
    triggerActor: Object.freeze({ kind: input.triggerActor.kind, id: actorId }),
    requestIdentity,
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId.toLowerCase() }),
  });
}

function fingerprintRequest(input: NormalizedRunRequest): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        schemaVersion: 1,
        connectorInstanceId: input.connectorInstanceId,
        trigger: input.trigger,
        triggerActorKind: input.triggerActor.kind,
        triggerActorId: input.triggerActor.id,
        requestIdentity: input.requestIdentity,
        scheduledFor: input.scheduledFor?.toISOString() ?? null,
      }),
    )
    .digest('hex');
}

function assertReplay(run: ConnectorRun, input: NormalizedRunRequest): ConnectorRun {
  if (
    run.connectorInstanceId !== input.connectorInstanceId ||
    run.trigger !== input.trigger ||
    run.triggerActorType !== input.triggerActor.kind ||
    run.triggerActorId !== input.triggerActor.id ||
    (run.scheduledFor?.toISOString() ?? null) !== (input.scheduledFor?.toISOString() ?? null)
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_RUN_REPLAY_INCONSISTENT');
  }
  return run;
}

function canonicalJson(input: Record<string, string | number | null>): string {
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(input[key])}`)
    .join(',')}}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
