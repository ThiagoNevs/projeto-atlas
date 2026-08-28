import type { FindingReviewIdentityConclusion } from '../generated/prisma/enums';
import {
  canonicalSerialize,
  FINDING_REVIEW_ACTOR_ID,
  sha256,
} from './finding-review-case-creation';

export const FINDING_REVIEW_DECISION_SUPERSESSION_OPERATION =
  'SUPERSEDE_FINDING_REVIEW_DECISION';
export const FINDING_REVIEW_DECISION_SUPERSEDED_EVENT = 'CASE_DECISION_SUPERSEDED';
export const MAX_FINDING_REVIEW_DECISION_SUPERSESSION_TEXT_LENGTH = 1_000;

export interface FindingReviewDecisionSupersessionSemanticRequest {
  caseId: string;
  supersededDecisionId: string;
  expectedVersion: number;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  correctionReason: string;
}

export interface PersistedFindingReviewDecisionSupersessionRequest {
  caseId: string;
  supersededDecisionId: string;
  expectedVersion: number;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  correctionReason: string;
}

export function decisionSupersessionRequestFingerprint(idempotencyKey: string): string {
  return sha256(
    canonicalSerialize({
      operation: FINDING_REVIEW_DECISION_SUPERSESSION_OPERATION,
      actorId: FINDING_REVIEW_ACTOR_ID,
      idempotencyKey,
    }),
  );
}

export function normalizeFindingReviewDecisionSupersessionText(value: string): string {
  return value.trim();
}

export function isSameFindingReviewDecisionSupersessionRequest(
  persisted: PersistedFindingReviewDecisionSupersessionRequest,
  request: FindingReviewDecisionSupersessionSemanticRequest,
): boolean {
  return persisted.caseId === request.caseId
    && persisted.supersededDecisionId === request.supersededDecisionId
    && persisted.expectedVersion === request.expectedVersion
    && persisted.identityConclusion === request.identityConclusion
    && persisted.justification === request.justification
    && persisted.correctionReason === request.correctionReason;
}
