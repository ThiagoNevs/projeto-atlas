import { FindingReviewCaseStatus } from '../generated/prisma/enums';

export const ACTIVE_FINDING_REVIEW_CASE_STATUSES = [
  FindingReviewCaseStatus.OPEN,
  FindingReviewCaseStatus.IN_REVIEW,
  FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
] as const;

export type ActiveFindingReviewCaseStatus =
  (typeof ACTIVE_FINDING_REVIEW_CASE_STATUSES)[number];

export const FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT = 'CASE_STATUS_CHANGED';

export const POSTGRES_INT4_MAX = 2_147_483_647;

// A transição sempre incrementa a versão em um. O valor recebido precisa
// reservar espaço para que versionAfter continue persistível como PostgreSQL INT4.
export const MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION = POSTGRES_INT4_MAX - 1;

export function isUpdatableFindingReviewCaseVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION;
}

export function isAllowedFindingReviewCaseStatusTransition(
  current: FindingReviewCaseStatus,
  next: ActiveFindingReviewCaseStatus,
): boolean {
  return ACTIVE_FINDING_REVIEW_CASE_STATUSES.includes(
    current as ActiveFindingReviewCaseStatus,
  ) && current !== next;
}
