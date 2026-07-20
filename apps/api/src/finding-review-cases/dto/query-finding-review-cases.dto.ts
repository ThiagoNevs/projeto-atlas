import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

import { CONFLICT_FINDING_TYPES } from '../../conflict-analysis/dto/query-conflict-findings.dto';
import { CONFLICT_FINDING_ID_PATTERN } from '../../conflict-analysis/conflict-finding-id';
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

export const FINDING_REVIEW_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
export const CANONICAL_POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;

export function isFindingReviewTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = FINDING_REVIEW_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

export function parseFindingReviewTimestamp(value: string): Date {
  if (!isFindingReviewTimestamp(value)) {
    throw new TypeError('Timestamp de caso de revisão inválido.');
  }
  return new Date(value);
}

function IsFindingReviewTimestamp(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isFindingReviewTimestamp',
      validator: {
        validate: isFindingReviewTimestamp,
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} deve ser um timestamp ISO 8601 completo com timezone explícito.`,
      },
    },
    validationOptions,
  );
}

function parseCanonicalPositiveInteger({ value }: { value: unknown }): unknown {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 1 ? value : Number.NaN;
  }
  if (typeof value !== 'string' || !CANONICAL_POSITIVE_DECIMAL_PATTERN.test(value)) {
    return Number.NaN;
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN;
  return Number(value);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

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
  @IsString()
  @Matches(CONFLICT_FINDING_ID_PATTERN, {
    message: 'findingId deve seguir o formato finding_ com 24 caracteres hexadecimais minúsculos.',
  })
  findingId?: string;

  @IsOptional()
  @IsFindingReviewTimestamp()
  createdFrom?: string;

  @IsOptional()
  @IsFindingReviewTimestamp()
  createdTo?: string;

  @IsOptional()
  @Transform(parseCanonicalPositiveInteger)
  @IsInt({ message: 'page deve ser um número inteiro decimal canônico e seguro.' })
  @IsNumber({ allowInfinity: false, allowNaN: false }, { message: 'page é inválida.' })
  @Min(1, { message: 'page deve ser maior ou igual a 1.' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'page excede o limite numérico seguro.' })
  page = 1;

  @IsOptional()
  @Transform(parseCanonicalPositiveInteger)
  @IsInt({ message: 'pageSize deve ser um número inteiro decimal canônico e seguro.' })
  @IsNumber({ allowInfinity: false, allowNaN: false }, { message: 'pageSize é inválido.' })
  @Min(1, { message: 'pageSize deve ser maior ou igual a 1.' })
  @Max(100, { message: 'pageSize deve ser menor ou igual a 100.' })
  pageSize = 25;

  @IsOptional()
  @IsIn(FINDING_REVIEW_CASE_SORT_FIELDS)
  sortBy: FindingReviewCaseSortField = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: FindingReviewCaseSortDirection = 'desc';
}
