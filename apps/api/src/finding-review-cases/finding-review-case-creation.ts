import { createHash } from 'node:crypto';

import type {
  ConflictFinding,
  ConflictFindingType,
  ConflictObservation,
} from '../conflict-analysis/types/conflict-analysis';

export const FINDING_REVIEW_ACTOR_ID = 'atlas-mvp-user';
export const FINDING_REVIEW_CREATE_OPERATION = 'CREATE_FINDING_REVIEW_CASE';
export const FINDING_REVIEW_CASE_CREATED_EVENT = 'CASE_CREATED';
export const FINDING_REVIEW_SNAPSHOT_VERSION = 1;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/=-]+$/;

export interface FindingReviewSnapshot {
  snapshotVersion: number;
  findingId: string;
  findingType: ConflictFindingType;
  policyVersion: string;
  generatedAt: string;
  affectedAssets: Array<{ assetId: string; name: string | null }>;
  normalizedHostname: string | null;
  normalizedIp: string | null;
  observations: ConflictObservation[];
  sources: Array<{ identifier: string; type: ConflictObservation['sourceType'] }>;
  temporalContext: ConflictFinding['temporalContext'];
  explanation: string[];
  limitations: string[];
  reviewOptions: ConflictFinding['reviewOptions'];
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function compareCanonicalStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Números não finitos não podem ser serializados.');
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort(compareCanonicalStrings)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  throw new Error('O valor não possui representação JSON segura.');
}

export function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Idempotency-Key é obrigatório.');
  if (!value) throw new Error('Idempotency-Key não pode ser vazio.');
  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error(`Idempotency-Key deve ter no máximo ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new Error('Idempotency-Key contém caracteres não permitidos.');
  }
  return value;
}

export function creationRequestFingerprint(idempotencyKey: string): string {
  return sha256(
    canonicalSerialize({
      operation: FINDING_REVIEW_CREATE_OPERATION,
      actorId: FINDING_REVIEW_ACTOR_ID,
      idempotencyKey,
    }),
  );
}

export function reviewSubjectKey(finding: ConflictFinding): string {
  let canonicalSubject: string;
  switch (finding.type) {
    case 'DUPLICATE_HOSTNAME_ACROSS_ASSETS':
      if (!finding.normalizedHostname) throw new Error('O finding não possui hostname canônico.');
      canonicalSubject = finding.normalizedHostname;
      break;
    case 'SHARED_IP_DIFFERENT_HOSTNAMES':
      if (!finding.normalizedIp) throw new Error('O finding não possui IP canônico.');
      canonicalSubject = finding.normalizedIp;
      break;
    case 'HOSTNAME_DIVERGENCE_ON_ASSET':
      if (finding.affectedAssetIds.length !== 1 || !finding.affectedAssetIds[0]) {
        throw new Error('O finding de divergência não possui um único ativo canônico.');
      }
      canonicalSubject = finding.affectedAssetIds[0];
      break;
    default:
      throw new Error('O tipo de finding não possui assunto de revisão aprovado.');
  }
  return sha256(`finding-review-subject:v1|${finding.type}|${canonicalSubject}`);
}

export function buildFindingReviewSnapshot(input: {
  finding: ConflictFinding;
  policyVersion: string;
  generatedAt: string;
  affectedAssets: Array<{ assetId: string; name: string | null }>;
}): FindingReviewSnapshot {
  const observations = [...input.finding.observations].sort((left, right) =>
    compareCanonicalStrings(canonicalSerialize(left), canonicalSerialize(right)),
  );
  const sources = [
    ...new Map(
      observations.map((item) => [
        `${item.sourceType}:${item.source}`,
        { identifier: item.source, type: item.sourceType },
      ]),
    ).values(),
  ].sort((left, right) =>
    compareCanonicalStrings(`${left.type}:${left.identifier}`, `${right.type}:${right.identifier}`),
  );

  return {
    snapshotVersion: FINDING_REVIEW_SNAPSHOT_VERSION,
    findingId: input.finding.findingId,
    findingType: input.finding.type,
    policyVersion: input.policyVersion,
    generatedAt: new Date(input.generatedAt).toISOString(),
    affectedAssets: [...input.affectedAssets].sort((left, right) =>
      compareCanonicalStrings(left.assetId, right.assetId),
    ),
    normalizedHostname: input.finding.normalizedHostname,
    normalizedIp: input.finding.normalizedIp,
    observations,
    sources,
    temporalContext: input.finding.temporalContext,
    explanation: [...input.finding.explanation],
    limitations: [...input.finding.limitations].sort(compareCanonicalStrings),
    reviewOptions: [...input.finding.reviewOptions],
  };
}

export function snapshotHash(snapshot: FindingReviewSnapshot): string {
  return sha256(canonicalSerialize(snapshot));
}
