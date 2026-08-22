import { IsEnum, IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';

import { FindingReviewIdentityConclusion } from '../../generated/prisma/enums';
import { MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION } from '../finding-review-case-status-transition';

export class CreateFindingReviewDecisionDto {
  @IsEnum(FindingReviewIdentityConclusion, {
    message: 'identityConclusion deve ser uma conclusão de identidade válida.',
  })
  identityConclusion!: FindingReviewIdentityConclusion;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'justification deve ser uma string.' })
  justification?: string;

  @IsInt({ message: 'expectedVersion deve ser um número inteiro.' })
  @Min(1, { message: 'expectedVersion deve ser maior ou igual a 1.' })
  @Max(MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION, {
    message: 'expectedVersion excede o limite persistível para uma decisão.',
  })
  expectedVersion!: number;
}
