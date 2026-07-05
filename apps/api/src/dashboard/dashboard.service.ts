import { Injectable } from '@nestjs/common';

import {
  AdministrativeStatus,
  ConflictStatus,
  OperationalStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const LOW_SCORE_THRESHOLD = 60;
const CLOSED_ADMINISTRATIVE_STATUSES: AdministrativeStatus[] = [
  AdministrativeStatus.DEACTIVATED,
  AdministrativeStatus.DISCARDED,
  AdministrativeStatus.LOST,
  AdministrativeStatus.STOLEN,
  AdministrativeStatus.ARCHIVED,
];
const ACTIONABLE_CONFLICT_STATUSES: ConflictStatus[] = [
  ConflictStatus.OPEN,
  ConflictStatus.IN_REVIEW,
];
const OPERATING_SYSTEM_KEYS = new Set(['OPERATINGSYSTEM', 'OS']);
const OPERATING_SYSTEM_VERSION_KEYS = new Set(['OSVERSION', 'OPERATINGSYSTEMVERSION']);
const LINUX_IDENTIFIERS = [
  'linux',
  'ubuntu',
  'debian',
  'red hat',
  'rhel',
  'centos',
  'rocky',
  'alma',
];

type CurrentAttribute = {
  key: string;
  value: unknown;
  valueText: string | null;
};

function normalizeAttributeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function attributeText(attribute: CurrentAttribute | undefined): string | null {
  if (!attribute) return null;
  if (attribute.valueText?.trim()) return attribute.valueText.trim();
  if (typeof attribute.value === 'string' && attribute.value.trim()) return attribute.value.trim();
  return null;
}

function findAttribute(attributes: CurrentAttribute[], keys: Set<string>): string | null {
  return attributeText(
    attributes.find((attribute) => keys.has(normalizeAttributeKey(attribute.key))),
  );
}

function operatingSystemFamily(operatingSystem: string | null): string {
  if (!operatingSystem) return 'Não identificado';

  const normalized = operatingSystem.toLocaleLowerCase('pt-BR');
  if (normalized.includes('windows')) return 'Windows';
  if (normalized.includes('macos') || normalized.includes('mac os')) return 'macOS';
  if (LINUX_IDENTIFIERS.some((identifier) => normalized.includes(identifier))) return 'Linux';
  return operatingSystem;
}

function operatingSystemVersionLabel(
  operatingSystem: string | null,
  version: string | null,
): string | null {
  if (!operatingSystem && !version) return null;
  if (!operatingSystem) return `Sistema não identificado ${version}`;
  if (
    !version ||
    operatingSystem.toLocaleLowerCase('pt-BR').includes(version.toLocaleLowerCase('pt-BR'))
  ) {
    return operatingSystem;
  }
  return `${operatingSystem} ${version}`;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      totalAssets,
      seenRecently,
      lowDataQuality,
      lowConfidence,
      administrativelyClosed,
      administrativeGroups,
      operationalGroups,
      typeGroups,
      totalOpenConflicts,
      conflictsInReview,
      highImpactConflicts,
      criticalImpactConflicts,
      lifecycleConflicts,
      assetsWithOperatingSystemAttributes,
      totalDiscoveryRuns,
      lastDiscoveryRun,
      recentActivity,
    ] = await Promise.all([
      this.prisma.asset.count(),
      this.prisma.asset.count({
        where: { operationalStatus: OperationalStatus.SEEN_RECENTLY },
      }),
      this.prisma.asset.count({
        where: {
          OR: [{ dataQualityScore: { lt: LOW_SCORE_THRESHOLD } }, { dataQualityScore: null }],
        },
      }),
      this.prisma.asset.count({
        where: {
          OR: [{ confidenceScore: { lt: LOW_SCORE_THRESHOLD } }, { confidenceScore: null }],
        },
      }),
      this.prisma.asset.count({
        where: { administrativeStatus: { in: CLOSED_ADMINISTRATIVE_STATUSES } },
      }),
      this.prisma.asset.groupBy({
        by: ['administrativeStatus'],
        _count: { _all: true },
        orderBy: { administrativeStatus: 'asc' },
      }),
      this.prisma.asset.groupBy({
        by: ['operationalStatus'],
        _count: { _all: true },
        orderBy: { operationalStatus: 'asc' },
      }),
      this.prisma.asset.groupBy({
        by: ['kind'],
        _count: { _all: true },
        orderBy: { kind: 'asc' },
      }),
      this.prisma.conflict.count({ where: { status: ConflictStatus.OPEN } }),
      this.prisma.conflict.count({ where: { status: ConflictStatus.IN_REVIEW } }),
      this.prisma.conflict.count({
        where: { status: { in: ACTIONABLE_CONFLICT_STATUSES }, impact: 'HIGH' },
      }),
      this.prisma.conflict.count({
        where: { status: { in: ACTIONABLE_CONFLICT_STATUSES }, impact: 'CRITICAL' },
      }),
      this.prisma.conflict.count({
        where: { status: ConflictStatus.OPEN, conflictType: 'LIFECYCLE_CONFLICT' },
      }),
      this.prisma.asset.findMany({
        select: {
          attributes: {
            where: { isCurrent: true },
            orderBy: [{ lastConfirmedAt: 'desc' }, { observedAt: 'desc' }],
            select: { key: true, value: true, valueText: true },
          },
        },
      }),
      this.prisma.networkDiscoveryRun.count(),
      this.prisma.networkDiscoveryRun.findFirst({
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: {
          status: true,
          startedAt: true,
          discoveredCount: true,
          createdAssetCount: true,
          updatedAssetCount: true,
        },
      }),
      this.prisma.assetEvent.findMany({
        orderBy: [{ occurredAt: 'desc' }, { recordedAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          assetId: true,
          eventType: true,
          title: true,
          occurredAt: true,
          asset: { select: { name: true } },
        },
      }),
    ]);

    const byOperatingSystem: Record<string, number> = {};
    const byOperatingSystemVersion: Record<string, number> = {};

    assetsWithOperatingSystemAttributes.forEach((asset) => {
      const operatingSystem = findAttribute(asset.attributes, OPERATING_SYSTEM_KEYS);
      const version = findAttribute(asset.attributes, OPERATING_SYSTEM_VERSION_KEYS);
      incrementCount(byOperatingSystem, operatingSystemFamily(operatingSystem));

      const versionLabel = operatingSystemVersionLabel(operatingSystem, version);
      if (versionLabel) incrementCount(byOperatingSystemVersion, versionLabel);
    });

    return {
      assets: {
        total: totalAssets,
        seenRecently,
        lowDataQuality,
        lowConfidence,
        administrativelyClosed,
        byAdministrativeStatus: Object.fromEntries(
          administrativeGroups.map((group) => [group.administrativeStatus, group._count._all]),
        ),
        byOperationalStatus: Object.fromEntries(
          operationalGroups.map((group) => [group.operationalStatus, group._count._all]),
        ),
        byType: Object.fromEntries(typeGroups.map((group) => [group.kind, group._count._all])),
        byOperatingSystem,
        byOperatingSystemVersion,
      },
      conflicts: {
        totalOpen: totalOpenConflicts,
        inReview: conflictsInReview,
        highImpact: highImpactConflicts,
        criticalImpact: criticalImpactConflicts,
        lifecycleConflicts,
      },
      networkDiscovery: {
        totalRuns: totalDiscoveryRuns,
        lastRunStatus: lastDiscoveryRun?.status ?? null,
        lastRunAt: lastDiscoveryRun?.startedAt ?? null,
        lastRunDiscoveredCount: lastDiscoveryRun?.discoveredCount ?? 0,
        lastRunCreatedAssetCount: lastDiscoveryRun?.createdAssetCount ?? 0,
        lastRunUpdatedAssetCount: lastDiscoveryRun?.updatedAssetCount ?? 0,
      },
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        assetId: event.assetId,
        assetName: event.asset.name,
        eventType: event.eventType,
        title: event.title,
        occurredAt: event.occurredAt,
      })),
      recommendedActions: [
        {
          id: 'review-open-conflicts',
          title: 'Revisar conflitos abertos',
          description: `${totalOpenConflicts} conflito(s) aguardando tratamento.`,
          href: '/conflicts',
          count: totalOpenConflicts,
        },
        {
          id: 'review-low-quality-assets',
          title: 'Revisar ativos com baixa qualidade',
          description: `${lowDataQuality} ativo(s) abaixo do nível mínimo de qualidade.`,
          href: '/assets',
          count: lowDataQuality,
        },
        {
          id: 'review-reappeared-assets',
          title: 'Revisar ativos encerrados que reapareceram',
          description: `${lifecycleConflicts} conflito(s) de ciclo de vida aberto(s).`,
          href: '/conflicts',
          count: lifecycleConflicts,
        },
        {
          id: 'run-network-discovery',
          title: 'Executar descoberta de rede simulada',
          description: 'Use apenas perfis privados e controlados do MVP.',
          href: '/network-discovery',
          count: null,
        },
      ],
    };
  }
}
