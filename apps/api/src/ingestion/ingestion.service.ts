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
    const observedAt = new Date(dto.lastSeenAt);
    const source = dto.source.trim().toLowerCase();
    const sourceAssetId = dto.sourceAssetId.trim();
    const canonicalKey = `${source}:${sourceAssetId}`;
    const confidenceScore = dto.confidenceScore ?? DEFAULT_CONFIDENCE_SCORE;
    const dataQualityScore = dto.dataQualityScore ?? this.calculateDataQuality(dto);
    const payload = this.toJson(dto);
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const attributes = this.buildAttributeCandidates(dto);
    const hasNetworkSnapshot = dto.ipAddresses !== undefined || dto.macAddresses !== undefined;
    const networkObservations = this.buildNetworkObservations(
      dto.ipAddresses ?? [],
      dto.macAddresses ?? [],
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
            dto,
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
              name: dto.hostname.trim(),
              kind: dto.type.trim(),
              operationalStatus: OperationalStatus.SEEN_RECENTLY,
              confidenceScore,
              dataQualityScore,
              lastSeenAt,
            },
          })
        : await transaction.asset.create({
            data: {
              canonicalKey,
              name: dto.hostname.trim(),
              kind: dto.type.trim(),
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
          source,
          sourceRecordId: sourceAssetId,
          evidenceType: 'MANUAL_ASSET_SNAPSHOT',
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
          description: lifecycleMessage ?? `Ingestão manual simulada recebida da fonte ${source}.`,
          data: hasLifecycleConflict
            ? {
                administrativeStatus: existingAsset!.administrativeStatus,
                source,
                evidenceId: evidence.id,
                message: lifecycleMessage!,
                actorId: actor.id,
              }
            : {
                source,
                sourceAssetId,
                confidenceScore,
                dataQualityScore,
                changedFields,
                actorId: actor.id,
              },
          occurredAt: observedAt,
        },
      });

      await transaction.auditLog.create({
        data: {
          assetId: asset.id,
          actorType: auditActorType(actor),
          actorId: actor.id,
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
    dto: IngestAssetDto,
    attributes: AttributeCandidate[],
    observations: NetworkObservation[],
    hasNetworkSnapshot: boolean,
  ): string[] {
    const changedFields = new Set<string>();
    const currentAttributes = new Map(
      asset.attributes.map((attribute) => [attribute.key, attribute.valueText]),
    );

    if (asset.name !== dto.hostname.trim()) {
      changedFields.add('hostname');
    }
    if (asset.kind !== dto.type.trim()) {
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

  private buildAttributeCandidates(dto: IngestAssetDto): AttributeCandidate[] {
    const candidates = [
      { key: 'hostname', value: dto.hostname },
      { key: 'type', value: dto.type },
      { key: 'category', value: dto.category },
      { key: 'serialNumber', value: dto.serialNumber },
      { key: 'manufacturer', value: dto.manufacturer },
      { key: 'model', value: dto.model },
      { key: 'operatingSystem', value: dto.operatingSystem },
      { key: 'osVersion', value: dto.osVersion },
    ];

    return candidates
      .filter(
        (candidate): candidate is { key: string; value: string } =>
          candidate.value !== undefined && candidate.value.trim() !== '',
      )
      .map((candidate) => ({ ...candidate, value: candidate.value.trim() }));
  }

  private buildNetworkObservations(
    rawIpAddresses: string[],
    rawMacAddresses: string[],
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

  private calculateDataQuality(dto: IngestAssetDto): number {
    const relevantValues = [
      dto.hostname,
      dto.type,
      dto.category,
      dto.serialNumber,
      dto.manufacturer,
      dto.model,
      dto.operatingSystem,
      dto.osVersion,
      dto.lastSeenAt,
      dto.ipAddresses?.length ? dto.ipAddresses : undefined,
      dto.macAddresses?.length ? dto.macAddresses : undefined,
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
