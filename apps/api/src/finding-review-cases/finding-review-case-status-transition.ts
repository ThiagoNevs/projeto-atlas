import { FindingReviewCaseStatus } from '../generated/prisma/enums';

export const ACTIVE_FINDING_REVIEW_CASE_STATUSES = [
  FindingReviewCaseStatus.OPEN,
  FindingReviewCaseStatus.IN_REVIEW,
  FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
] as const;

export type ActiveFindingReviewCaseStatus =
  (typeof ACTIVE_FINDING_REVIEW_CASE_STATUSES)[number];

export const FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT = 'CASE_STATUS_CHANGED';

export function isAllowedFindingReviewCaseStatusTransition(
  current: FindingReviewCaseStatus,
  next: ActiveFindingReviewCaseStatus,
): boolean {
  return ACTIVE_FINDING_REVIEW_CASE_STATUSES.includes(
    current as ActiveFindingReviewCaseStatus,
  ) && current !== next;
}
