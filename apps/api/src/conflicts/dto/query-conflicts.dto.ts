import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { ConflictStatus } from '../../generated/prisma/enums';

export const CONFLICT_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'occurrenceCount',
  'impact',
  'status',
] as const;
export const CONFLICT_IMPACTS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const CONFLICT_TYPES = [
  'LIFECYCLE_CONFLICT',
  'ATTRIBUTE_CONFLICT',
  'NETWORK_IDENTITY_CONFLICT',
] as const;

export type ConflictSortField = (typeof CONFLICT_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const uppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class QueryConflictsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsEnum(ConflictStatus)
  status?: ConflictStatus;

  @IsOptional()
  @Transform(uppercase)
  @IsIn(CONFLICT_IMPACTS)
  impact?: string;

  @IsOptional()
  @Transform(uppercase)
  @IsIn(CONFLICT_TYPES)
  type?: string;

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
  pageSize = 10;

  @IsOptional()
  @IsIn(CONFLICT_SORT_FIELDS)
  sortBy: ConflictSortField = 'updatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: SortDirection = 'desc';
}
