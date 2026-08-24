import {
  canonicalSerialize,
  FINDING_REVIEW_ACTOR_ID,
  sha256,
} from './finding-review-case-creation';

export const FINDING_REVIEW_CASE_REOPEN_OPERATION = 'REOPEN_FINDING_REVIEW_CASE';
export const FINDING_REVIEW_CASE_REOPENED_EVENT = 'CASE_REOPENED';
export const MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH = 1_000;

export interface FindingReviewReopenSemanticRequest {
  caseId: string;
  expectedVersion: number;
  justification: string;
}

export interface PersistedFindingReviewReopenRequest {
  caseId: string;
  versionBefore: number | null;
  justification: string | null;
}

export function reopenRequestFingerprint(caseId: string, idempotencyKey: string): string {
  return sha256(
    canonicalSerialize({
      operation: FINDING_REVIEW_CASE_REOPEN_OPERATION,
      actorId: FINDING_REVIEW_ACTOR_ID,
      caseId,
      idempotencyKey,
    }),
  );
}

export function normalizeFindingReviewReopenJustification(value: string): string {
  return value.trim();
}

export function isSameFindingReviewReopenRequest(
  persisted: PersistedFindingReviewReopenRequest,
  request: FindingReviewReopenSemanticRequest,
): boolean {
  return persisted.caseId === request.caseId
    && persisted.versionBefore === request.expectedVersion
    && persisted.justification === request.justification;
}
