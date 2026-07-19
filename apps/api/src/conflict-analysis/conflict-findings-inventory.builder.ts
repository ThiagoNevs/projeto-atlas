import { BadRequestException, Injectable } from '@nestjs/common';

import {
  ConflictAnalysisPolicy,
  IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
} from './conflict-analysis.policy';
import { normalizeConflictHostname, normalizeConflictIp } from './conflict-normalization';
import type { QueryConflictFindingsDto } from './dto/query-conflict-findings.dto';
import type {
  AssetIdentitySnapshot,
  ConflictFinding,
  ConflictFindingType,
} from './types/conflict-analysis';
import type {
  ConflictFindingListItem,
  ConflictFindingsPage,
} from './types/conflict-findings-inventory';

const GLOBAL_LIMITATIONS = [
  'A análise opera em modo sombra, não cria conflitos formais e não altera o inventário.',
  'Os achados são recalculados a partir do estado atual do banco e não são persistidos.',
  'As opções de revisão são possibilidades sem seleção, recomendação ou resolução aplicada.',
  'O contexto temporal descreve observações e não confirma simultaneidade operacional.',
  'IPv6 legado pode não ser correlacionado quando representações persistidas diferentes não são alcançadas pela consulta individual dirigida.',
  'Nome curto e FQDN permanecem identidades distintas; FQDN absoluto terminado em ponto é rejeitado.',
  'Identificadores técnicos adicionais ainda não participam desta política de correlação.',
];

const FINDING_TYPES: ConflictFindingType[] = [
  'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  'SHARED_IP_DIFFERENT_HOSTNAMES',
  'HOSTNAME_DIVERGENCE_ON_ASSET',
];

export interface ConflictFindingAssetReference {
  assetId: string;
  persistedName: string;
}

@Injectable()
export class ConflictFindingsInventoryBuilder {
  constructor(private readonly policy: ConflictAnalysisPolicy) {}

  build(
    snapshots: AssetIdentitySnapshot[],
    assets: ConflictFindingAssetReference[],
    query: QueryConflictFindingsDto,
  ): ConflictFindingsPage {
    const orderedSnapshots = [...snapshots].sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    );
    const normalizedHostname = query.hostname ? normalizeConflictHostname(query.hostname) : null;
    const normalizedIp = query.ip ? normalizeConflictIp(query.ip) : null;
    if (query.hostname && !normalizedHostname) {
      throw new BadRequestException('hostname must be a valid hostname');
    }
    if (query.ip && !normalizedIp) {
      throw new BadRequestException('ip must be a valid IPv4 or IPv6 address');
    }

    const findings = this.collectFindings(orderedSnapshots);

    const assetNames = new Map(assets.map((asset) => [asset.assetId, asset.persistedName]));
    const filtered = [...findings.values()].filter((finding) =>
      this.matches(finding, query, normalizedHostname, normalizedIp),
    );
    const ordered = filtered.sort((left, right) => this.compare(left, right, query));
    const totalItems = ordered.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize);
    const offset = (query.page - 1) * query.pageSize;
    const pageFindings = ordered.slice(offset, offset + query.pageSize);

    return {
      mode: 'SHADOW',
      policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
      generatedAt: this.generatedAt(orderedSnapshots),
      decisionsChanged: false,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1 && totalPages > 0,
      },
      filters: {
        type: query.type ?? null,
        assetId: query.assetId ?? null,
        hostname: normalizedHostname,
        ip: normalizedIp,
        sourceType: query.sourceType ?? null,
        temporalRelationship: query.temporalRelationship ?? null,
        hasLimitations: query.hasLimitations ?? null,
      },
      summary: this.summary(filtered),
      items: pageFindings.map((finding) => this.listItem(finding, assetNames)),
      limitations: [...GLOBAL_LIMITATIONS],
    };
  }

  findById(snapshots: AssetIdentitySnapshot[], findingId: string): ConflictFinding | null {
    const orderedSnapshots = [...snapshots].sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    );
    return this.collectFindings(orderedSnapshots).get(findingId) ?? null;
  }

  generatedAtFor(snapshots: AssetIdentitySnapshot[]): string {
    return this.generatedAt(snapshots);
  }

  private collectFindings(snapshots: AssetIdentitySnapshot[]): Map<string, ConflictFinding> {
    const findings = new Map<string, ConflictFinding>();
    for (const assetId of this.candidateAssetIds(snapshots)) {
      const analysis = this.policy.analyze(assetId, snapshots);
      for (const finding of analysis.findings) {
        if (!findings.has(finding.findingId)) findings.set(finding.findingId, finding);
      }
    }
    return findings;
  }

  private candidateAssetIds(snapshots: AssetIdentitySnapshot[]): string[] {
    const hostnameIndex = new Map<string, Set<string>>();
    const ipIndex = new Map<string, Set<string>>();
    const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.assetId, snapshot]));
    const candidates = new Set<string>();

    for (const snapshot of snapshots) {
      const hostnames = new Set(
        snapshot.hostnameObservations.map((item) => item.normalizedValue).filter(Boolean),
      );
      if (hostnames.size > 1) candidates.add(snapshot.assetId);
      for (const hostname of hostnames) this.addToIndex(hostnameIndex, hostname, snapshot.assetId);
      for (const ip of new Set(snapshot.ipObservations.map((item) => item.normalizedValue))) {
        if (ip) this.addToIndex(ipIndex, ip, snapshot.assetId);
      }
    }

    for (const assetIds of hostnameIndex.values()) {
      if (assetIds.size > 1) candidates.add([...assetIds].sort()[0] as string);
    }
    for (const assetIds of ipIndex.values()) {
      const hostnames = new Set(
        [...assetIds].flatMap((assetId) =>
          (snapshotsById.get(assetId)?.hostnameObservations ?? []).map(
            (item) => item.normalizedValue,
          ),
        ),
      );
      if (hostnames.size > 1) candidates.add([...assetIds].sort()[0] as string);
    }

    return [...candidates].sort();
  }

  private addToIndex(index: Map<string, Set<string>>, key: string, assetId: string): void {
    const values = index.get(key) ?? new Set<string>();
    values.add(assetId);
    index.set(key, values);
  }

  private matches(
    finding: ConflictFinding,
    query: QueryConflictFindingsDto,
    hostname: string | null,
    ip: string | null,
  ): boolean {
    if (query.type && finding.type !== query.type) return false;
    if (query.assetId && !finding.affectedAssetIds.includes(query.assetId)) return false;
    if (
      hostname &&
      finding.normalizedHostname !== hostname &&
      !finding.observations.some(
        (item) => item.attribute === 'HOSTNAME' && item.normalizedValue === hostname,
      )
    ) {
      return false;
    }
    if (
      ip &&
      finding.normalizedIp !== ip &&
      !finding.observations.some(
        (item) => item.attribute === 'IP_ADDRESS' && item.normalizedValue === ip,
      )
    ) {
      return false;
    }
    if (
      query.sourceType &&
      !finding.observations.some((item) => item.sourceType === query.sourceType)
    ) {
      return false;
    }
    if (
      query.temporalRelationship &&
      finding.temporalContext.relationship !== query.temporalRelationship
    ) {
      return false;
    }
    if (
      query.hasLimitations !== undefined &&
      finding.limitations.length > 0 !== query.hasLimitations
    ) {
      return false;
    }
    return true;
  }

  private compare(
    left: ConflictFinding,
    right: ConflictFinding,
    query: QueryConflictFindingsDto,
  ): number {
    const leftValue = this.sortValue(left, query.sortBy);
    const rightValue = this.sortValue(right, query.sortBy);
    const primary =
      typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
    if (primary !== 0) return query.sortDirection === 'asc' ? primary : -primary;
    return this.defaultIdentity(left).localeCompare(this.defaultIdentity(right));
  }

  private sortValue(finding: ConflictFinding, sortBy: QueryConflictFindingsDto['sortBy']) {
    switch (sortBy) {
      case 'affectedAssets':
        return finding.affectedAssetIds.length;
      case 'observationCount':
        return finding.observations.length;
      case 'firstObservedAt':
        return finding.temporalContext.firstObservedAt ?? '';
      case 'lastObservedAt':
        return finding.temporalContext.lastObservedAt ?? '';
      case 'findingId':
        return finding.findingId;
      case 'type':
      default:
        return finding.type;
    }
  }

  private defaultIdentity(finding: ConflictFinding): string {
    return [
      finding.type,
      finding.affectedAssetIds[0] ?? '',
      finding.normalizedHostname ?? finding.normalizedIp ?? '',
      finding.findingId,
    ].join(':');
  }

  private summary(findings: ConflictFinding[]): ConflictFindingsPage['summary'] {
    const byType = Object.fromEntries(FINDING_TYPES.map((type) => [type, 0])) as Record<
      ConflictFindingType,
      number
    >;
    const affectedAssets = new Set<string>();
    let findingsWithLimitations = 0;
    for (const finding of findings) {
      byType[finding.type] += 1;
      finding.affectedAssetIds.forEach((assetId) => affectedAssets.add(assetId));
      if (finding.limitations.length > 0) findingsWithLimitations += 1;
    }
    return {
      totalFindings: findings.length,
      byType,
      affectedAssets: affectedAssets.size,
      findingsWithLimitations,
    };
  }

  private listItem(
    finding: ConflictFinding,
    assetNames: Map<string, string>,
  ): ConflictFindingListItem {
    const sourceTypes = [...new Set(finding.observations.map((item) => item.sourceType))].sort();
    const currentObservationCount = finding.observations.filter((item) => item.current).length;
    return {
      findingId: finding.findingId,
      type: finding.type,
      requiresHumanReview: true,
      affectedAssetIds: finding.affectedAssetIds,
      affectedAssets: finding.affectedAssetIds.map((assetId) => ({
        assetId,
        persistedName: assetNames.get(assetId) ?? 'Ativo não localizado',
      })),
      normalizedHostname: finding.normalizedHostname,
      normalizedIp: finding.normalizedIp,
      temporalContext: finding.temporalContext,
      sourceTypes,
      observationCount: finding.observations.length,
      currentObservationCount,
      historicalObservationCount: finding.observations.length - currentObservationCount,
      explanationSummary: finding.explanation[0] ?? 'Achado derivado para revisão humana.',
      limitationCount: finding.limitations.length,
      reviewOptions: finding.reviewOptions,
    };
  }

  private generatedAt(snapshots: AssetIdentitySnapshot[]): string {
    const timestamps = snapshots
      .flatMap((snapshot) => [
        snapshot.snapshotAt,
        ...snapshot.hostnameObservations.flatMap((item) => [item.observedAt, item.ingestedAt]),
        ...snapshot.ipObservations.flatMap((item) => [item.observedAt, item.ingestedAt]),
      ])
      .filter((item): item is string => Boolean(item))
      .map((item) => new Date(item).getTime())
      .filter(Number.isFinite);
    return timestamps.length
      ? new Date(Math.max(...timestamps)).toISOString()
      : new Date(0).toISOString();
  }
}
