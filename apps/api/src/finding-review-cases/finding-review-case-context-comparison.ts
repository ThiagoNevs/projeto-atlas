import type {
  ConflictFinding,
  ConflictFindingType,
  ConflictObservation,
  ConflictReviewOption,
  ConflictSourceType,
  ConflictTemporalContext,
} from '../conflict-analysis/types/conflict-analysis';
import { FindingReviewStaleness } from '../generated/prisma/client';
import {
  canonicalSerialize,
  compareCanonicalStrings,
  FINDING_REVIEW_SNAPSHOT_VERSION,
  reviewSubjectKey,
  type FindingReviewSnapshot,
} from './finding-review-case-creation';

const FINDING_TYPES: readonly ConflictFindingType[] = [
  'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  'SHARED_IP_DIFFERENT_HOSTNAMES',
  'HOSTNAME_DIVERGENCE_ON_ASSET',
];

const SOURCE_TYPES: readonly ConflictSourceType[] = ['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN'];

const REVIEW_OPTIONS: readonly ConflictReviewOption[] = [
  'SAME_ASSET',
  'DIFFERENT_ASSETS',
  'IP_REUSED',
  'HOSTNAME_CHANGED',
  'SOURCE_DATA_INCORRECT',
  'NEEDS_MORE_EVIDENCE',
];

const TEMPORAL_RELATIONSHIPS: readonly ConflictTemporalContext['relationship'][] = [
  'SAME_OBSERVATION_TIME',
  'DISTINCT_OBSERVATION_TIMES',
  'PARTIAL_TEMPORAL_CONTEXT',
  'NO_TEMPORAL_CONTEXT',
];

export type FindingReviewContextComparisonReason =
  | 'AFFECTED_ASSETS_CHANGED'
  | 'OBSERVATIONS_CHANGED'
  | 'EVIDENCE_CHANGED'
  | 'NETWORK_VALUE_CHANGED'
  | 'SOURCES_CHANGED'
  | 'TEMPORAL_CONTEXT_CHANGED'
  | 'LIMITATIONS_CHANGED'
  | 'REVIEW_OPTIONS_CHANGED'
  | 'POLICY_VERSION_CHANGED'
  | 'FINDING_NO_LONGER_DETECTED'
  | 'ASSET_UNAVAILABLE'
  | 'COMPARISON_AMBIGUOUS'
  | 'SNAPSHOT_VERSION_UNSUPPORTED';

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

interface SetDiff<T> {
  added: T[];
  removed: T[];
}

interface ValueDiff<T> {
  before: T;
  after: T;
}

export interface FindingReviewContextDiff {
  affectedAssets?: SetDiff<string>;
  observations?: SetDiff<FindingReviewMaterialObservation>;
  evidenceIds?: SetDiff<string>;
  normalizedHostname?: ValueDiff<string | null>;
  normalizedIp?: ValueDiff<string | null>;
  sources?: SetDiff<{ identifier: string; type: ConflictSourceType }>;
  temporalContext?: ValueDiff<ConflictTemporalContext>;
  limitations?: SetDiff<string>;
  reviewOptions?: SetDiff<ConflictReviewOption>;
}

export interface FindingReviewComparableResult {
  staleness: FindingReviewStaleness;
  reasons: FindingReviewContextComparisonReason[];
  diff: FindingReviewContextDiff;
}

export type FindingReviewSnapshotInspection =
  | { kind: 'supported'; snapshot: FindingReviewSnapshot }
  | { kind: 'unsupported-version'; snapshotVersion: number };

export function inspectFindingReviewSnapshot(value: unknown): FindingReviewSnapshotInspection {
  if (!isRecord(value) || typeof value.snapshotVersion !== 'number') {
    throw new Error('O snapshot histórico do caso é inválido.');
  }
  if (value.snapshotVersion !== FINDING_REVIEW_SNAPSHOT_VERSION) {
    return { kind: 'unsupported-version', snapshotVersion: value.snapshotVersion };
  }
  if (!isFindingReviewSnapshot(value)) {
    throw new Error('O snapshot histórico do caso é inválido.');
  }
  return { kind: 'supported', snapshot: value };
}

export function compareFindingReviewContexts(input: {
  baseline: FindingReviewSnapshot;
  current: FindingReviewSnapshot;
  reviewSubjectKey: string;
}): FindingReviewComparableResult {
  const baselineSubjectKey = snapshotReviewSubjectKey(input.baseline);
  const currentSubjectKey = snapshotReviewSubjectKey(input.current);
  if (
    baselineSubjectKey !== input.reviewSubjectKey ||
    currentSubjectKey !== input.reviewSubjectKey
  ) {
    throw new Error('O snapshot não corresponde ao assunto de revisão informado.');
  }
  const before = materialProjection(input.baseline, baselineSubjectKey);
  const after = materialProjection(input.current, currentSubjectKey);
  const reasons: FindingReviewContextComparisonReason[] = [];
  const diff: FindingReviewContextDiff = {};

  addSetDifference(
    before.affectedAssetIds,
    after.affectedAssetIds,
    'AFFECTED_ASSETS_CHANGED',
    'affectedAssets',
    reasons,
    diff,
  );

  const observationDiff = structuredSetDiff(before.observations, after.observations);
  if (hasSetDiff(observationDiff)) {
    reasons.push('OBSERVATIONS_CHANGED');
    diff.observations = observationDiff;
  }

  addSetDifference(
    before.evidenceIds,
    after.evidenceIds,
    'EVIDENCE_CHANGED',
    'evidenceIds',
    reasons,
    diff,
  );

  if (
    before.normalizedHostname !== after.normalizedHostname ||
    before.normalizedIp !== after.normalizedIp
  ) {
    reasons.push('NETWORK_VALUE_CHANGED');
    if (before.normalizedHostname !== after.normalizedHostname) {
      diff.normalizedHostname = {
        before: before.normalizedHostname,
        after: after.normalizedHostname,
      };
    }
    if (before.normalizedIp !== after.normalizedIp) {
      diff.normalizedIp = { before: before.normalizedIp, after: after.normalizedIp };
    }
  }

  const sourceDiff = structuredSetDiff(before.sources, after.sources);
  if (hasSetDiff(sourceDiff)) {
    reasons.push('SOURCES_CHANGED');
    diff.sources = sourceDiff;
  }

  if (canonicalSerialize(before.temporalContext) !== canonicalSerialize(after.temporalContext)) {
    reasons.push('TEMPORAL_CONTEXT_CHANGED');
    diff.temporalContext = {
      before: before.temporalContext,
      after: after.temporalContext,
    };
  }

  addSetDifference(
    before.limitations,
    after.limitations,
    'LIMITATIONS_CHANGED',
    'limitations',
    reasons,
    diff,
  );
  addSetDifference(
    before.reviewOptions,
    after.reviewOptions,
    'REVIEW_OPTIONS_CHANGED',
    'reviewOptions',
    reasons,
    diff,
  );

  if (input.baseline.policyVersion !== input.current.policyVersion) {
    reasons.push('POLICY_VERSION_CHANGED');
    return {
      staleness: FindingReviewStaleness.POLICY_VERSION_CHANGED,
      reasons: orderedReasons(reasons),
      diff,
    };
  }

  return {
    staleness:
      reasons.length === 0 ? FindingReviewStaleness.CURRENT : FindingReviewStaleness.CHANGED,
    reasons: orderedReasons(reasons),
    diff,
  };
}

export function snapshotReviewSubjectKey(snapshot: FindingReviewSnapshot): string {
  const finding: ConflictFinding = {
    findingId: snapshot.findingId,
    type: snapshot.findingType,
    mode: 'SHADOW',
    requiresHumanReview: true,
    affectedAssetIds: snapshot.affectedAssets.map((asset) => asset.assetId),
    normalizedHostname: snapshot.normalizedHostname,
    normalizedIp: snapshot.normalizedIp,
    observations: snapshot.observations,
    temporalContext: snapshot.temporalContext,
    explanation: snapshot.explanation,
    limitations: snapshot.limitations,
    reviewOptions: snapshot.reviewOptions,
  };
  return reviewSubjectKey(finding);
}

function materialProjection(snapshot: FindingReviewSnapshot, reviewSubjectKey: string) {
  const observations = sortedUnique(
    snapshot.observations.map((observation) => ({
      assetId: observation.assetId,
      attribute: observation.attribute,
      normalizedValue: observation.normalizedValue,
      source: observation.source,
      sourceType: observation.sourceType,
      evidenceId: observation.evidenceId,
      observedAt: observation.observedAt,
      ingestedAt: observation.ingestedAt,
      current: observation.current,
    })),
  );

  return {
    findingType: snapshot.findingType,
    reviewSubjectKey,
    affectedAssetIds: sortedUnique(snapshot.affectedAssets.map((asset) => asset.assetId)),
    normalizedHostname: snapshot.normalizedHostname,
    normalizedIp: snapshot.normalizedIp,
    observations,
    evidenceIds: sortedUnique(
      snapshot.observations.flatMap((observation) =>
        observation.evidenceId ? [observation.evidenceId] : [],
      ),
    ),
    sources: sortedUnique(snapshot.sources.map((source) => ({ ...source }))),
    temporalContext: snapshot.temporalContext,
    limitations: sortedUnique(snapshot.limitations),
    reviewOptions: sortedUnique(snapshot.reviewOptions),
  };
}

function addSetDifference<
  T,
  K extends 'affectedAssets' | 'evidenceIds' | 'limitations' | 'reviewOptions',
>(
  before: T[],
  after: T[],
  reason: FindingReviewContextComparisonReason,
  key: K,
  reasons: FindingReviewContextComparisonReason[],
  diff: FindingReviewContextDiff,
): void {
  const difference = structuredSetDiff(before, after);
  if (!hasSetDiff(difference)) return;
  reasons.push(reason);
  Object.assign(diff, { [key]: difference });
}

function structuredSetDiff<T>(before: T[], after: T[]): SetDiff<T> {
  const beforeByKey = new Map(before.map((value) => [canonicalSerialize(value), value]));
  const afterByKey = new Map(after.map((value) => [canonicalSerialize(value), value]));
  return {
    added: [...afterByKey.entries()]
      .filter(([key]) => !beforeByKey.has(key))
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([, value]) => value),
    removed: [...beforeByKey.entries()]
      .filter(([key]) => !afterByKey.has(key))
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([, value]) => value),
  };
}

function hasSetDiff<T>(diff: SetDiff<T>): boolean {
  return diff.added.length > 0 || diff.removed.length > 0;
}

function sortedUnique<T>(values: T[]): T[] {
  return [...new Map(values.map((value) => [canonicalSerialize(value), value])).entries()]
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([, value]) => value);
}

function orderedReasons(
  reasons: FindingReviewContextComparisonReason[],
): FindingReviewContextComparisonReason[] {
  return [...new Set(reasons)].sort(compareCanonicalStrings);
}

function isFindingReviewSnapshot(value: unknown): value is FindingReviewSnapshot {
  if (!isRecord(value)) return false;
  return (
    FINDING_TYPES.includes(value.findingType as ConflictFindingType) &&
    typeof value.findingId === 'string' &&
    typeof value.policyVersion === 'string' &&
    isTimestamp(value.generatedAt) &&
    Array.isArray(value.affectedAssets) &&
    value.affectedAssets.every(isAffectedAsset) &&
    isNullableString(value.normalizedHostname) &&
    isNullableString(value.normalizedIp) &&
    Array.isArray(value.observations) &&
    value.observations.every(isObservation) &&
    Array.isArray(value.sources) &&
    value.sources.every(isSource) &&
    isTemporalContext(value.temporalContext) &&
    isStringArray(value.explanation) &&
    isStringArray(value.limitations) &&
    Array.isArray(value.reviewOptions) &&
    value.reviewOptions.every((item) => REVIEW_OPTIONS.includes(item as ConflictReviewOption))
  );
}

function isAffectedAsset(value: unknown): boolean {
  return isRecord(value) && typeof value.assetId === 'string' && isNullableString(value.name);
}

function isObservation(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.assetId === 'string' &&
    typeof value.value === 'string' &&
    typeof value.normalizedValue === 'string' &&
    (value.attribute === 'HOSTNAME' || value.attribute === 'IP_ADDRESS') &&
    typeof value.source === 'string' &&
    SOURCE_TYPES.includes(value.sourceType as ConflictSourceType) &&
    isNullableString(value.evidenceId) &&
    isNullableTimestamp(value.observedAt) &&
    isNullableTimestamp(value.ingestedAt) &&
    typeof value.current === 'boolean'
  );
}

function isSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.identifier === 'string' &&
    SOURCE_TYPES.includes(value.type as ConflictSourceType)
  );
}

function isTemporalContext(value: unknown): value is ConflictTemporalContext {
  return (
    isRecord(value) &&
    isNullableTimestamp(value.firstObservedAt) &&
    isNullableTimestamp(value.lastObservedAt) &&
    (value.differenceMilliseconds === null ||
      (typeof value.differenceMilliseconds === 'number' &&
        Number.isFinite(value.differenceMilliseconds))) &&
    TEMPORAL_RELATIONSHIPS.includes(value.relationship as ConflictTemporalContext['relationship'])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
