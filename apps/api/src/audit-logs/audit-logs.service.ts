import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

const auditLogSelect = {
  id: true,
  actorType: true,
  actorId: true,
  action: true,
  entityType: true,
  entityId: true,
  before: true,
  after: true,
  metadata: true,
  occurredAt: true,
} satisfies Prisma.AuditLogSelect;

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryAuditLogsDto) {
    this.validateDateRange(query);
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [
      total,
      items,
      allAuditLogs,
      administrativeChanges,
      conflictTreatments,
      discoveryExecutions,
      failuresOrRejections,
    ] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        select: auditLogSelect,
        orderBy: [this.buildOrderBy(query), { id: 'asc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({ where: { action: 'ADMIN_STATUS_CHANGED' } }),
      this.prisma.auditLog.count({ where: { action: 'CONFLICT_STATUS_CHANGED' } }),
      this.prisma.auditLog.count({ where: { action: 'NETWORK_DISCOVERY_RUN_EXECUTED' } }),
      this.prisma.auditLog.count({
        where: {
          action: {
            in: ['NETWORK_DISCOVERY_RUN_FAILED', 'NETWORK_DISCOVERY_RUN_REJECTED'],
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
      summary: {
        total: allAuditLogs,
        administrativeChanges,
        conflictTreatments,
        discoveryExecutions,
        failuresOrRejections,
      },
    };
  }

  async findOne(id: string) {
    const auditLog = await this.prisma.auditLog.findUnique({
      where: { id },
      select: auditLogSelect,
    });

    if (!auditLog) throw new NotFoundException(`Audit log ${id} was not found.`);
    return auditLog;
  }

  private buildWhere(query: QueryAuditLogsDto): Prisma.AuditLogWhereInput {
    const search = query.search?.trim();

    return {
      action: query.action,
      actorType: query.actorType,
      entityType: query.entityType,
      entityId: query.entityId,
      occurredAt:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
      OR: search
        ? [
            { action: { contains: search, mode: 'insensitive' } },
            { actorId: { contains: search, mode: 'insensitive' } },
            { entityType: { contains: search, mode: 'insensitive' } },
            { entityId: { contains: search, mode: 'insensitive' } },
            {
              metadata: {
                path: ['reason'],
                string_contains: search,
                mode: 'insensitive',
              },
            },
            {
              metadata: {
                path: ['comment'],
                string_contains: search,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
  }

  private buildOrderBy(query: QueryAuditLogsDto): Prisma.AuditLogOrderByWithRelationInput {
    return { [query.sortBy]: query.sortDirection };
  }

  private validateDateRange(query: QueryAuditLogsDto): void {
    if (query.dateFrom && query.dateTo && new Date(query.dateFrom) > new Date(query.dateTo)) {
      throw new BadRequestException('dateFrom must be before or equal to dateTo.');
    }
  }
}
