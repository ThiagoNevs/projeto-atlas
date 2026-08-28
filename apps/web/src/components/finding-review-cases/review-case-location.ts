import type { FindingReviewCaseQuery } from '../../lib/api';
import { CONFLICT_FINDING_TYPES } from '../../lib/conflict-findings';
import {
  DEFAULT_FINDING_REVIEW_CASE_QUERY,
  FINDING_REVIEW_CASE_STATUSES,
  FINDING_REVIEW_SORT_FIELDS,
  FINDING_REVIEW_STALENESSES,
  isFindingReviewCaseId,
  isFindingReviewFindingId,
  isFindingReviewTimestamp,
  serializeFindingReviewCaseQuery,
  type FindingReviewCaseSortField,
  type FindingReviewCaseStatus,
  type FindingReviewSortDirection,
  type FindingReviewStaleness,
} from '../../lib/finding-review-cases';

export interface FindingReviewCaseFilterForm {
  status: string;
  staleness: string;
  findingType: string;
  findingId: string;
  createdBy: string;
  assetId: string;
  createdFrom: string;
  createdTo: string;
  sortBy: FindingReviewCaseSortField;
  sortDirection: FindingReviewSortDirection;
  pageSize: string;
}

export interface ReviewCaseLocationState {
  query: FindingReviewCaseQuery;
  caseId: string | null;
  requestedFindingId: string | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number, maximum?: number): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
}

export function reviewCaseQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): FindingReviewCaseQuery {
  const status = first(params.status);
  const staleness = first(params.staleness);
  const findingType = first(params.findingType);
  const sortBy = first(params.sortBy);
  const sortDirection = first(params.sortDirection);
  const findingId = first(params.findingId);
  const createdBy = first(params.createdBy)?.trim();
  const assetId = first(params.assetId);
  let createdFrom = first(params.createdFrom);
  let createdTo = first(params.createdTo);
  if (!isFindingReviewTimestamp(createdFrom)) createdFrom = undefined;
  if (!isFindingReviewTimestamp(createdTo)) createdTo = undefined;
  if (createdFrom && createdTo && Date.parse(createdFrom) > Date.parse(createdTo)) {
    createdFrom = undefined;
    createdTo = undefined;
  }
  return {
    page: positiveInteger(first(params.page), 1),
    pageSize: positiveInteger(first(params.pageSize), 25, 100),
    status: FINDING_REVIEW_CASE_STATUSES.includes(status as FindingReviewCaseStatus)
      ? status as FindingReviewCaseStatus : undefined,
    staleness: FINDING_REVIEW_STALENESSES.includes(staleness as FindingReviewStaleness)
      ? staleness as FindingReviewStaleness : undefined,
    findingType: CONFLICT_FINDING_TYPES.includes(findingType as never)
      ? findingType as FindingReviewCaseQuery['findingType'] : undefined,
    findingId: isFindingReviewFindingId(findingId) ? findingId : undefined,
    createdBy: createdBy && createdBy.length <= 100 ? createdBy : undefined,
    assetId: isFindingReviewCaseId(assetId) ? assetId : undefined,
    createdFrom,
    createdTo,
    sortBy: FINDING_REVIEW_SORT_FIELDS.includes(sortBy as FindingReviewCaseSortField)
      ? sortBy as FindingReviewCaseSortField : 'createdAt',
    sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
  };
}

export function reviewCaseLocationFromParams(
  params: Record<string, string | string[] | undefined>,
): ReviewCaseLocationState {
  const caseId = first(params.caseId);
  const requestedFindingId = first(params.create) === '1' ? first(params.findingId) : undefined;
  return {
    query: reviewCaseQueryFromParams(params),
    caseId: isFindingReviewCaseId(caseId) ? caseId : null,
    requestedFindingId: isFindingReviewFindingId(requestedFindingId) ? requestedFindingId : null,
  };
}

export function reviewCaseLocationFromSearchParams(
  params: URLSearchParams,
): ReviewCaseLocationState {
  return reviewCaseLocationFromParams(Object.fromEntries(params.entries()));
}

export function reviewCaseFilterFormFromQuery(
  query: FindingReviewCaseQuery,
  includeBrowserLocalDates = true,
): FindingReviewCaseFilterForm {
  return {
    status: query.status ?? '',
    staleness: query.staleness ?? '',
    findingType: query.findingType ?? '',
    findingId: query.findingId ?? '',
    createdBy: query.createdBy ?? '',
    assetId: query.assetId ?? '',
    createdFrom: includeBrowserLocalDates ? dateTimeLocalValue(query.createdFrom) : '',
    createdTo: includeBrowserLocalDates ? dateTimeLocalValue(query.createdTo) : '',
    sortBy: query.sortBy ?? 'createdAt',
    sortDirection: query.sortDirection ?? 'desc',
    pageSize: String(query.pageSize ?? 25),
  };
}

function dateTimeLocalValue(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isoFromDateTimeLocal(value: string): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]!
    || hour > 23
    || minute > 59
    || second > 59
  ) return undefined;
  const parsed = new Date(0);
  parsed.setFullYear(year, month - 1, day);
  parsed.setHours(hour, minute, second, millisecond);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
    || parsed.getHours() !== hour
    || parsed.getMinutes() !== minute
    || parsed.getSeconds() !== second
    || parsed.getMilliseconds() !== millisecond
  ) return undefined;
  return parsed.toISOString();
}

export function buildFindingReviewCaseQueryFromForm(
  form: FindingReviewCaseFilterForm,
): { query: FindingReviewCaseQuery | null; error: string | null } {
  const createdFrom = isoFromDateTimeLocal(form.createdFrom);
  const createdTo = isoFromDateTimeLocal(form.createdTo);
  if ((form.createdFrom && !createdFrom) || (form.createdTo && !createdTo)) {
    return { query: null, error: 'Informe datas e horários válidos.' };
  }
  if (createdFrom && createdTo && Date.parse(createdFrom) > Date.parse(createdTo)) {
    return { query: null, error: 'A data inicial não pode ser posterior à data final.' };
  }
  if (form.assetId && !isFindingReviewCaseId(form.assetId.trim())) {
    return { query: null, error: 'Informe um ID de ativo UUID válido.' };
  }
  if (form.findingId && !isFindingReviewFindingId(form.findingId.trim())) {
    return { query: null, error: 'Informe um ID de achado válido.' };
  }
  return {
    query: {
      page: 1,
      pageSize: Number(form.pageSize),
      status: form.status as FindingReviewCaseStatus || undefined,
      staleness: form.staleness as FindingReviewStaleness || undefined,
      findingType: form.findingType as FindingReviewCaseQuery['findingType'] || undefined,
      findingId: form.findingId.trim() || undefined,
      createdBy: form.createdBy.trim() || undefined,
      assetId: form.assetId.trim() || undefined,
      createdFrom,
      createdTo,
      sortBy: form.sortBy,
      sortDirection: form.sortDirection,
    },
    error: null,
  };
}

export function reviewCaseLocationUrl(
  query: FindingReviewCaseQuery,
  caseId: string | null,
  requestedFindingId: string | null,
): string {
  const search = new URLSearchParams(serializeFindingReviewCaseQuery(query));
  if (caseId) search.set('caseId', caseId);
  if (requestedFindingId) {
    search.set('create', '1');
    search.set('findingId', requestedFindingId);
  }
  const serialized = search.toString();
  return `/conflict-review-cases${serialized ? `?${serialized}` : ''}`;
}

export function defaultReviewCaseFilterForm(): FindingReviewCaseFilterForm {
  return reviewCaseFilterFormFromQuery({ ...DEFAULT_FINDING_REVIEW_CASE_QUERY });
}
