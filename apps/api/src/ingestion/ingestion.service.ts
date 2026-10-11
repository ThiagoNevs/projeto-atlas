import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { assetDetailSelect, presentAssetDetail } from '../assets/asset.presenter';
import { auditActorType, type CurrentActor } from '../auth/auth.types';
import {
  AdministrativeStatus,
  AttributeValueType,
  ConflictStatus,
  OperationalStatus,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngestAssetDto } from './dto/ingest-asset.dto';
import type { NormalizedAssetObservation } from './normalized-asset-observation';

const DEFAULT_CONFIDENCE_SCORE = 80;
const LIFECYCLE_CONFLICT_TYPE = 'LIFECYCLE_CONFLICT';
const CLOSED_ADMINISTRATIVE_STATUSES = new Set<AdministrativeStatus>([
  AdministrativeStatus.DEACTIVATED,
  AdministrativeStatus.DISCARDED,
  AdministrativeStatus.LOST,
  AdministrativeStatus.STOLEN,
  AdministrativeStatus.ARCHIVED,
]);

type AttributeCandidate = {
  key: string;
  value: string;
};

type NetworkObservation = {
  identityKey: string;
  name: string;
  macAddress: string | null;
  ipAddresses: string[];
};

type ExistingInterface = {
  id: string;
  identityKey: string;
  macAddress: string | null;
  ipAddresses: string[];
  isCurrent: boolean;
  lastSeenAt: Date;
};

@Injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestAsset(dto: IngestAssetDto, actor: CurrentActor) {
    return this.ingestNormalizedAsset({
      source: dto.source,
      sourceRecordId: dto.sourceAssetId,
      hostname: dto.hostname,
      type: dto.type,
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(dto.serialNumber === undefined ? {} : { serialNumber: dto.serialNumber }),
      ...(dto.manufacturer === undefined ? {} : { manufacturer: dto.manufacturer }),
      ...(dto.model === undefined ? {} : { model: dto.model }),
      ...(dto.operatingSystem === undefined ? {} : { operatingSystem: dto.operatingSystem }),
      ...(dto.osVersion === undefined ? {} : { osVersion: dto.osVersion }),
      observedAt: new Date(dto.lastSeenAt),
      ...(dto.ipAddresses === undefined ? {} : { ipAddresses: dto.ipAddresses }),
      ...(dto.macAddresses === undefined ? {} : { macAddresses: dto.macAddresses }),
      ...(dto.confidenceScore === undefined ? {} : { confidenceScore: dto.confidenceScore }),
      ...(dto.dataQualityScore === undefined ? {} : { dataQualityScore: dto.dataQualityScore }),
      evidenceType: 'MANUAL_ASSET_SNAPSHOT',
      payload: this.toJson(dto),
      description: `Ingestão manual simulada recebida da fonte ${dto.source.trim().toLowerCase()}.`,
      auditActor: actor,
    });
  }

  async ingestNormalizedAsset(observation: NormalizedAssetObservation) {
    if (observation.connectorObservationKey) {
      const existingEvidence = await this.prisma.assetEvidence.findUnique({
        where: { connectorObservationKey: observation.connectorObservationKey },
        select: { id: true, connectorRunId: true },
      });
      if (existingEvidence) {
        if (existingEvidence.connectorRunId !== observation.connectorRunId) {
          throw new Error('Connector observation replay is inconsistent.');
        }
        return { action: 'replayed' as const, evidenceId: existingEvidence.id };
      }
    }

    const observedAt = observation.observedAt;
    const source = observation.source.trim().toLowerCase();
    const sourceAssetId = observation.sourceRecordId.trim();
    const canonicalKey = `${source}:${sourceAssetId}`;
    const confidenceScore = observation.confidenceScore ?? DEFAULT_CONFIDENCE_SCORE;
    const dataQualityScore = observation.dataQualityScore ?? this.calculateDataQuality(observation);
    const payload = observation.payload;
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const attributes = this.buildAttributeCandidates(observation);
    const hasNetworkSnapshot =
      observation.ipAddresses !== undefined || observation.macAddresses !== undefined;
    const networkObservations = this.buildNetworkObservations(
      observation.ipAddresses ?? [],
      observation.macAddresses ?? [],
    );

    return this.prisma.$transaction(async (transaction) => {
      const existingAsset = await transaction.asset.findUnique({
        where: { canonicalKey },
        include: {
          attributes: {
            where: { isCurrent: true },
            select: {
              id: true,
              key: true,
              valueText: true,
              lastConfirmedAt: true,
            },
          },
          networkInterfaces: {
            select: {
              id: true,
              identityKey: true,
              macAddress: true,
              ipAddresses: true,
              isCurrent: true,
              lastSeenAt: true,
            },
          },
        },
      });
      const changedFields = existingAsset
        ? this.detectChangedFields(
            existingAsset,
            observation,
            attributes,
            networkObservations,
            hasNetworkSnapshot,
          )
        : attributes.map((attribute) => attribute.key);
      const action = !existingAsset ? 'created' : changedFields.length ? 'updated' : 'synced';
      const regularEventType = !existingAsset
        ? 'ASSET_DISCOVERED'
        : changedFields.length
          ? 'ASSET_UPDATED'
          : 'ASSET_SYNCED';
      const hasLifecycleConflict = Boolean(
        existingAsset && CLOSED_ADMINISTRATIVE_STATUSES.has(existingAsset.administrativeStatus),
      );
      const eventType = hasLifecycleConflict ? 'ASSET_REAPPEARED' : regularEventType;
      const lastSeenAt =
        existingAsset?.lastSeenAt && existingAsset.lastSeenAt > observedAt
          ? existingAsset.lastSeenAt
          : observedAt;

      const asset = existingAsset
        ? await transaction.asset.update({
            where: { id: existingAsset.id },
            data: {
              name: observation.hostname.trim(),
              kind: observation.type.trim(),
              operationalStatus: OperationalStatus.SEEN_RECENTLY,
              confidenceScore,
              dataQualityScore,
              lastSeenAt,
            },
          })
        : await transaction.asset.create({
            data: {
              canonicalKey,
              name: observation.hostname.trim(),
              kind: observation.type.trim(),
              operationalStatus: OperationalStatus.SEEN_RECENTLY,
              administrativeStatus: AdministrativeStatus.IN_USE,
              confidenceScore,
              dataQualityScore,
              firstSeenAt: observedAt,
              lastSeenAt,
            },
          });

      const evidence = await transaction.assetEvidence.create({
        data: {
          assetId: asset.id,
          ...(observation.connectorRunId === undefined
            ? {}
            : { connectorRunId: observation.connectorRunId }),
          ...(observation.connectorObservationKey === undefined
            ? {}
            : { connectorObservationKey: observation.connectorObservationKey }),
          source,
          sourceRecordId: sourceAssetId,
          evidenceType: observation.evidenceType,
          payload,
          fingerprint,
          confidenceScore,
          dataQualityScore,
          observedAt,
        },
      });

      await this.reconcileAttributes(transaction, {
        assetId: asset.id,
        evidenceId: evidence.id,
        attributes,
        existingAttributes: existingAsset?.attributes ?? [],
        confidenceScore,
        dataQualityScore,
        observedAt,
      });

      if (hasNetworkSnapshot) {
        await this.reconcileNetworkInterfaces(transaction, {
          assetId: asset.id,
          evidenceId: evidence.id,
          existingInterfaces: existingAsset?.networkInterfaces ?? [],
          observations: networkObservations,
          source,
          observedAt,
        });
      }

      const lifecycleMessage = hasLifecycleConflict
        ? `Ativo administrativamente ${existingAsset!.administrativeStatus} voltou a gerar evidência técnica.`
        : null;
      const lifecycleConflict = hasLifecycleConflict
        ? await this.upsertLifecycleConflict(transaction, {
            assetId: asset.id,
            evidenceId: evidence.id,
            administrativeStatus: existingAsset!.administrativeStatus,
            source,
            observedAt,
            message: lifecycleMessage!,
          })
        : null;

      const event = await transaction.assetEvent.create({
        data: {
          assetId: asset.id,
          evidenceId: evidence.id,
          eventType,
          title: this.eventTitle(eventType),
          description: lifecycleMessage ?? observation.description,
          data: hasLifecycleConflict
            ? {
                administrativeStatus: existingAsset!.administrativeStatus,
                source,
                evidenceId: evidence.id,
                message: lifecycleMessage!,
                ...(observation.auditActor === undefined
                  ? {}
                  : { actorId: observation.auditActor.id }),
                ...(observation.connectorRunId === undefined
                  ? {}
                  : { connectorRunId: observation.connectorRunId }),
              }
            : {
                source,
                sourceAssetId,
                confidenceScore,
                dataQualityScore,
                changedFields,
                ...(observation.auditActor === undefined
                  ? {}
                  : { actorId: observation.auditActor.id }),
                ...(observation.connectorRunId === undefined
                  ? {}
                  : { connectorRunId: observation.connectorRunId }),
              },
          occurredAt: observedAt,
        },
      });

      if (observation.auditActor) {
        await transaction.auditLog.create({
          data: {
            assetId: asset.id,
            actorType: auditActorType(observation.auditActor),
            actorId: observation.auditActor.id,
            action: 'ASSET_INGESTION_COMPLETED',
            entityType: 'Asset',
            entityId: asset.id,
            after: {
              result: action,
              eventType,
            },
            metadata: {
              assetId: asset.id,
              evidenceId: evidence.id,
              eventId: event.id,
              source,
              sourceRecordId: sourceAssetId,
              result: action,
              eventType,
              changedFields,
            },
          },
        });
      }

      const assetDetail = await transaction.asset.findUniqueOrThrow({
        where: { id: asset.id },
        select: assetDetailSelect,
      });

      return {
        action,
        eventType,
        changedFields,
        evidenceId: evidence.id,
        eventId: event.id,
        lifecycleConflict,
        asset: presentAssetDetail(assetDetail),
      };
    });
  }

  private detectChangedFields(
    asset: {
      name: string;
      kind: string;
      attributes: Array<{ key: string; valueText: string | null }>;
      networkInterfaces: ExistingInterface[];
    },
    observation: NormalizedAssetObservation,
    attributes: AttributeCandidate[],
    observations: NetworkObservation[],
    hasNetworkSnapshot: boolean,
  ): string[] {
    const changedFields = new Set<string>();
    const currentAttributes = new Map(
      asset.attributes.map((attribute) => [attribute.key, attribute.valueText]),
    );

    if (asset.name !== observation.hostname.trim()) {
      changedFields.add('hostname');
    }
    if (asset.kind !== observation.type.trim()) {
      changedFields.add('type');
    }

    for (const attribute of attributes) {
      if (currentAttributes.get(attribute.key) !== attribute.value) {
        changedFields.add(attribute.key);
      }
    }

    if (
      hasNetworkSnapshot &&
      this.networkSnapshotChanged(
        asset.networkInterfaces.filter((networkInterface) => networkInterface.isCurrent),
        observations,
      )
    ) {
      changedFields.add('networkInterfaces');
    }

    return [...changedFields];
  }

  private networkSnapshotChanged(
    existing: ExistingInterface[],
    observations: NetworkObservation[],
  ): boolean {
    const existingByIdentity = new Map(
      existing.map((networkInterface) => [networkInterface.identityKey, networkInterface]),
    );
    const observedIdentities = new Set(observations.map((observation) => observation.identityKey));

    if (
      existing.some((networkInterface) => !observedIdentities.has(networkInterface.identityKey))
    ) {
      return true;
    }

    return observations.some((observation) => {
      const current = existingByIdentity.get(observation.identityKey);

      return !current || observation.ipAddresses.some((ip) => !current.ipAddresses.includes(ip));
    });
  }

  private buildAttributeCandidates(observation: NormalizedAssetObservation): AttributeCandidate[] {
    const candidates = [
      { key: 'hostname', value: observation.hostname },
      { key: 'type', value: observation.type },
      { key: 'category', value: observation.category },
      { key: 'serialNumber', value: observation.serialNumber },
      { key: 'manufacturer', value: observation.manufacturer },
      { key: 'model', value: observation.model },
      { key: 'operatingSystem', value: observation.operatingSystem },
      { key: 'osVersion', value: observation.osVersion },
    ];

    return candidates
      .filter(
        (candidate): candidate is { key: string; value: string } =>
          candidate.value !== undefined && candidate.value.trim() !== '',
      )
      .map((candidate) => ({ ...candidate, value: candidate.value.trim() }));
  }

  private buildNetworkObservations(
    rawIpAddresses: readonly string[],
    rawMacAddresses: readonly string[],
  ): NetworkObservation[] {
    const ipAddresses = [...new Set(rawIpAddresses.map((ip) => ip.trim().toLowerCase()))];
    const macAddresses = [
      ...new Set(rawMacAddresses.map((mac) => mac.replaceAll('-', ':').toLowerCase())),
    ];
    const observations: NetworkObservation[] = [];

    const [onlyMacAddress] = macAddresses;
    if (macAddresses.length === 1 && onlyMacAddress) {
      observations.push(this.networkObservation(onlyMacAddress, ipAddresses));
      return observations;
    }

    macAddresses.forEach((macAddress, index) => {
      observations.push(
        this.networkObservation(macAddress, ipAddresses[index] ? [ipAddresses[index]] : []),
      );
    });

    ipAddresses.slice(macAddresses.length).forEach((ipAddress) => {
      observations.push(this.networkObservation(null, [ipAddress]));
    });

    return observations;
  }

  private networkObservation(macAddress: string | null, ipAddresses: string[]): NetworkObservation {
    const [firstIpAddress] = ipAddresses;
    if (!macAddress && !firstIpAddress) {
      throw new Error('A network observation requires a MAC or IP address.');
    }

    const identityKey = macAddress ? `mac:${macAddress}` : `ip:${firstIpAddress}`;
    const name = macAddress
      ? `mac-${macAddress.replaceAll(':', '')}`
      : `ip-${firstIpAddress?.replaceAll(':', '-')}`;

    return { identityKey, name, macAddress, ipAddresses };
  }

  private async reconcileAttributes(
    transaction: Prisma.TransactionClient,
    input: {
      assetId: string;
      evidenceId: string;
      attributes: AttributeCandidate[];
      existingAttributes: Array<{
        id: string;
        key: string;
        valueText: string | null;
        lastConfirmedAt: Date;
      }>;
      confidenceScore: number;
      dataQualityScore: number;
      observedAt: Date;
    },
  ): Promise<void> {
    const existingByKey = new Map(
      input.existingAttributes.map((attribute) => [attribute.key, attribute]),
    );

    for (const attribute of input.attributes) {
      const current = existingByKey.get(attribute.key);

      if (current?.valueText === attribute.value) {
        await transaction.assetAttribute.update({
          where: { id: current.id },
          data: {
            evidenceId: input.evidenceId,
            confidenceScore: input.confidenceScore,
            dataQualityScore: input.dataQualityScore,
            lastConfirmedAt:
              current.lastConfirmedAt > input.observedAt
                ? current.lastConfirmedAt
                : input.observedAt,
            confirmationCount: { increment: 1 },
          },
        });
        continue;
      }

      if (current) {
        await transaction.assetAttribute.update({
          where: { id: current.id },
          data: {
            isCurrent: false,
            validTo: input.observedAt,
          },
        });
      }

      await transaction.assetAttribute.create({
        data: {
          assetId: input.assetId,
          evidenceId: input.evidenceId,
          key: attribute.key,
          value: attribute.value,
          valueText: attribute.value,
          valueType: AttributeValueType.STRING,
          confidenceScore: input.confidenceScore,
          dataQualityScore: input.dataQualityScore,
          isCurrent: true,
          observedAt: input.observedAt,
          lastConfirmedAt: input.observedAt,
          validFrom: input.observedAt,
        },
      });
    }
  }

  private async reconcileNetworkInterfaces(
    transaction: Prisma.TransactionClient,
    input: {
      assetId: string;
      evidenceId: string;
      existingInterfaces: ExistingInterface[];
      observations: NetworkObservation[];
      source: string;
      observedAt: Date;
    },
  ): Promise<void> {
    const existingByIdentity = new Map(
      input.existingInterfaces.map((networkInterface) => [
        networkInterface.identityKey,
        networkInterface,
      ]),
    );

    await transaction.networkInterface.updateMany({
      where: { assetId: input.assetId, isCurrent: true },
      data: { isCurrent: false },
    });

    for (const [index, observation] of input.observations.entries()) {
      const existing = existingByIdentity.get(observation.identityKey);

      if (existing) {
        await transaction.networkInterface.update({
          where: { id: existing.id },
          data: {
            evidenceId: input.evidenceId,
            ipAddresses: [...new Set([...existing.ipAddresses, ...observation.ipAddresses])],
            interfaceIndex: index + 1,
            isPrimary: index === 0,
            isCurrent: true,
            observedAt: input.observedAt,
            lastSeenAt:
              existing.lastSeenAt > input.observedAt ? existing.lastSeenAt : input.observedAt,
          },
        });
      } else {
        await transaction.networkInterface.create({
          data: {
            assetId: input.assetId,
            evidenceId: input.evidenceId,
            identityKey: observation.identityKey,
            name: observation.name,
            macAddress: observation.macAddress,
            ipAddresses: observation.ipAddresses,
            interfaceIndex: index + 1,
            isPrimary: index === 0,
            isCurrent: true,
            observedAt: input.observedAt,
            firstSeenAt: input.observedAt,
            lastSeenAt: input.observedAt,
          },
        });
      }

      await this.registerIpConflicts(transaction, {
        assetId: input.assetId,
        evidenceId: input.evidenceId,
        existingInterfaces: input.existingInterfaces,
        observation,
        source: input.source,
        observedAt: input.observedAt,
      });
    }
  }

  private async registerIpConflicts(
    transaction: Prisma.TransactionClient,
    input: {
      assetId: string;
      evidenceId: string;
      existingInterfaces: ExistingInterface[];
      observation: NetworkObservation;
      source: string;
      observedAt: Date;
    },
  ): Promise<void> {
    if (!input.observation.macAddress) {
      return;
    }

    for (const ipAddress of input.observation.ipAddresses) {
      const conflictingInterfaces = input.existingInterfaces.filter(
        (networkInterface) =>
          networkInterface.macAddress &&
          networkInterface.macAddress !== input.observation.macAddress &&
          networkInterface.ipAddresses.includes(ipAddress),
      );

      for (const conflictingInterface of conflictingInterfaces) {
        await this.upsertIpConflict(transaction, {
          assetId: input.assetId,
          evidenceId: input.evidenceId,
          ipAddress,
          previousMac: conflictingInterface.macAddress!,
          observedMac: input.observation.macAddress,
          source: input.source,
          observedAt: input.observedAt,
        });
      }
    }
  }

  private async upsertIpConflict(
    transaction: Prisma.TransactionClient,
    input: {
      assetId: string;
      evidenceId: string;
      ipAddress: string;
      previousMac: string;
      observedMac: string;
      source: string;
      observedAt: Date;
    },
  ): Promise<void> {
    const attributeKey = `network.ip.${input.ipAddress}`;
    const existingConflict = await transaction.conflict.findFirst({
      where: {
        assetId: input.assetId,
        attributeKey,
        status: ConflictStatus.OPEN,
      },
      include: {
        values: { select: { normalizedValue: true } },
      },
    });
    const values = [input.previousMac, input.observedMac];

    if (!existingConflict) {
      await transaction.conflict.create({
        data: {
          assetId: input.assetId,
          attributeKey,
          severity: 2,
          detectedAt: input.observedAt,
          values: {
            create: values.map((macAddress) => ({
              evidenceId: input.evidenceId,
              value: { ipAddress: input.ipAddress, macAddress },
              normalizedValue: macAddress,
              source: input.source,
              observedAt: input.observedAt,
            })),
          },
        },
      });
      return;
    }

    const knownValues = new Set(
      existingConflict.values.map((value) => value.normalizedValue).filter(Boolean),
    );
    const newValues = values.filter((value) => !knownValues.has(value));

    if (newValues.length) {
      await transaction.conflictValue.createMany({
        data: newValues.map((macAddress) => ({
          conflictId: existingConflict.id,
          evidenceId: input.evidenceId,
          value: { ipAddress: input.ipAddress, macAddress },
          normalizedValue: macAddress,
          source: input.source,
          observedAt: input.observedAt,
        })),
      });
    }
  }

  private async upsertLifecycleConflict(
    transaction: Prisma.TransactionClient,
    input: {
      assetId: string;
      evidenceId: string;
      administrativeStatus: AdministrativeStatus;
      source: string;
      observedAt: Date;
      message: string;
    },
  ) {
    const existingConflict = await transaction.conflict.findFirst({
      where: {
        assetId: input.assetId,
        conflictType: LIFECYCLE_CONFLICT_TYPE,
        attributeKey: 'administrativeStatus',
        status: ConflictStatus.OPEN,
      },
      select: { id: true },
    });
    const conflictValue = {
      evidenceId: input.evidenceId,
      value: {
        administrativeStatus: input.administrativeStatus,
        message: input.message,
      },
      normalizedValue: input.administrativeStatus,
      source: input.source,
      observedAt: input.observedAt,
    };
    const select = {
      id: true,
      conflictType: true,
      attributeKey: true,
      status: true,
      impact: true,
      suggestedValue: true,
      suggestionReason: true,
      occurrenceCount: true,
    } satisfies Prisma.ConflictSelect;

    if (!existingConflict) {
      return transaction.conflict.create({
        data: {
          assetId: input.assetId,
          conflictType: LIFECYCLE_CONFLICT_TYPE,
          attributeKey: 'administrativeStatus',
          status: ConflictStatus.OPEN,
          severity: 3,
          impact: 'HIGH',
          suggestedValue: 'REVIEW_REQUIRED',
          suggestionReason: 'Ativo encerrado voltou a gerar evidência técnica.',
          detectedAt: input.observedAt,
          lastDetectedAt: input.observedAt,
          values: { create: conflictValue },
        },
        select,
      });
    }

    return transaction.conflict.update({
      where: { id: existingConflict.id },
      data: {
        impact: 'HIGH',
        suggestedValue: 'REVIEW_REQUIRED',
        suggestionReason: 'Ativo encerrado voltou a gerar evidência técnica.',
        lastDetectedAt: input.observedAt,
        occurrenceCount: { increment: 1 },
        values: { create: conflictValue },
      },
      select,
    });
  }

  private calculateDataQuality(observation: NormalizedAssetObservation): number {
    const relevantValues = [
      observation.hostname,
      observation.type,
      observation.category,
      observation.serialNumber,
      observation.manufacturer,
      observation.model,
      observation.operatingSystem,
      observation.osVersion,
      observation.observedAt,
      observation.ipAddresses?.length ? observation.ipAddresses : undefined,
      observation.macAddresses?.length ? observation.macAddresses : undefined,
    ];
    const completed = relevantValues.filter((value) => value !== undefined && value !== '').length;

    return Math.round((completed / relevantValues.length) * 10000) / 100;
  }

  private toJson(dto: IngestAssetDto): Prisma.InputJsonObject {
    return Object.fromEntries(Object.entries(dto).filter((entry) => entry[1] !== undefined));
  }

  private eventTitle(eventType: string): string {
    if (eventType === 'ASSET_DISCOVERED') {
      return 'Ativo descoberto';
    }
    if (eventType === 'ASSET_UPDATED') {
      return 'Ativo atualizado';
    }
    if (eventType === 'ASSET_REAPPEARED') {
      return 'Ativo encerrado voltou a aparecer';
    }
    return 'Ativo sincronizado';
  }
}
