import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsIP,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CONFLICT_FINDING_TYPES = [
  'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  'SHARED_IP_DIFFERENT_HOSTNAMES',
  'HOSTNAME_DIVERGENCE_ON_ASSET',
] as const;

export const CONFLICT_SOURCE_TYPES = ['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN'] as const;

export const CONFLICT_TEMPORAL_RELATIONSHIPS = [
  'SAME_OBSERVATION_TIME',
  'DISTINCT_OBSERVATION_TIMES',
  'PARTIAL_TEMPORAL_CONTEXT',
  'NO_TEMPORAL_CONTEXT',
] as const;

export const CONFLICT_FINDING_SORT_FIELDS = [
  'type',
  'findingId',
  'affectedAssets',
  'observationCount',
  'firstObservedAt',
  'lastObservedAt',
] as const;

export type ConflictFindingSortField = (typeof CONFLICT_FINDING_SORT_FIELDS)[number];
export type ConflictFindingSortDirection = 'asc' | 'desc';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const uppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const optionalBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class QueryConflictFindingsDto {
  @IsOptional()
  @Transform(uppercase)
  @IsIn(CONFLICT_FINDING_TYPES)
  type?: (typeof CONFLICT_FINDING_TYPES)[number];

  @IsOptional()
  @IsUUID('4')
  assetId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  hostname?: string;

  @IsOptional()
  @Transform(trim)
  @IsIP()
  ip?: string;

  @IsOptional()
  @Transform(uppercase)
  @IsIn(CONFLICT_SOURCE_TYPES)
  sourceType?: (typeof CONFLICT_SOURCE_TYPES)[number];

  @IsOptional()
  @Transform(uppercase)
  @IsIn(CONFLICT_TEMPORAL_RELATIONSHIPS)
  temporalRelationship?: (typeof CONFLICT_TEMPORAL_RELATIONSHIPS)[number];

  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  hasLimitations?: boolean;

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
  @IsIn(CONFLICT_FINDING_SORT_FIELDS)
  sortBy: ConflictFindingSortField = 'type';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: ConflictFindingSortDirection = 'asc';
}
