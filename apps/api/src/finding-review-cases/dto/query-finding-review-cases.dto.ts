import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CONFLICT_FINDING_TYPES } from '../../conflict-analysis/dto/query-conflict-findings.dto';
import { FindingReviewCaseStatus, FindingReviewStaleness } from '../../generated/prisma/enums';

export const FINDING_REVIEW_CASE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
  'staleness',
] as const;

export type FindingReviewCaseSortField = (typeof FINDING_REVIEW_CASE_SORT_FIELDS)[number];
export type FindingReviewCaseSortDirection = 'asc' | 'desc';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class QueryFindingReviewCasesDto {
  @IsOptional()
  @IsEnum(FindingReviewCaseStatus)
  status?: FindingReviewCaseStatus;

  @IsOptional()
  @IsEnum(FindingReviewStaleness)
  staleness?: FindingReviewStaleness;

  @IsOptional()
  @IsIn(CONFLICT_FINDING_TYPES)
  findingType?: (typeof CONFLICT_FINDING_TYPES)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  createdBy?: string;

  @IsOptional()
  @IsUUID('4')
  assetId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  findingId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  createdFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsIn(FINDING_REVIEW_CASE_SORT_FIELDS)
  sortBy: FindingReviewCaseSortField = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: FindingReviewCaseSortDirection = 'desc';
}
