import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { AdministrativeStatus, OperationalStatus } from '../../generated/prisma/enums';

export const ASSET_SORT_FIELDS = [
  'name',
  'lastSeenAt',
  'confidenceScore',
  'dataQualityScore',
  'evidenceCount',
  'eventCount',
  'createdAt',
  'updatedAt',
] as const;

export const ASSET_TYPES = [
  'SERVER',
  'NOTEBOOK',
  'DESKTOP',
  'WORKSTATION',
  'VM',
  'NETWORK_DEVICE',
  'STORAGE',
  'PRINTER',
  'UNKNOWN',
] as const;

export type AssetSortField = (typeof ASSET_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const uppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class QueryAssetsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsEnum(OperationalStatus)
  operationalStatus?: OperationalStatus;

  @IsOptional()
  @IsEnum(AdministrativeStatus)
  administrativeStatus?: AdministrativeStatus;

  @IsOptional()
  @Transform(uppercase)
  @IsIn(ASSET_TYPES)
  type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minConfidenceScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxConfidenceScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minDataQualityScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDataQualityScore?: number;

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
  @IsIn(ASSET_SORT_FIELDS)
  sortBy: AssetSortField = 'lastSeenAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: SortDirection = 'desc';
}
