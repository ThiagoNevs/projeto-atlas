import type { FindingReviewIdentityConclusion } from '../generated/prisma/enums';
import {
  canonicalSerialize,
  FINDING_REVIEW_ACTOR_ID,
  sha256,
} from './finding-review-case-creation';

export const FINDING_REVIEW_DECISION_OPERATION = 'RECORD_FINDING_REVIEW_DECISION';
export const FINDING_REVIEW_DECISION_RECORDED_EVENT = 'CASE_DECISION_RECORDED';
export const MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH = 1_000;

export interface FindingReviewDecisionSemanticRequest {
  caseId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  expectedVersion: number;
}

export interface PersistedFindingReviewDecisionRequest {
  caseId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  caseVersion: number;
}

export function decisionRequestFingerprint(idempotencyKey: string): string {
  return sha256(
    canonicalSerialize({
      operation: FINDING_REVIEW_DECISION_OPERATION,
      actorId: FINDING_REVIEW_ACTOR_ID,
      idempotencyKey,
    }),
  );
}

export function normalizeFindingReviewDecisionJustification(value: string): string {
  return value.trim();
}

export function isSameFindingReviewDecisionRequest(
  persisted: PersistedFindingReviewDecisionRequest,
  request: FindingReviewDecisionSemanticRequest,
): boolean {
  return persisted.caseId === request.caseId
    && persisted.identityConclusion === request.identityConclusion
    && persisted.justification === request.justification
    && persisted.caseVersion - 1 === request.expectedVersion;
}
