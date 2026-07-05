import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const AUDIT_LOG_SORT_FIELDS = ['occurredAt', 'action', 'entityType', 'actorType'] as const;
export type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class QueryAuditLogsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  actorType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsUUID('4')
  entityId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;

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
  @IsIn(AUDIT_LOG_SORT_FIELDS)
  sortBy: AuditLogSortField = 'occurredAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: SortDirection = 'desc';
}
