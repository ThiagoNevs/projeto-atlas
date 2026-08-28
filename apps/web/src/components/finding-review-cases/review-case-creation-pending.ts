import { isFindingReviewFindingId } from '../../lib/finding-review-cases';

const IDEMPOTENCY_STORAGE_PREFIX = 'atlas:pending-review-case:';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/=-]{1,128}$/;
export const PENDING_REVIEW_CASE_ATTEMPT_TTL_MS = 15 * 60 * 1000;

export interface PendingFindingReviewCaseAttempt {
  version: 1;
  findingId: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

export type PendingReviewCaseAttemptInspection =
  | { status: 'valid'; attempt: PendingFindingReviewCaseAttempt }
  | { status: 'invalid' | 'expired'; attempt: null };

export type StoredPendingReviewCaseAttempt = PendingReviewCaseAttemptInspection
  | { status: 'missing'; attempt: null };

function pendingStorageKey(findingId: string): string {
  return `${IDEMPOTENCY_STORAGE_PREFIX}${findingId}`;
}

export function createPendingFindingReviewCaseAttempt(
  findingId: string,
  idempotencyKey: string,
  now = Date.now(),
): PendingFindingReviewCaseAttempt {
  return {
    version: 1,
    findingId,
    idempotencyKey,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PENDING_REVIEW_CASE_ATTEMPT_TTL_MS).toISOString(),
  };
}

export function parsePendingFindingReviewCaseAttempt(
  serialized: string,
  expectedFindingId: string,
  now = Date.now(),
): PendingFindingReviewCaseAttempt | null {
  const inspected = inspectPendingFindingReviewCaseAttempt(serialized, expectedFindingId, now);
  return inspected.status === 'valid' ? inspected.attempt : null;
}

export function inspectPendingFindingReviewCaseAttempt(
  serialized: string,
  expectedFindingId: string,
  now = Date.now(),
): PendingReviewCaseAttemptInspection {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', attempt: null };
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'createdAt,expiresAt,findingId,idempotencyKey,version') {
      return { status: 'invalid', attempt: null };
    }
    if (
      candidate.version !== 1
      || candidate.findingId !== expectedFindingId
      || !isFindingReviewFindingId(candidate.findingId)
      || typeof candidate.idempotencyKey !== 'string'
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.expiresAt !== 'string'
    ) return { status: 'invalid', attempt: null };
    const createdAt = Date.parse(candidate.createdAt);
    const expiresAt = Date.parse(candidate.expiresAt);
    if (
      !Number.isFinite(createdAt)
      || !Number.isFinite(expiresAt)
      || new Date(createdAt).toISOString() !== candidate.createdAt
      || new Date(expiresAt).toISOString() !== candidate.expiresAt
      || createdAt > now
      || expiresAt - createdAt !== PENDING_REVIEW_CASE_ATTEMPT_TTL_MS
    ) return { status: 'invalid', attempt: null };
    if (expiresAt <= now) return { status: 'expired', attempt: null };
    return {
      status: 'valid',
      attempt: candidate as unknown as PendingFindingReviewCaseAttempt,
    };
  } catch {
    return { status: 'invalid', attempt: null };
  }
}

export function readPendingFindingReviewCaseAttempt(
  findingId: string,
): StoredPendingReviewCaseAttempt {
  try {
    const storageKey = pendingStorageKey(findingId);
    const serialized = window.sessionStorage.getItem(storageKey);
    if (serialized === null) return { status: 'missing', attempt: null };
    const inspected = inspectPendingFindingReviewCaseAttempt(serialized, findingId);
    if (inspected.status !== 'valid') window.sessionStorage.removeItem(storageKey);
    return inspected;
  } catch {
    return { status: 'missing', attempt: null };
  }
}

export function storePendingFindingReviewCaseAttempt(
  attempt: PendingFindingReviewCaseAttempt,
): void {
  try {
    window.sessionStorage.setItem(pendingStorageKey(attempt.findingId), JSON.stringify(attempt));
  } catch {
    // The complete in-memory attempt still protects its original TTL while this page remains mounted.
  }
}

export function clearPendingFindingReviewCaseAttempt(
  findingId: string,
  expectedAttempt?: PendingFindingReviewCaseAttempt,
): void {
  try {
    const storageKey = pendingStorageKey(findingId);
    const serialized = window.sessionStorage.getItem(storageKey);
    if (serialized !== null && (!expectedAttempt || serialized === JSON.stringify(expectedAttempt))) {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Storage can be unavailable in restrictive browser contexts.
  }
}

export function pendingReviewCaseAttemptDiscardedMessage(
  status: 'invalid' | 'expired',
): string {
  if (status === 'expired') {
    return 'A tentativa anterior expirou e foi descartada. Clique novamente para iniciar uma nova tentativa.';
  }
  return 'O registro temporário da tentativa era inválido e foi descartado. Clique novamente para iniciar uma nova tentativa.';
}
