import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assetDetailSelect,
  assetSummarySelect,
  presentAssetDetail,
  presentAssetSummary,
} from './asset.presenter';
import { UpdateAdministrativeStatusDto } from './dto/update-administrative-status.dto';
import { QueryAssetsDto } from './dto/query-assets.dto';

const SIMULATED_ACTOR_USER_ID = 'atlas-mvp-user';

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
}
