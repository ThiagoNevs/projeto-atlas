import {
  CONFLICT_FINDING_TYPES,
  CONFLICT_REVIEW_OPTIONS,
  CONFLICT_SOURCE_TYPES,
  CONFLICT_TEMPORAL_RELATIONSHIPS,
  type ConflictFindingType,
  type ConflictObservation,
  type ConflictReviewOption,
  type ConflictSourceType,
  type ConflictTemporalContext,
} from './conflict-findings.ts';
import {
  FINDING_REVIEW_STALENESSES,
  isFindingReviewCaseId,
  isFindingReviewFindingId,
  isFindingReviewTimestamp,
  type FindingReviewStaleness,
} from './finding-review-cases.ts';

export const FINDING_REVIEW_CONTEXT_COMPARISON_REASONS = [
  'AFFECTED_ASSETS_CHANGED',
  'OBSERVATIONS_CHANGED',
  'EVIDENCE_CHANGED',
  'NETWORK_VALUE_CHANGED',
  'SOURCES_CHANGED',
  'TEMPORAL_CONTEXT_CHANGED',
  'LIMITATIONS_CHANGED',
  'REVIEW_OPTIONS_CHANGED',
  'POLICY_VERSION_CHANGED',
  'FINDING_NO_LONGER_DETECTED',
  'ASSET_UNAVAILABLE',
  'COMPARISON_AMBIGUOUS',
  'SNAPSHOT_VERSION_UNSUPPORTED',
] as const;

export type FindingReviewContextComparisonReason =
  (typeof FINDING_REVIEW_CONTEXT_COMPARISON_REASONS)[number];

export interface FindingReviewSnapshot {
  snapshotVersion: 1;
  findingId: string;
  findingType: ConflictFindingType;
  policyVersion: string;
  generatedAt: string;
  affectedAssets: Array<{ assetId: string; name: string | null }>;
  normalizedHostname: string | null;
  normalizedIp: string | null;
  observations: ConflictObservation[];
  sources: Array<{ identifier: string; type: ConflictSourceType }>;
  temporalContext: ConflictTemporalContext;
  explanation: string[];
  limitations: string[];
  reviewOptions: ConflictReviewOption[];
}

export interface FindingReviewMaterialObservation {
  assetId: string;
  attribute: ConflictObservation['attribute'];
  normalizedValue: string;
  source: string;
  sourceType: ConflictSourceType;
  evidenceId: string | null;
  observedAt: string | null;
  ingestedAt: string | null;
  current: boolean;
}

export interface FindingReviewSetDiff<T> {
  added: T[];
  removed: T[];
}

export interface FindingReviewValueDiff<T> {
  before: T;
  after: T;
}

export interface FindingReviewContextDiff {
  affectedAssets?: FindingReviewSetDiff<string>;
  observations?: FindingReviewSetDiff<FindingReviewMaterialObservation>;
  evidenceIds?: FindingReviewSetDiff<string>;
  normalizedHostname?: FindingReviewValueDiff<string | null>;
  normalizedIp?: FindingReviewValueDiff<string | null>;
  sources?: FindingReviewSetDiff<{ identifier: string; type: ConflictSourceType }>;
  temporalContext?: FindingReviewValueDiff<ConflictTemporalContext>;
  limitations?: FindingReviewSetDiff<string>;
  reviewOptions?: FindingReviewSetDiff<ConflictReviewOption>;
}

export interface FindingReviewContextComparisonResponse {
  caseId: string;
  caseVersion: number;
  comparedAt: string;
  baseline: {
    kind: 'ORIGINAL';
    findingId: string;
    policyVersion: string;
    snapshotHash: string;
  };
  current: {
    findingId: string;
    policyVersion: string;
    snapshot: FindingReviewSnapshot;
    snapshotHash: string;
  } | null;
  result: {
    staleness: FindingReviewStaleness;
    reasons: FindingReviewContextComparisonReason[];
    diff: FindingReviewContextDiff;
  };
}

const DIFF_KEYS = [
  'affectedAssets',
  'observations',
  'evidenceIds',
  'normalizedHostname',
  'normalizedIp',
  'sources',
  'temporalContext',
  'limitations',
  'reviewOptions',
] as const;

export const CONTEXT_COMPARISON_PRESENTATION: Record<
  FindingReviewStaleness,
  { headline: string; supportingCopy: string; priority: 'neutral' | 'attention' }
> = {
  CURRENT: {
    headline: 'Contexto sem mudanças materiais',
    supportingCopy:
      'A verificação não encontrou mudanças materiais desde o início da investigação.',
    priority: 'neutral',
  },
  CHANGED: {
    headline: 'Há mudanças no contexto desta investigação',
    supportingCopy: 'Revise as alterações antes de tomar uma decisão. O caso não foi atualizado.',
    priority: 'attention',
  },
  NO_LONGER_DETECTED: {
    headline: 'O problema original não é mais detectado nos dados atuais',
    supportingCopy:
      'Isso não resolve nem encerra automaticamente a investigação. O caso permanece no estado atual.',
    priority: 'attention',
  },
  ASSET_UNAVAILABLE: {
    headline: 'Parte do contexto histórico não está disponível para comparação',
    supportingCopy:
      'Um ou mais ativos históricos não possuem vínculo atual; a comparação pode estar incompleta.',
    priority: 'attention',
  },
  POLICY_VERSION_CHANGED: {
    headline: 'A regra de detecção mudou desde o início da investigação',
    supportingCopy:
      'O contexto atual foi produzido por outra versão da política. O caso original permanece preservado.',
    priority: 'attention',
  },
  REQUIRES_REFRESH: {
    headline: 'Não foi possível comparar o contexto automaticamente',
    supportingCopy: 'A comparação foi inconclusiva. Nenhuma informação do caso foi atualizada.',
    priority: 'attention',
  },
};

const REASON_LABELS: Record<FindingReviewContextComparisonReason, string> = {
  AFFECTED_ASSETS_CHANGED: 'Os ativos envolvidos mudaram.',
  OBSERVATIONS_CHANGED: 'As observações e sua proveniência mudaram.',
  EVIDENCE_CHANGED: 'As evidências associadas mudaram.',
  NETWORK_VALUE_CHANGED: 'Os valores normalizados de hostname ou IP mudaram.',
  SOURCES_CHANGED: 'As fontes que sustentam a análise mudaram.',
  TEMPORAL_CONTEXT_CHANGED: 'O período observado mudou.',
  LIMITATIONS_CHANGED: 'As limitações conhecidas mudaram.',
  REVIEW_OPTIONS_CHANGED: 'As opções de revisão sugeridas mudaram.',
  POLICY_VERSION_CHANGED: 'A versão da política de detecção mudou.',
  FINDING_NO_LONGER_DETECTED: 'O finding original não foi localizado no contexto atual.',
  ASSET_UNAVAILABLE: 'Um ativo histórico não está disponível no inventário atual.',
  COMPARISON_AMBIGUOUS: 'Mais de um finding atual corresponde ao mesmo assunto de revisão.',
  SNAPSHOT_VERSION_UNSUPPORTED: 'A versão do snapshot histórico não permite comparação automática.',
};

export function getFindingReviewContextReasonLabel(
  reason: FindingReviewContextComparisonReason,
): string {
  return REASON_LABELS[reason];
}

export function parseFindingReviewCaseContextComparison(
  value: unknown,
): FindingReviewContextComparisonResponse | null {
  if (!isRecord(value)) return null;
  const baseline = parseBaseline(value.baseline);
  const current = value.current === null ? null : parseCurrent(value.current);
  const result = parseResult(value.result);
  if (
    !isFindingReviewCaseId(value.caseId) ||
    !isPositiveInteger(value.caseVersion) ||
    !isFindingReviewTimestamp(value.comparedAt) ||
    !baseline ||
    (value.current !== null && !current) ||
    !result
  )
    return null;
  if (
    current &&
    (current.findingId !== current.snapshot.findingId ||
      current.policyVersion !== current.snapshot.policyVersion)
  )
    return null;
  if ((result.staleness === 'CURRENT' || result.staleness === 'CHANGED') && current === null) {
    return null;
  }
  if (result.staleness === 'NO_LONGER_DETECTED' && current !== null) return null;
  return {
    caseId: value.caseId,
    caseVersion: value.caseVersion,
    comparedAt: value.comparedAt,
    baseline,
    current,
    result,
  };
}

export function parseFindingReviewSnapshot(value: unknown): FindingReviewSnapshot | null {
  if (!isRecord(value) || value.snapshotVersion !== 1) return null;
  if (
    !isFindingReviewFindingId(value.findingId) ||
    !CONFLICT_FINDING_TYPES.includes(value.findingType as ConflictFindingType) ||
    !isNonEmptyString(value.policyVersion) ||
    !isFindingReviewTimestamp(value.generatedAt) ||
    !Array.isArray(value.affectedAssets) ||
    !isNullableString(value.normalizedHostname) ||
    !isNullableString(value.normalizedIp) ||
    !Array.isArray(value.observations) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.explanation) ||
    !Array.isArray(value.limitations) ||
    !Array.isArray(value.reviewOptions)
  )
    return null;
  const affectedAssets = value.affectedAssets.map(parseAffectedAsset);
  const observations = value.observations.map(parseObservation);
  const sources = value.sources.map(parseSource);
  const temporalContext = parseTemporalContext(value.temporalContext);
  const reviewOptions = value.reviewOptions.map((item) => parseEnum(item, CONFLICT_REVIEW_OPTIONS));
  if (
    affectedAssets.some((item) => item === null) ||
    observations.some((item) => item === null) ||
    sources.some((item) => item === null) ||
    !temporalContext ||
    !isStringArray(value.explanation) ||
    !isStringArray(value.limitations) ||
    reviewOptions.some((item) => item === null)
  )
    return null;
  return {
    snapshotVersion: 1,
    findingId: value.findingId,
    findingType: value.findingType as ConflictFindingType,
    policyVersion: value.policyVersion,
    generatedAt: value.generatedAt,
    affectedAssets: affectedAssets as FindingReviewSnapshot['affectedAssets'],
    normalizedHostname: value.normalizedHostname,
    normalizedIp: value.normalizedIp,
    observations: observations as ConflictObservation[],
    sources: sources as FindingReviewSnapshot['sources'],
    temporalContext,
    explanation: [...value.explanation],
    limitations: [...value.limitations],
    reviewOptions: reviewOptions as ConflictReviewOption[],
  };
}

function parseBaseline(value: unknown): FindingReviewContextComparisonResponse['baseline'] | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== 'ORIGINAL' ||
    !isFindingReviewFindingId(value.findingId) ||
    !isNonEmptyString(value.policyVersion) ||
    !isSha256(value.snapshotHash)
  )
    return null;
  return {
    kind: 'ORIGINAL',
    findingId: value.findingId,
    policyVersion: value.policyVersion,
    snapshotHash: value.snapshotHash,
  };
}

function parseCurrent(
  value: unknown,
): NonNullable<FindingReviewContextComparisonResponse['current']> | null {
  if (!isRecord(value)) return null;
  const snapshot = parseFindingReviewSnapshot(value.snapshot);
  if (
    !isFindingReviewFindingId(value.findingId) ||
    !isNonEmptyString(value.policyVersion) ||
    !snapshot ||
    !isSha256(value.snapshotHash)
  )
    return null;
  return {
    findingId: value.findingId,
    policyVersion: value.policyVersion,
    snapshot,
    snapshotHash: value.snapshotHash,
  };
}

function parseResult(value: unknown): FindingReviewContextComparisonResponse['result'] | null {
  if (!isRecord(value) || !Array.isArray(value.reasons)) return null;
  const staleness = parseEnum(value.staleness, FINDING_REVIEW_STALENESSES);
  const reasons = value.reasons.map((item) =>
    parseEnum(item, FINDING_REVIEW_CONTEXT_COMPARISON_REASONS),
  );
  const diff = parseDiff(value.diff);
  if (!staleness || reasons.some((item) => item === null) || !diff) return null;
  return {
    staleness,
    reasons: reasons as FindingReviewContextComparisonReason[],
    diff,
  };
}

function parseDiff(value: unknown): FindingReviewContextDiff | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !DIFF_KEYS.includes(key as (typeof DIFF_KEYS)[number]))
  ) {
    return null;
  }
  const diff: FindingReviewContextDiff = {};
  if (value.affectedAssets !== undefined) {
    const parsed = parseSetDiff(value.affectedAssets, parseUuid);
    if (!parsed) return null;
    diff.affectedAssets = parsed;
  }
  if (value.observations !== undefined) {
    const parsed = parseSetDiff(value.observations, parseMaterialObservation);
    if (!parsed) return null;
    diff.observations = parsed;
  }
  if (value.evidenceIds !== undefined) {
    const parsed = parseSetDiff(value.evidenceIds, parseNonEmptyString);
    if (!parsed) return null;
    diff.evidenceIds = parsed;
  }
  if (value.normalizedHostname !== undefined) {
    const parsed = parseValueDiff(value.normalizedHostname, parseNullableString, true);
    if (!parsed) return null;
    diff.normalizedHostname = parsed;
  }
  if (value.normalizedIp !== undefined) {
    const parsed = parseValueDiff(value.normalizedIp, parseNullableString, true);
    if (!parsed) return null;
    diff.normalizedIp = parsed;
  }
  if (value.sources !== undefined) {
    const parsed = parseSetDiff(value.sources, parseSource);
    if (!parsed) return null;
    diff.sources = parsed;
  }
  if (value.temporalContext !== undefined) {
    const parsed = parseValueDiff(value.temporalContext, parseTemporalContext);
    if (!parsed) return null;
    diff.temporalContext = parsed;
  }
  if (value.limitations !== undefined) {
    const parsed = parseSetDiff(value.limitations, parseString);
    if (!parsed) return null;
    diff.limitations = parsed;
  }
  if (value.reviewOptions !== undefined) {
    const parsed = parseSetDiff(value.reviewOptions, (item) =>
      parseEnum(item, CONFLICT_REVIEW_OPTIONS),
    );
    if (!parsed) return null;
    diff.reviewOptions = parsed;
  }
  return diff;
}

function parseSetDiff<T>(
  value: unknown,
  parser: (item: unknown) => T | null,
): FindingReviewSetDiff<T> | null {
  if (!isRecord(value) || !Array.isArray(value.added) || !Array.isArray(value.removed)) return null;
  const added = value.added.map(parser);
  const removed = value.removed.map(parser);
  if (added.some((item) => item === null) || removed.some((item) => item === null)) return null;
  return { added: added as T[], removed: removed as T[] };
}

function parseValueDiff<T>(
  value: unknown,
  parser: (item: unknown) => T | null,
  nullable = false,
): FindingReviewValueDiff<T> | null {
  if (
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, 'before') ||
    !Object.prototype.hasOwnProperty.call(value, 'after')
  )
    return null;
  const before = parser(value.before);
  const after = parser(value.after);
  if (
    (before === null && (!nullable || value.before !== null)) ||
    (after === null && (!nullable || value.after !== null))
  )
    return null;
  return { before: before as T, after: after as T };
}

function parseAffectedAsset(
  value: unknown,
): FindingReviewSnapshot['affectedAssets'][number] | null {
  if (!isRecord(value) || !isFindingReviewCaseId(value.assetId) || !isNullableString(value.name))
    return null;
  return { assetId: value.assetId, name: value.name };
}

function parseObservation(value: unknown): ConflictObservation | null {
  if (!isRecord(value)) return null;
  const sourceType = parseEnum(value.sourceType, CONFLICT_SOURCE_TYPES);
  if (
    !isFindingReviewCaseId(value.assetId) ||
    typeof value.value !== 'string' ||
    typeof value.normalizedValue !== 'string' ||
    (value.attribute !== 'HOSTNAME' && value.attribute !== 'IP_ADDRESS') ||
    !isNonEmptyString(value.source) ||
    !sourceType ||
    !isNullableNonEmptyString(value.evidenceId) ||
    !isNullableTimestamp(value.observedAt) ||
    !isNullableTimestamp(value.ingestedAt) ||
    typeof value.current !== 'boolean'
  )
    return null;
  return {
    assetId: value.assetId,
    value: value.value,
    normalizedValue: value.normalizedValue,
    attribute: value.attribute,
    source: value.source,
    sourceType,
    evidenceId: value.evidenceId,
    observedAt: value.observedAt,
    ingestedAt: value.ingestedAt,
    current: value.current,
  };
}

function parseMaterialObservation(value: unknown): FindingReviewMaterialObservation | null {
  if (!isRecord(value)) return null;
  const sourceType = parseEnum(value.sourceType, CONFLICT_SOURCE_TYPES);
  if (
    !isFindingReviewCaseId(value.assetId) ||
    (value.attribute !== 'HOSTNAME' && value.attribute !== 'IP_ADDRESS') ||
    typeof value.normalizedValue !== 'string' ||
    !isNonEmptyString(value.source) ||
    !sourceType ||
    !isNullableNonEmptyString(value.evidenceId) ||
    !isNullableTimestamp(value.observedAt) ||
    !isNullableTimestamp(value.ingestedAt) ||
    typeof value.current !== 'boolean'
  )
    return null;
  return {
    assetId: value.assetId,
    attribute: value.attribute,
    normalizedValue: value.normalizedValue,
    source: value.source,
    sourceType,
    evidenceId: value.evidenceId,
    observedAt: value.observedAt,
    ingestedAt: value.ingestedAt,
    current: value.current,
  };
}

function parseSource(value: unknown): FindingReviewSnapshot['sources'][number] | null {
  if (!isRecord(value) || !isNonEmptyString(value.identifier)) return null;
  const type = parseEnum(value.type, CONFLICT_SOURCE_TYPES);
  return type ? { identifier: value.identifier, type } : null;
}

function parseTemporalContext(value: unknown): ConflictTemporalContext | null {
  if (!isRecord(value)) return null;
  const relationship = parseEnum(value.relationship, CONFLICT_TEMPORAL_RELATIONSHIPS);
  if (
    !isNullableTimestamp(value.firstObservedAt) ||
    !isNullableTimestamp(value.lastObservedAt) ||
    !(
      value.differenceMilliseconds === null ||
      (typeof value.differenceMilliseconds === 'number' &&
        Number.isFinite(value.differenceMilliseconds))
    ) ||
    !relationship
  )
    return null;
  return {
    firstObservedAt: value.firstObservedAt,
    lastObservedAt: value.lastObservedAt,
    differenceMilliseconds: value.differenceMilliseconds,
    relationship,
  };
}

function parseEnum<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : null;
}

function parseUuid(value: unknown): string | null {
  return isFindingReviewCaseId(value) ? value : null;
}

function parseString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseNonEmptyString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

function parseNullableString(value: unknown): string | null {
  return isNullableString(value) ? value : null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isFindingReviewTimestamp(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
