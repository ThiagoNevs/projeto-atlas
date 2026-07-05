import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AttributeValueType, OperationalStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assetDetailSelect,
  assetSummarySelect,
  presentAssetDetail,
  presentAssetSummary,
} from './asset.presenter';
import { UpdateAdministrativeStatusDto } from './dto/update-administrative-status.dto';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { CreateManualAssetDto } from './dto/create-manual-asset.dto';

const SIMULATED_ACTOR_USER_ID = 'atlas-mvp-user';
const MANUAL_CONFIDENCE_SCORE = 60;
const MANUAL_SOURCE = 'MANUAL';
const MANUAL_EVIDENCE_TYPE = 'MANUAL_DECLARATION';
const MANUAL_EVENT_TYPE = 'ASSET_MANUALLY_DECLARED';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryAssetsDto) {
    this.validateScoreRanges(query);
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query);
    const skip = (query.page - 1) * query.pageSize;

    const [total, assets] = await this.prisma.$transaction([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({
        where,
        select: assetSummarySelect,
        orderBy: [orderBy, { id: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: assets.map(presentAssetSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: assetDetailSelect,
    });

    if (!asset) {
      throw new NotFoundException(`Asset ${id} was not found.`);
    }

    return presentAssetDetail(asset);
  }

  async updateAdministrativeStatus(id: string, payload: UpdateAdministrativeStatusDto) {
    return this.prisma.$transaction(async (transaction) => {
      const currentAsset = await transaction.asset.findUnique({
        where: { id },
        select: { id: true, administrativeStatus: true },
      });

      if (!currentAsset) {
        throw new NotFoundException(`Asset ${id} was not found.`);
      }

      if (currentAsset.administrativeStatus === payload.administrativeStatus) {
        throw new BadRequestException(
          `Asset ${id} already has administrative status ${payload.administrativeStatus}.`,
        );
      }

      const occurredAt = new Date();
      const changeData = {
        previousStatus: currentAsset.administrativeStatus,
        newStatus: payload.administrativeStatus,
        reason: payload.reason.trim(),
        comment: payload.comment.trim(),
        actorUserId: SIMULATED_ACTOR_USER_ID,
      };

      const asset = await transaction.asset.update({
        where: { id },
        data: { administrativeStatus: payload.administrativeStatus },
        select: assetDetailSelect,
      });

      const event = await transaction.assetEvent.create({
        data: {
          assetId: id,
          eventType: 'ADMIN_STATUS_CHANGED',
          title: 'Status administrativo alterado',
          description: `${changeData.previousStatus} → ${changeData.newStatus}: ${changeData.reason}`,
          data: changeData,
          occurredAt,
        },
        select: { id: true },
      });

      const auditLog = await transaction.auditLog.create({
        data: {
          assetId: id,
          actorType: 'USER',
          actorId: SIMULATED_ACTOR_USER_ID,
          action: 'ADMIN_STATUS_CHANGED',
          entityType: 'Asset',
          entityId: id,
          before: { administrativeStatus: changeData.previousStatus },
          after: { administrativeStatus: changeData.newStatus },
          metadata: {
            reason: changeData.reason,
            comment: changeData.comment,
          },
          occurredAt,
        },
        select: { id: true },
      });

      return {
        asset: presentAssetDetail(asset),
        previousStatus: changeData.previousStatus,
        administrativeStatus: changeData.newStatus,
        eventId: event.id,
        auditLogId: auditLog.id,
      };
    });
  }

  private buildWhere(query: QueryAssetsDto): Prisma.AssetWhereInput {
    const search = query.search?.trim();
    const relevantAttributeKeys = [
      'serialNumber',
      'manufacturer',
      'model',
      'operatingSystem',
      'osVersion',
    ];

    return {
      operationalStatus: query.operationalStatus,
      administrativeStatus: query.administrativeStatus,
      kind: query.type,
      confidenceScore:
        query.minConfidenceScore !== undefined || query.maxConfidenceScore !== undefined
          ? { gte: query.minConfidenceScore, lte: query.maxConfidenceScore }
          : undefined,
      dataQualityScore:
        query.minDataQualityScore !== undefined || query.maxDataQualityScore !== undefined
          ? { gte: query.minDataQualityScore, lte: query.maxDataQualityScore }
          : undefined,
      OR: search
        ? [
            { name: { contains: search, mode: 'insensitive' } },
            { canonicalKey: { contains: search, mode: 'insensitive' } },
            { kind: { contains: search, mode: 'insensitive' } },
            {
              attributes: {
                some: {
                  key: { in: relevantAttributeKeys },
                  valueText: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              networkInterfaces: {
                some: {
                  OR: [
                    { macAddress: { contains: search, mode: 'insensitive' } },
                    { ipAddresses: { has: search } },
                  ],
                },
              },
            },
          ]
        : undefined,
    };
  }

  private buildOrderBy(query: QueryAssetsDto): Prisma.AssetOrderByWithRelationInput {
    const direction = query.sortDirection;

    switch (query.sortBy) {
      case 'evidenceCount':
        return { evidence: { _count: direction } };
      case 'eventCount':
        return { events: { _count: direction } };
      case 'name':
        return { name: direction };
      case 'confidenceScore':
        return { confidenceScore: direction };
      case 'dataQualityScore':
        return { dataQualityScore: direction };
      case 'createdAt':
        return { createdAt: direction };
      case 'updatedAt':
        return { updatedAt: direction };
      case 'lastSeenAt':
      default:
        return { lastSeenAt: direction };
    }
  }

  private validateScoreRanges(query: QueryAssetsDto): void {
    if (
      query.minConfidenceScore !== undefined &&
      query.maxConfidenceScore !== undefined &&
      query.minConfidenceScore > query.maxConfidenceScore
    ) {
      throw new BadRequestException(
        'minConfidenceScore must be less than or equal to maxConfidenceScore.',
      );
    }
    if (
      query.minDataQualityScore !== undefined &&
      query.maxDataQualityScore !== undefined &&
      query.minDataQualityScore > query.maxDataQualityScore
    ) {
      throw new BadRequestException(
        'minDataQualityScore must be less than or equal to maxDataQualityScore.',
      );
    }
  }

  private manualAttributes(payload: CreateManualAssetDto): Array<{ key: string; value: string }> {
    const candidates = [
      ['hostname', payload.hostname],
      ['serialNumber', payload.serialNumber],
      ['manufacturer', payload.manufacturer],
      ['model', payload.model],
      ['operatingSystem', payload.operatingSystem],
      ['osVersion', payload.osVersion],
      ['location', payload.location],
      ['owner', payload.owner],
      ['department', payload.department],
      ['environment', payload.environment],
      ['criticality', payload.criticality],
      ['comment', payload.comment],
    ];
    return candidates.flatMap(([key, value]) =>
      value?.trim() ? [{ key: key!, value: value.trim() }] : [],
    );
  }

  private calculateManualDataQuality(payload: CreateManualAssetDto): number {
    const relevantValues = [
      payload.identifier,
      payload.type,
      payload.administrativeStatus,
      payload.hostname,
      payload.serialNumber,
      payload.manufacturer,
      payload.model,
      payload.operatingSystem,
      payload.osVersion,
      payload.location,
      payload.owner,
      payload.department,
      payload.environment,
      payload.criticality,
      payload.comment,
    ];
    const completed = relevantValues.filter(
      (value) => typeof value === 'string' && value.trim() !== '',
    ).length;
    return Math.round((completed / relevantValues.length) * 10000) / 100;
  }

  private manualPayload(payload: CreateManualAssetDto): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
  }

  private normalizeIdentifier(identifier: string, identifierType: string): string {
    const normalized = identifier.trim().toLowerCase();
    return identifierType === 'MAC_ADDRESS'
      ? normalized.replaceAll('-', ':').replace(/\s/g, '')
      : normalized;
  }

  private manualDuplicateWhere(
    payload: CreateManualAssetDto,
    canonicalKey: string,
    name: string,
    normalizedIdentifier: string,
  ): Prisma.AssetWhereInput {
    const alternatives: Prisma.AssetWhereInput[] = [
      { canonicalKey },
      { name: { equals: name, mode: 'insensitive' } },
    ];
    if (payload.hostname) {
      alternatives.push({ name: { equals: payload.hostname, mode: 'insensitive' } });
    }
    if (payload.serialNumber) {
      alternatives.push({
        attributes: {
          some: {
            isCurrent: true,
            key: { in: ['serialNumber', 'SERIALNUMBER'] },
            valueText: { equals: payload.serialNumber, mode: 'insensitive' },
          },
        },
      });
    }
    if (payload.identifierType === 'SERIAL_NUMBER') {
      alternatives.push({
        attributes: {
          some: {
            isCurrent: true,
            key: { in: ['serialNumber', 'SERIALNUMBER'] },
            valueText: { equals: payload.identifier, mode: 'insensitive' },
          },
        },
      });
    }
    if (payload.identifierType === 'MAC_ADDRESS') {
      alternatives.push({
        networkInterfaces: {
          some: { macAddress: { equals: normalizedIdentifier, mode: 'insensitive' } },
        },
      });
    }
    return { OR: alternatives };
  }

  async createManual(payload: CreateManualAssetDto) {
    const occurredAt = new Date();
    const identifier = payload.identifier.trim();
    const normalizedIdentifier = this.normalizeIdentifier(identifier, payload.identifierType);
    const canonicalKey = `manual:${payload.identifierType.toLowerCase()}:${normalizedIdentifier}`;
    const name = payload.hostname?.trim() || identifier;
    const confidenceScore = MANUAL_CONFIDENCE_SCORE;
    const dataQualityScore = this.calculateManualDataQuality(payload);
    const attributes = this.manualAttributes(payload);
    const evidencePayload = this.manualPayload(payload);
    const fingerprint = createHash('sha256').update(JSON.stringify(evidencePayload)).digest('hex');

    return this.prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.asset.findFirst({
        where: this.manualDuplicateWhere(payload, canonicalKey, name, normalizedIdentifier),
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Já existe um ativo com identificador semelhante.');
      }

      const asset = await transaction.asset.create({
        data: {
          canonicalKey,
          name,
          kind: payload.type,
          operationalStatus: OperationalStatus.UNKNOWN,
          administrativeStatus: payload.administrativeStatus,
          confidenceScore,
          dataQualityScore,
          firstSeenAt: null,
          lastSeenAt: null,
        },
      });
      const evidence = await transaction.assetEvidence.create({
        data: {
          assetId: asset.id,
          source: MANUAL_SOURCE,
          sourceRecordId: identifier,
          evidenceType: MANUAL_EVIDENCE_TYPE,
          payload: evidencePayload,
          fingerprint,
          confidenceScore,
          dataQualityScore,
          observedAt: occurredAt,
        },
      });

      if (attributes.length) {
        await transaction.assetAttribute.createMany({
          data: attributes.map((attribute) => ({
            assetId: asset.id,
            evidenceId: evidence.id,
            key: attribute.key,
            value: attribute.value,
            valueText: attribute.value,
            valueType: AttributeValueType.STRING,
            confidenceScore,
            dataQualityScore,
            isCurrent: true,
            observedAt: occurredAt,
            lastConfirmedAt: occurredAt,
            validFrom: occurredAt,
          })),
        });
      }

      const eventData = {
        identifier,
        identifierType: payload.identifierType,
        reason: payload.reason,
        source: MANUAL_SOURCE,
        actorUserId: SIMULATED_ACTOR_USER_ID,
      };
      const event = await transaction.assetEvent.create({
        data: {
          assetId: asset.id,
          evidenceId: evidence.id,
          eventType: MANUAL_EVENT_TYPE,
          title: 'Ativo declarado manualmente',
          description: payload.reason,
          data: eventData,
          occurredAt,
        },
        select: { id: true },
      });
      const auditLog = await transaction.auditLog.create({
        data: {
          assetId: asset.id,
          actorType: 'USER',
          actorId: SIMULATED_ACTOR_USER_ID,
          action: MANUAL_EVENT_TYPE,
          entityType: 'Asset',
          entityId: asset.id,
          after: {
            identifier,
            identifierType: payload.identifierType,
            type: payload.type,
            administrativeStatus: payload.administrativeStatus,
          },
          metadata: {
            ...eventData,
            fieldsProvided: attributes.map((attribute) => attribute.key),
            origin: 'manual-declaration',
            comment: payload.comment,
          },
          occurredAt,
        },
        select: { id: true },
      });
      const detail = await transaction.asset.findUniqueOrThrow({
        where: { id: asset.id },
        select: assetDetailSelect,
      });

      return {
        asset: presentAssetDetail(detail),
        evidenceId: evidence.id,
        eventId: event.id,
        auditLogId: auditLog.id,
      };
    });
  }
}
