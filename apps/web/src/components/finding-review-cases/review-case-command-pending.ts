import type { FindingReviewIdentityConclusion } from '../../lib/api';
import { isFindingReviewCaseId } from '../../lib/finding-review-cases';

const DECISION_STORAGE_PREFIX = 'atlas:pending-review-decision:';
const RESOLUTION_STORAGE_PREFIX = 'atlas:pending-review-resolution:';
const REOPEN_STORAGE_PREFIX = 'atlas:pending-review-reopen:';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/=-]{1,128}$/;

export const PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS = 15 * 60 * 1000;
export const MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH = 1000;
export const PENDING_REVIEW_RESOLUTION_ATTEMPT_TTL_MS = 15 * 60 * 1000;
export const MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH = 1000;
export const PENDING_REVIEW_REOPEN_ATTEMPT_TTL_MS = 15 * 60 * 1000;
export const MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH = 1000;

export interface PendingFindingReviewDecisionAttempt {
  version: 1;
  caseId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  expectedVersion: number;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

export interface PendingFindingReviewResolutionAttempt {
  version: 1;
  caseId: string;
  justification: string;
  expectedVersion: number;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

export interface PendingFindingReviewReopenAttempt {
  version: 1;
  caseId: string;
  justification: string;
  expectedVersion: number;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

export type PendingDecisionInspection =
  | { status: 'valid'; attempt: PendingFindingReviewDecisionAttempt }
  | { status: 'invalid' | 'expired'; attempt: null };

export type PendingResolutionInspection =
  | { status: 'valid'; attempt: PendingFindingReviewResolutionAttempt }
  | { status: 'invalid' | 'expired'; attempt: null };

export type PendingReopenInspection =
  | { status: 'valid'; attempt: PendingFindingReviewReopenAttempt }
  | { status: 'invalid' | 'expired'; attempt: null };

type MissingInspection = { status: 'missing'; attempt: null };

function timestampsAreValid(
  createdAtValue: unknown,
  expiresAtValue: unknown,
  ttl: number,
  now: number,
): boolean | 'expired' {
  if (typeof createdAtValue !== 'string' || typeof expiresAtValue !== 'string') return false;
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  if (
    !Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || new Date(createdAt).toISOString() !== createdAtValue
    || new Date(expiresAt).toISOString() !== expiresAtValue
    || createdAt > now
    || expiresAt - createdAt !== ttl
  ) return false;
  return expiresAt <= now ? 'expired' : true;
}

function readStoredAttempt<T>(
  key: string,
  inspect: (serialized: string) => T,
  isValid: (inspection: T) => boolean,
): T | MissingInspection {
  try {
    const serialized = window.sessionStorage.getItem(key);
    if (serialized === null) return { status: 'missing', attempt: null };
    const inspected = inspect(serialized);
    if (!isValid(inspected)) window.sessionStorage.removeItem(key);
    return inspected;
  } catch {
    return { status: 'missing', attempt: null };
  }
}

function storeAttempt(key: string, attempt: object): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(attempt));
  } catch {
    // The in-memory envelope remains available during this mounted page.
  }
}

function clearAttempt(key: string, expectedAttempt?: object): void {
  try {
    const serialized = window.sessionStorage.getItem(key);
    if (serialized !== null && (!expectedAttempt || serialized === JSON.stringify(expectedAttempt))) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in restrictive browser contexts.
  }
}

function decisionStorageKey(caseId: string): string {
  return `${DECISION_STORAGE_PREFIX}${caseId}`;
}

export function createPendingFindingReviewDecisionAttempt(
  caseId: string,
  identityConclusion: FindingReviewIdentityConclusion,
  justification: string,
  expectedVersion: number,
  idempotencyKey: string,
  now = Date.now(),
): PendingFindingReviewDecisionAttempt {
  return {
    version: 1,
    caseId,
    identityConclusion,
    justification,
    expectedVersion,
    idempotencyKey,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS).toISOString(),
  };
}

export function parsePendingFindingReviewDecisionAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingFindingReviewDecisionAttempt | null {
  const inspected = inspectPendingFindingReviewDecisionAttempt(serialized, expectedCaseId, now);
  return inspected.status === 'valid' ? inspected.attempt : null;
}

export function inspectPendingFindingReviewDecisionAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingDecisionInspection {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', attempt: null };
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'caseId,createdAt,expectedVersion,expiresAt,idempotencyKey,identityConclusion,justification,version') {
      return { status: 'invalid', attempt: null };
    }
    if (
      candidate.version !== 1
      || candidate.caseId !== expectedCaseId
      || !isFindingReviewCaseId(candidate.caseId)
      || (candidate.identityConclusion !== 'SAME_ASSET'
        && candidate.identityConclusion !== 'DIFFERENT_ASSETS')
      || typeof candidate.justification !== 'string'
      || candidate.justification.length < 1
      || candidate.justification.length > MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH
      || candidate.justification !== candidate.justification.trim()
      || !Number.isSafeInteger(candidate.expectedVersion)
      || Number(candidate.expectedVersion) < 1
      || typeof candidate.idempotencyKey !== 'string'
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
    ) return { status: 'invalid', attempt: null };
    const timestampStatus = timestampsAreValid(
      candidate.createdAt,
      candidate.expiresAt,
      PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS,
      now,
    );
    if (timestampStatus === false) return { status: 'invalid', attempt: null };
    if (timestampStatus === 'expired') return { status: 'expired', attempt: null };
    return { status: 'valid', attempt: candidate as unknown as PendingFindingReviewDecisionAttempt };
  } catch {
    return { status: 'invalid', attempt: null };
  }
}

export function readPendingFindingReviewDecisionAttempt(
  caseId: string,
): PendingDecisionInspection | MissingInspection {
  return readStoredAttempt(
    decisionStorageKey(caseId),
    (serialized) => inspectPendingFindingReviewDecisionAttempt(serialized, caseId),
    (inspection) => inspection.status === 'valid',
  );
}

export function storePendingFindingReviewDecisionAttempt(
  attempt: PendingFindingReviewDecisionAttempt,
): void {
  storeAttempt(decisionStorageKey(attempt.caseId), attempt);
}

export function clearPendingFindingReviewDecisionAttempt(
  caseId: string,
  expectedAttempt?: PendingFindingReviewDecisionAttempt,
): void {
  clearAttempt(decisionStorageKey(caseId), expectedAttempt);
}

function resolutionStorageKey(caseId: string): string {
  return `${RESOLUTION_STORAGE_PREFIX}${caseId}`;
}

export function createPendingFindingReviewResolutionAttempt(
  caseId: string,
  justification: string,
  expectedVersion: number,
  idempotencyKey: string,
  now = Date.now(),
): PendingFindingReviewResolutionAttempt {
  return {
    version: 1,
    caseId,
    justification,
    expectedVersion,
    idempotencyKey,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PENDING_REVIEW_RESOLUTION_ATTEMPT_TTL_MS).toISOString(),
  };
}

export function parsePendingFindingReviewResolutionAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingFindingReviewResolutionAttempt | null {
  const inspected = inspectPendingFindingReviewResolutionAttempt(serialized, expectedCaseId, now);
  return inspected.status === 'valid' ? inspected.attempt : null;
}

export function inspectPendingFindingReviewResolutionAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingResolutionInspection {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', attempt: null };
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'caseId,createdAt,expectedVersion,expiresAt,idempotencyKey,justification,version') {
      return { status: 'invalid', attempt: null };
    }
    if (
      candidate.version !== 1
      || candidate.caseId !== expectedCaseId
      || !isFindingReviewCaseId(candidate.caseId)
      || typeof candidate.justification !== 'string'
      || candidate.justification.length < 1
      || candidate.justification.length > MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH
      || candidate.justification !== candidate.justification.trim()
      || !Number.isSafeInteger(candidate.expectedVersion)
      || Number(candidate.expectedVersion) < 1
      || typeof candidate.idempotencyKey !== 'string'
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
    ) return { status: 'invalid', attempt: null };
    const timestampStatus = timestampsAreValid(
      candidate.createdAt,
      candidate.expiresAt,
      PENDING_REVIEW_RESOLUTION_ATTEMPT_TTL_MS,
      now,
    );
    if (timestampStatus === false) return { status: 'invalid', attempt: null };
    if (timestampStatus === 'expired') return { status: 'expired', attempt: null };
    return { status: 'valid', attempt: candidate as unknown as PendingFindingReviewResolutionAttempt };
  } catch {
    return { status: 'invalid', attempt: null };
  }
}

export function readPendingFindingReviewResolutionAttempt(
  caseId: string,
): PendingResolutionInspection | MissingInspection {
  return readStoredAttempt(
    resolutionStorageKey(caseId),
    (serialized) => inspectPendingFindingReviewResolutionAttempt(serialized, caseId),
    (inspection) => inspection.status === 'valid',
  );
}

export function storePendingFindingReviewResolutionAttempt(
  attempt: PendingFindingReviewResolutionAttempt,
): void {
  storeAttempt(resolutionStorageKey(attempt.caseId), attempt);
}

export function clearPendingFindingReviewResolutionAttempt(
  caseId: string,
  expectedAttempt?: PendingFindingReviewResolutionAttempt,
): void {
  clearAttempt(resolutionStorageKey(caseId), expectedAttempt);
}

function reopenStorageKey(caseId: string): string {
  return `${REOPEN_STORAGE_PREFIX}${caseId}`;
}

export function createPendingFindingReviewReopenAttempt(
  caseId: string,
  justification: string,
  expectedVersion: number,
  idempotencyKey: string,
  now = Date.now(),
): PendingFindingReviewReopenAttempt {
  return {
    version: 1,
    caseId,
    justification,
    expectedVersion,
    idempotencyKey,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PENDING_REVIEW_REOPEN_ATTEMPT_TTL_MS).toISOString(),
  };
}

export function parsePendingFindingReviewReopenAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingFindingReviewReopenAttempt | null {
  const inspected = inspectPendingFindingReviewReopenAttempt(serialized, expectedCaseId, now);
  return inspected.status === 'valid' ? inspected.attempt : null;
}

export function inspectPendingFindingReviewReopenAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingReopenInspection {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', attempt: null };
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'caseId,createdAt,expectedVersion,expiresAt,idempotencyKey,justification,version') {
      return { status: 'invalid', attempt: null };
    }
    if (
      candidate.version !== 1
      || candidate.caseId !== expectedCaseId
      || !isFindingReviewCaseId(candidate.caseId)
      || typeof candidate.justification !== 'string'
      || candidate.justification.length < 1
      || candidate.justification.length > MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH
      || candidate.justification !== candidate.justification.trim()
      || !Number.isSafeInteger(candidate.expectedVersion)
      || Number(candidate.expectedVersion) < 1
      || typeof candidate.idempotencyKey !== 'string'
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
    ) return { status: 'invalid', attempt: null };
    const timestampStatus = timestampsAreValid(
      candidate.createdAt,
      candidate.expiresAt,
      PENDING_REVIEW_REOPEN_ATTEMPT_TTL_MS,
      now,
    );
    if (timestampStatus === false) return { status: 'invalid', attempt: null };
    if (timestampStatus === 'expired') return { status: 'expired', attempt: null };
    return { status: 'valid', attempt: candidate as unknown as PendingFindingReviewReopenAttempt };
  } catch {
    return { status: 'invalid', attempt: null };
  }
}

export function readPendingFindingReviewReopenAttempt(
  caseId: string,
): PendingReopenInspection | MissingInspection {
  return readStoredAttempt(
    reopenStorageKey(caseId),
    (serialized) => inspectPendingFindingReviewReopenAttempt(serialized, caseId),
    (inspection) => inspection.status === 'valid',
  );
}

export function storePendingFindingReviewReopenAttempt(
  attempt: PendingFindingReviewReopenAttempt,
): void {
  storeAttempt(reopenStorageKey(attempt.caseId), attempt);
}

export function clearPendingFindingReviewReopenAttempt(
  caseId: string,
  expectedAttempt?: PendingFindingReviewReopenAttempt,
): void {
  clearAttempt(reopenStorageKey(caseId), expectedAttempt);
}
