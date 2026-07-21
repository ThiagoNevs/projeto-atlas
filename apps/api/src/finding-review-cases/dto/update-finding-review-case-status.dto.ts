import { IsIn, IsInt, Max, Min } from 'class-validator';

import type { ActiveFindingReviewCaseStatus } from '../finding-review-case-status-transition';
import { ACTIVE_FINDING_REVIEW_CASE_STATUSES } from '../finding-review-case-status-transition';

export class UpdateFindingReviewCaseStatusDto {
  @IsIn(ACTIVE_FINDING_REVIEW_CASE_STATUSES, {
    message: 'status deve ser um estado operacional ativo permitido.',
  })
  status!: ActiveFindingReviewCaseStatus;

  @IsInt({ message: 'expectedVersion deve ser um número inteiro.' })
  @Min(1, { message: 'expectedVersion deve ser maior ou igual a 1.' })
  @Max(Number.MAX_SAFE_INTEGER, {
    message: 'expectedVersion excede o limite numérico seguro.',
  })
  expectedVersion!: number;
}
