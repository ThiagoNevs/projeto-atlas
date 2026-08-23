import { IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';

import { MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION } from '../finding-review-case-status-transition';

export class CreateFindingReviewCaseResolutionDto {
  @IsInt({ message: 'expectedVersion deve ser um número inteiro.' })
  @Min(1, { message: 'expectedVersion deve ser maior ou igual a 1.' })
  @Max(MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION, {
    message: 'expectedVersion excede o limite persistível para uma resolução.',
  })
  expectedVersion!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'justification deve ser uma string.' })
  justification?: string;
}
