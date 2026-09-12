import {
  canonicalSerialize,
  sha256,
} from './finding-review-case-creation';

export const FINDING_REVIEW_CASE_RESOLUTION_OPERATION = 'RESOLVE_FINDING_REVIEW_CASE';
export const FINDING_REVIEW_CASE_RESOLVED_EVENT = 'CASE_RESOLVED';
export const MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH = 1_000;

export interface FindingReviewResolutionSemanticRequest {
  caseId: string;
  expectedVersion: number;
  justification: string;
}

export interface PersistedFindingReviewResolutionRequest {
  caseId: string;
  versionBefore: number | null;
  justification: string | null;
}

export function resolutionRequestFingerprint(
  actorId: string,
  caseId: string,
  idempotencyKey: string,
): string {
  return sha256(
    canonicalSerialize({
      operation: FINDING_REVIEW_CASE_RESOLUTION_OPERATION,
      actorId,
      caseId,
      idempotencyKey,
    }),
  );
}

export function normalizeFindingReviewResolutionJustification(value: string): string {
  return value.trim();
}

export function isSameFindingReviewResolutionRequest(
  persisted: PersistedFindingReviewResolutionRequest,
  request: FindingReviewResolutionSemanticRequest,
): boolean {
  return persisted.caseId === request.caseId
    && persisted.versionBefore === request.expectedVersion
    && persisted.justification === request.justification;
}
