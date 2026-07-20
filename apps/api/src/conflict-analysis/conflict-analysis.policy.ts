import { createConflictFindingId } from './conflict-finding-id';
import {
  AssetIdentitySnapshot,
  ConflictFinding,
  ConflictFindingType,
  ConflictObservation,
  ConflictReviewOption,
  ConflictTemporalContext,
  IdentityNetworkAnalysis,
} from './types/conflict-analysis';

export const IDENTITY_NETWORK_CONFLICT_POLICY_VERSION = '2026-07-conflict-v1';

const BASE_LIMITATIONS = [
  'A análise opera em modo sombra e não altera o inventário.',
  'Os achados são indícios derivados e precisam de revisão humana.',
  'Nenhuma janela temporal arbitrária é usada para afirmar simultaneidade ou reutilização.',
];

export class ConflictAnalysisPolicy {
  analyze(assetId: string, snapshots: AssetIdentitySnapshot[]): IdentityNetworkAnalysis {
    const orderedSnapshots = [...snapshots].sort((left, right) =>
      left.assetId.localeCompare(right.assetId),
    );
    const target = orderedSnapshots.find((snapshot) => snapshot.assetId === assetId);
    const findings = target ? this.detectFindings(target, orderedSnapshots) : [];
    const generatedAt = this.latestSnapshotTime(orderedSnapshots);
    const limitations = this.uniqueSorted([
      ...BASE_LIMITATIONS,
      ...(target?.limitations ?? []),
      ...(findings.length === 0
        ? ['Nenhuma incompatibilidade foi derivada a partir das observações disponíveis.']
        : []),
    ]);

    return {
      assetId,
      mode: 'SHADOW',
      policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
      generatedAt,
      summary: {
        totalFindings: findings.length,
        requiresHumanReview: findings.length,
      },
      findings,
      limitations,
      decisionsChanged: false,
    };
  }

  private detectFindings(
    target: AssetIdentitySnapshot,
    snapshots: AssetIdentitySnapshot[],
  ): ConflictFinding[] {
    const findings: ConflictFinding[] = [];
    const targetHostnames = new Set(
      target.hostnameObservations.map((item) => item.normalizedValue).filter(Boolean),
    );
    const targetIps = new Set(
      target.ipObservations.map((item) => item.normalizedValue).filter(Boolean),
    );

    for (const hostname of [...targetHostnames].sort()) {
      const observations = snapshots.flatMap((snapshot) =>
        snapshot.hostnameObservations.filter((item) => item.normalizedValue === hostname),
      );
      if (new Set(observations.map((item) => item.assetId)).size > 1) {
        findings.push(
          this.finding(
            'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
            hostname,
            null,
            observations,
            [
              `O hostname ${hostname} foi associado a ativos diferentes.`,
              'O hostname é um forte sinal de identidade, mas não comprova sozinho que os registros representam o mesmo ativo.',
              'Nenhuma mesclagem ou alteração foi realizada.',
            ],
            ['SAME_ASSET', 'DIFFERENT_ASSETS', 'SOURCE_DATA_INCORRECT', 'NEEDS_MORE_EVIDENCE'],
          ),
        );
      }
    }

    const distinctTargetHostnames = [...targetHostnames].sort();
    if (distinctTargetHostnames.length > 1) {
      findings.push(
        this.finding(
          'HOSTNAME_DIVERGENCE_ON_ASSET',
          null,
          null,
          target.hostnameObservations.filter((item) =>
            distinctTargetHostnames.includes(item.normalizedValue),
          ),
          [
            `O ativo possui hostnames observados diferentes: ${distinctTargetHostnames.join(', ')}.`,
            'O hostname observado diverge de outro valor registrado para o mesmo ativo.',
            'Nenhuma atualização foi aplicada ao valor persistido.',
          ],
          ['HOSTNAME_CHANGED', 'SOURCE_DATA_INCORRECT', 'NEEDS_MORE_EVIDENCE'],
        ),
      );
    }

    for (const ip of [...targetIps].sort()) {
      const relatedSnapshots = snapshots.filter((snapshot) =>
        snapshot.ipObservations.some((item) => item.normalizedValue === ip),
      );
      const relatedHostnames = new Set(
        relatedSnapshots.flatMap((snapshot) =>
          snapshot.hostnameObservations.map((item) => item.normalizedValue).filter(Boolean),
        ),
      );
      if (relatedHostnames.size <= 1) continue;

      const affectedIds = new Set(relatedSnapshots.map((snapshot) => snapshot.assetId));
      const observations = relatedSnapshots.flatMap((snapshot) => [
        ...snapshot.ipObservations.filter((item) => item.normalizedValue === ip),
        ...snapshot.hostnameObservations.filter((item) => affectedIds.has(item.assetId)),
      ]);
      findings.push(
        this.finding(
          'SHARED_IP_DIFFERENT_HOSTNAMES',
          null,
          ip,
          observations,
          [
            `O IP ${ip} foi observado com hostnames distintos.`,
            'O compartilhamento de IP não comprova que os registros representam o mesmo ativo.',
            'O cenário pode envolver DHCP, reutilização de IP, mudança de hostname, dados históricos ou erro de origem.',
            'Nenhuma identidade foi unida e nenhuma resolução foi aplicada.',
          ],
          [
            'SAME_ASSET',
            'DIFFERENT_ASSETS',
            'IP_REUSED',
            'HOSTNAME_CHANGED',
            'SOURCE_DATA_INCORRECT',
            'NEEDS_MORE_EVIDENCE',
          ],
        ),
      );
    }

    return findings.sort((left, right) =>
      `${left.type}:${left.findingId}`.localeCompare(`${right.type}:${right.findingId}`),
    );
  }

  private finding(
    type: ConflictFindingType,
    normalizedHostname: string | null,
    normalizedIp: string | null,
    inputObservations: ConflictObservation[],
    explanation: string[],
    reviewOptions: ConflictReviewOption[],
  ): ConflictFinding {
    const observations = this.uniqueObservations(inputObservations);
    const temporalContext = this.temporalContext(observations);
    const limitations = this.findingLimitations(observations, temporalContext);
    const affectedAssetIds = [...new Set(observations.map((item) => item.assetId))].sort();
    const identity = JSON.stringify({
      type,
      affectedAssetIds,
      normalizedHostname,
      normalizedIp,
      observations: observations.map((item) => [
        item.assetId,
        item.attribute,
        item.normalizedValue,
        item.source,
        item.evidenceId,
        item.observedAt,
        item.current,
      ]),
    });

    return {
      findingId: createConflictFindingId(identity),
      type,
      mode: 'SHADOW',
      requiresHumanReview: true,
      affectedAssetIds,
      normalizedHostname,
      normalizedIp,
      observations,
      temporalContext,
      explanation,
      limitations,
      reviewOptions,
    };
  }

  private uniqueObservations(observations: ConflictObservation[]): ConflictObservation[] {
    const unique = new Map<string, ConflictObservation>();
    for (const observation of observations) {
      const key = JSON.stringify([
        observation.assetId,
        observation.attribute,
        observation.normalizedValue,
        observation.source,
        observation.sourceType,
        observation.evidenceId,
        observation.observedAt,
        observation.ingestedAt,
        observation.current,
      ]);
      if (!unique.has(key)) unique.set(key, observation);
    }
    return [...unique.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }

  private temporalContext(observations: ConflictObservation[]): ConflictTemporalContext {
    const timestamps = observations
      .map((item) => item.observedAt)
      .filter((item): item is string => Boolean(item))
      .map((item) => new Date(item).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right);

    if (timestamps.length === 0) {
      return {
        firstObservedAt: null,
        lastObservedAt: null,
        differenceMilliseconds: null,
        relationship: 'NO_TEMPORAL_CONTEXT',
      };
    }

    const first = timestamps[0] as number;
    const last = timestamps[timestamps.length - 1] as number;
    const complete = timestamps.length === observations.length;
    return {
      firstObservedAt: new Date(first).toISOString(),
      lastObservedAt: new Date(last).toISOString(),
      differenceMilliseconds: last - first,
      relationship: !complete
        ? 'PARTIAL_TEMPORAL_CONTEXT'
        : first === last
          ? 'SAME_OBSERVATION_TIME'
          : 'DISTINCT_OBSERVATION_TIMES',
    };
  }

  private findingLimitations(
    observations: ConflictObservation[],
    temporalContext: ConflictTemporalContext,
  ): string[] {
    const limitations: string[] = [];
    if (temporalContext.relationship === 'NO_TEMPORAL_CONTEXT') {
      limitations.push(
        'Não há contexto temporal suficiente para distinguir concorrência, reutilização ou observações históricas.',
      );
    } else if (temporalContext.relationship === 'PARTIAL_TEMPORAL_CONTEXT') {
      limitations.push(
        'O contexto temporal é parcial e não permite comprovar simultaneidade ou reutilização.',
      );
    } else {
      limitations.push(
        'Os timestamps descrevem a distância entre observações, mas não comprovam simultaneidade operacional nem reutilização.',
      );
    }
    if (observations.some((item) => item.sourceType === 'SIMULATED')) {
      limitations.push('O achado inclui fonte simulada, mantida apenas como contexto do MVP.');
    }
    if (observations.some((item) => item.sourceType === 'UNKNOWN')) {
      limitations.push('O achado inclui observação cuja categoria de fonte é desconhecida.');
    }
    if (observations.some((item) => !item.current)) {
      limitations.push(
        'A divergência inclui observação histórica e pode representar uma alteração legítima ao longo do tempo.',
      );
    }
    const hostnames = observations
      .filter((item) => item.attribute === 'HOSTNAME')
      .map((item) => item.normalizedValue);
    if (hostnames.some((value) => value.includes('.')) && hostnames.some((value) => !value.includes('.'))) {
      limitations.push(
        'Nome curto e FQDN são mantidos como valores distintos; nenhuma equivalência automática foi aplicada.',
      );
    }
    return this.uniqueSorted(limitations);
  }

  private latestSnapshotTime(snapshots: AssetIdentitySnapshot[]): string {
    const timestamps = snapshots
      .flatMap((snapshot) => [
        snapshot.snapshotAt,
        ...snapshot.hostnameObservations.flatMap((item) => [item.observedAt, item.ingestedAt]),
        ...snapshot.ipObservations.flatMap((item) => [item.observedAt, item.ingestedAt]),
      ])
      .filter((item): item is string => Boolean(item))
      .map((item) => new Date(item).getTime())
      .filter(Number.isFinite);
    return new Date(Math.max(...timestamps)).toISOString();
  }

  private uniqueSorted(values: string[]): string[] {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }
}
