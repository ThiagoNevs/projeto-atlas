import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { AdministrativeStatus, ConflictStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryConflictsDto } from './dto/query-conflicts.dto';
import { UpdateConflictStatusDto } from './dto/update-conflict-status.dto';

const SIMULATED_ACTOR_USER_ID = 'atlas-mvp-user';
const LIFECYCLE_CONFLICT_TYPE = 'LIFECYCLE_CONFLICT';
const CLOSED_ADMINISTRATIVE_STATUSES = new Set<AdministrativeStatus>([
  AdministrativeStatus.DEACTIVATED,
  AdministrativeStatus.DISCARDED,
  AdministrativeStatus.LOST,
  AdministrativeStatus.STOLEN,
  AdministrativeStatus.ARCHIVED,
]);
const LIFECYCLE_RESOLUTION_MESSAGE =
  'Para resolver este conflito, reative o ativo ou marque o conflito como exceção/ignorado com justificativa.';

const conflictSummarySelect = {
  id: true,
  conflictType: true,
  attributeKey: true,
  status: true,
  impact: true,
  assetId: true,
  occurrenceCount: true,
  suggestionReason: true,
  createdAt: true,
  updatedAt: true,
  asset: {
    select: {
      name: true,
      canonicalKey: true,
      administrativeStatus: true,
    },
  },
} satisfies Prisma.ConflictSelect;

type ConflictSummaryRecord = Prisma.ConflictGetPayload<{
  select: typeof conflictSummarySelect;
}>;

@Injectable()
export class ConflictsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryConflictsDto) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const orderBy = this.buildOrderBy(query);

    const [total, conflicts] = await this.prisma.$transaction([
      this.prisma.conflict.count({ where }),
      this.prisma.conflict.findMany({
        where,
        select: conflictSummarySelect,
        orderBy: [orderBy, { id: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: conflicts.map((conflict) => this.presentSummary(conflict)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async findOne(id: string) {
    const conflict = await this.prisma.conflict.findUnique({
      where: { id },
      include: {
        asset: {
          select: {
            id: true,
            canonicalKey: true,
            name: true,
            kind: true,
            operationalStatus: true,
            administrativeStatus: true,
            lastSeenAt: true,
            updatedAt: true,
          },
        },
        values: {
          orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!conflict) {
      throw new NotFoundException(`Conflict ${id} was not found.`);
    }

    const timeline = await this.prisma.assetEvent.findMany({
      where: {
        assetId: conflict.assetId,
        eventType: { in: ['ASSET_REAPPEARED', 'CONFLICT_STATUS_CHANGED'] },
      },
      orderBy: [{ occurredAt: 'desc' }, { recordedAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        eventType: true,
        title: true,
        description: true,
        data: true,
        occurredAt: true,
        recordedAt: true,
      },
    });

    return {
      conflict: {
        id: conflict.id,
        type: conflict.conflictType,
        field: conflict.attributeKey,
        status: conflict.status,
        impact: conflict.impact,
        severity: conflict.severity,
        occurrenceCount: conflict.occurrenceCount,
        suggestedValue: conflict.suggestedValue,
        suggestionReason: conflict.suggestionReason,
        detectedAt: conflict.detectedAt,
        lastDetectedAt: conflict.lastDetectedAt,
        resolvedAt: conflict.resolvedAt,
        createdAt: conflict.createdAt,
        updatedAt: conflict.updatedAt,
      },
      asset: {
        ...conflict.asset,
        type: conflict.asset.kind,
        kind: undefined,
      },
      values: conflict.values,
      metadata: {
        severity: conflict.severity,
        suggestedValue: conflict.suggestedValue,
        suggestionReason: conflict.suggestionReason,
        occurrenceCount: conflict.occurrenceCount,
        lastDetectedAt: conflict.lastDetectedAt,
      },
      timeline,
    };
  }

  async updateStatus(id: string, payload: UpdateConflictStatusDto) {
    return this.prisma.$transaction(async (transaction) => {
      const currentConflict = await transaction.conflict.findUnique({
        where: { id },
        select: {
          id: true,
          assetId: true,
          conflictType: true,
          attributeKey: true,
          status: true,
          asset: {
            select: { administrativeStatus: true },
          },
        },
      });

      if (!currentConflict) {
        throw new NotFoundException(`Conflict ${id} was not found.`);
      }

      if (currentConflict.status === payload.status) {
        throw new BadRequestException(`Conflict ${id} already has status ${payload.status}.`);
      }

      if (
        currentConflict.conflictType === LIFECYCLE_CONFLICT_TYPE &&
        payload.status === ConflictStatus.RESOLVED &&
        CLOSED_ADMINISTRATIVE_STATUSES.has(currentConflict.asset.administrativeStatus)
      ) {
        throw new BadRequestException(LIFECYCLE_RESOLUTION_MESSAGE);
      }

      const occurredAt = new Date();
      const reason = payload.reason.trim();
      const comment = payload.comment.trim();
      const changeData = {
        conflictId: id,
        conflictType: currentConflict.conflictType,
        field: currentConflict.attributeKey,
        previousStatus: currentConflict.status,
        newStatus: payload.status,
        reason,
        comment,
        actorUserId: SIMULATED_ACTOR_USER_ID,
      };

      const conflict = await transaction.conflict.update({
        where: { id },
        data: {
          status: payload.status,
          resolvedAt: payload.status === ConflictStatus.RESOLVED ? occurredAt : null,
          resolutionNote: comment,
        },
        select: conflictSummarySelect,
      });

      const event = await transaction.assetEvent.create({
        data: {
          assetId: currentConflict.assetId,
          eventType: 'CONFLICT_STATUS_CHANGED',
          title: 'Status do conflito alterado',
          description: `${currentConflict.status} → ${payload.status}: ${reason}`,
          data: changeData,
          occurredAt,
        },
        select: { id: true },
      });

      const auditLog = await transaction.auditLog.create({
        data: {
          assetId: currentConflict.assetId,
          actorType: 'USER',
          actorId: SIMULATED_ACTOR_USER_ID,
          action: 'CONFLICT_STATUS_CHANGED',
          entityType: 'Conflict',
          entityId: id,
          before: { status: currentConflict.status },
          after: { status: payload.status },
          metadata: { reason, comment },
          occurredAt,
        },
        select: { id: true },
      });

      return {
        conflict: this.presentSummary(conflict),
        previousStatus: currentConflict.status,
        status: payload.status,
        eventId: event.id,
        auditLogId: auditLog.id,
      };
    });
  }

  private presentSummary(conflict: ConflictSummaryRecord) {
    return {
      id: conflict.id,
      type: conflict.conflictType,
      field: conflict.attributeKey,
      status: conflict.status,
      impact: conflict.impact,
      assetId: conflict.assetId,
      assetName: conflict.asset.name,
      administrativeStatus: conflict.asset.administrativeStatus,
      occurrenceCount: conflict.occurrenceCount,
      suggestionReason: conflict.suggestionReason,
      createdAt: conflict.createdAt,
      updatedAt: conflict.updatedAt,
    };
  }

  private buildWhere(query: QueryConflictsDto): Prisma.ConflictWhereInput {
    const search = query.search?.trim();

    return {
      status: query.status,
      impact: query.impact,
      conflictType: query.type,
      OR: search
        ? [
            { conflictType: { contains: search, mode: 'insensitive' } },
            { attributeKey: { contains: search, mode: 'insensitive' } },
            { suggestionReason: { contains: search, mode: 'insensitive' } },
            { resolutionNote: { contains: search, mode: 'insensitive' } },
            {
              asset: {
                is: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { canonicalKey: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ]
        : undefined,
    };
  }

  private buildOrderBy(query: QueryConflictsDto): Prisma.ConflictOrderByWithRelationInput {
    const direction = query.sortDirection;

    switch (query.sortBy) {
      case 'createdAt':
        return { createdAt: direction };
      case 'occurrenceCount':
        return { occurrenceCount: direction };
      case 'impact':
        return { impact: direction };
      case 'status':
        return { status: direction };
      case 'updatedAt':
      default:
        return { updatedAt: direction };
    }
  }
}
