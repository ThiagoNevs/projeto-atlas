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

export const DATA_QUALITY_ISSUES = [
  'LOW_DATA_QUALITY',
  'LOW_CONFIDENCE',
  'MISSING_SERIAL_NUMBER',
  'MISSING_MANUFACTURER',
  'MISSING_MODEL',
  'MISSING_OPERATING_SYSTEM',
  'MISSING_NETWORK_INFO',
  'MISSING_ADMINISTRATIVE_STATUS',
  'WITHOUT_RECENT_EVIDENCE',
] as const;
export const DATA_QUALITY_SORT_FIELDS = [
  'dataQualityScore',
  'confidenceScore',
  'lastSeenAt',
  'name',
  'type',
] as const;
export const DATA_QUALITY_ASSET_TYPES = [
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

export type DataQualityIssue = (typeof DATA_QUALITY_ISSUES)[number];
export type DataQualitySortField = (typeof DATA_QUALITY_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const uppercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class QueryDataQualityAssetsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Transform(uppercase)
  @IsIn(DATA_QUALITY_ISSUES)
  issue?: DataQualityIssue;

  @IsOptional()
  @Transform(uppercase)
  @IsIn(DATA_QUALITY_ASSET_TYPES)
  type?: string;

  @IsOptional()
  @IsEnum(AdministrativeStatus)
  administrativeStatus?: AdministrativeStatus;

  @IsOptional()
  @IsEnum(OperationalStatus)
  operationalStatus?: OperationalStatus;

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
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(DATA_QUALITY_SORT_FIELDS)
  sortBy: DataQualitySortField = 'dataQualityScore';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: SortDirection = 'asc';
}
