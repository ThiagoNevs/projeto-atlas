'use client';

import Link from 'next/link.js';
import {
  FormEvent,
  MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ErrorState, LoadingState } from './page-state';
import {
  ApiError,
  createFindingReviewDecision,
  createFindingReviewCase,
  getFindingReviewCase,
  getFindingReviewCases,
  updateFindingReviewCaseStatus,
  type ActiveFindingReviewCaseStatus,
  type CreateFindingReviewCaseResponse,
  type CreateFindingReviewDecisionResponse,
  type FindingReviewCaseDetail,
  type FindingReviewCaseListResponse,
  type FindingReviewCaseQuery,
  type FindingReviewCasesRequestOptions,
  type FindingReviewIdentityConclusion,
  type UpdateFindingReviewCaseStatusResponse,
} from '../lib/api';
import { CONFLICT_FINDING_TYPES, getConflictFindingTypeLabel } from '../lib/conflict-findings';
import {
  DEFAULT_FINDING_REVIEW_CASE_QUERY,
  FINDING_REVIEW_CASE_STATUSES,
  FINDING_REVIEW_SORT_FIELDS,
  FINDING_REVIEW_STALENESSES,
  MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH,
  createFindingReviewIdempotencyKey,
  getAllowedFindingReviewCaseStatusDestinations,
  getFindingReviewCaseStatusLabel,
  getFindingReviewIdentityConclusionLabel,
  getFindingReviewEventLabel,
  getFindingReviewStalenessLabel,
  isFindingReviewCaseId,
  isFindingReviewFindingId,
  isFindingReviewTimestamp,
  requiresFindingReviewCaseWaitingJustification,
  serializeFindingReviewCaseQuery,
  type FindingReviewCaseSortField,
  type FindingReviewCaseStatus,
  type FindingReviewSortDirection,
  type FindingReviewStaleness,
} from '../lib/finding-review-cases';
import { formatDateTime } from '../lib/format';

export type ReviewCasesLoader = (
  query: FindingReviewCaseQuery,
  options?: FindingReviewCasesRequestOptions,
) => Promise<FindingReviewCaseListResponse>;
export type ReviewCaseDetailLoader = (
  id: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<FindingReviewCaseDetail>;
export type ReviewCaseCreator = (
  findingId: string,
  key: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<CreateFindingReviewCaseResponse>;
export type ReviewCaseStatusUpdater = (
  id: string,
  status: ActiveFindingReviewCaseStatus,
  expectedVersion: number,
  justification?: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<UpdateFindingReviewCaseStatusResponse>;
export type ReviewCaseDecisionCreator = (
  id: string,
  identityConclusion: FindingReviewIdentityConclusion,
  justification: string,
  expectedVersion: number,
  key: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<CreateFindingReviewDecisionResponse>;

interface Props {
  initialSearchParams?: Record<string, string | string[] | undefined>;
  loadCases?: ReviewCasesLoader;
  loadDetail?: ReviewCaseDetailLoader;
  createCase?: ReviewCaseCreator;
  updateStatus?: ReviewCaseStatusUpdater;
  createDecision?: ReviewCaseDecisionCreator;
}

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

interface LocationState {
  query: FindingReviewCaseQuery;
  caseId: string | null;
  requestedFindingId: string | null;
}

const DETAIL_PANEL_ID = 'finding-review-case-detail';
const IDEMPOTENCY_STORAGE_PREFIX = 'atlas:pending-review-case:';
const DECISION_STORAGE_PREFIX = 'atlas:pending-review-decision:';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/=-]{1,128}$/;
export const PENDING_REVIEW_CASE_ATTEMPT_TTL_MS = 15 * 60 * 1000;
export const PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS = 15 * 60 * 1000;
export const MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH = 1000;

export interface PendingFindingReviewCaseAttempt {
  version: 1;
  findingId: string;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

type PendingAttemptInspection =
  | { status: 'valid'; attempt: PendingFindingReviewCaseAttempt }
  | { status: 'invalid' | 'expired'; attempt: null };

type StoredPendingAttempt = PendingAttemptInspection
  | { status: 'missing'; attempt: null };

export interface PendingFindingReviewDecisionAttempt {
  version: 1;
  caseId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  expectedVersion: number;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
}

type PendingDecisionInspection =
  | { status: 'valid'; attempt: PendingFindingReviewDecisionAttempt }
  | { status: 'invalid' | 'expired'; attempt: null };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number, maximum?: number): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
}

function queryFromParams(
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

function locationFromParams(
  params: Record<string, string | string[] | undefined>,
): LocationState {
  const caseId = first(params.caseId);
  const requestedFindingId = first(params.create) === '1' ? first(params.findingId) : undefined;
  return {
    query: queryFromParams(params),
    caseId: isFindingReviewCaseId(caseId) ? caseId : null,
    requestedFindingId: isFindingReviewFindingId(requestedFindingId) ? requestedFindingId : null,
  };
}

function browserLocationState(): LocationState {
  return locationFromParams(Object.fromEntries(new URLSearchParams(window.location.search).entries()));
}

function formFromQuery(
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
  ) {
    return undefined;
  }
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
  ) {
    return undefined;
  }
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

function locationUrl(
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

function pushLocation(
  query: FindingReviewCaseQuery,
  caseId: string | null,
  requestedFindingId: string | null,
): void {
  window.history.pushState(null, '', locationUrl(query, caseId, requestedFindingId));
}

function displayError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 503) {
    return 'O fluxo de casos de revisão está temporariamente indisponível.';
  }
  return error instanceof Error ? error.message : fallback;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || (
    error instanceof ApiError && error.status === 0 && /cancelada/i.test(error.message)
  ));
}

function pendingStorageKey(findingId: string): string {
  return `${IDEMPOTENCY_STORAGE_PREFIX}${findingId}`;
}

export function createPendingFindingReviewCaseAttempt(
  findingId: string,
  idempotencyKey: string,
  now = Date.now(),
): PendingFindingReviewCaseAttempt {
  return {
    version: 1,
    findingId,
    idempotencyKey,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PENDING_REVIEW_CASE_ATTEMPT_TTL_MS).toISOString(),
  };
}

export function parsePendingFindingReviewCaseAttempt(
  serialized: string,
  expectedFindingId: string,
  now = Date.now(),
): PendingFindingReviewCaseAttempt | null {
  const inspected = inspectPendingFindingReviewCaseAttempt(serialized, expectedFindingId, now);
  return inspected.status === 'valid' ? inspected.attempt : null;
}

function inspectPendingFindingReviewCaseAttempt(
  serialized: string,
  expectedFindingId: string,
  now = Date.now(),
): PendingAttemptInspection {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', attempt: null };
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'createdAt,expiresAt,findingId,idempotencyKey,version') {
      return { status: 'invalid', attempt: null };
    }
    if (
      candidate.version !== 1
      || candidate.findingId !== expectedFindingId
      || !isFindingReviewFindingId(candidate.findingId)
      || typeof candidate.idempotencyKey !== 'string'
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.expiresAt !== 'string'
    ) {
      return { status: 'invalid', attempt: null };
    }
    const createdAt = Date.parse(candidate.createdAt);
    const expiresAt = Date.parse(candidate.expiresAt);
    if (
      !Number.isFinite(createdAt)
      || !Number.isFinite(expiresAt)
      || new Date(createdAt).toISOString() !== candidate.createdAt
      || new Date(expiresAt).toISOString() !== candidate.expiresAt
      || createdAt > now
      || expiresAt - createdAt !== PENDING_REVIEW_CASE_ATTEMPT_TTL_MS
    ) {
      return { status: 'invalid', attempt: null };
    }
    if (expiresAt <= now) return { status: 'expired', attempt: null };
    return {
      status: 'valid',
      attempt: candidate as unknown as PendingFindingReviewCaseAttempt,
    };
  } catch {
    return { status: 'invalid', attempt: null };
  }
}

function readPendingFindingReviewCaseAttempt(findingId: string): StoredPendingAttempt {
  try {
    const storageKey = pendingStorageKey(findingId);
    const serialized = window.sessionStorage.getItem(storageKey);
    if (serialized === null) return { status: 'missing', attempt: null };
    const inspected = inspectPendingFindingReviewCaseAttempt(serialized, findingId);
    if (inspected.status !== 'valid') {
      window.sessionStorage.removeItem(storageKey);
    }
    return inspected;
  } catch {
    return { status: 'missing', attempt: null };
  }
}

function storePendingFindingReviewCaseAttempt(attempt: PendingFindingReviewCaseAttempt): void {
  try {
    window.sessionStorage.setItem(
      pendingStorageKey(attempt.findingId),
      JSON.stringify(attempt),
    );
  } catch {
    // The complete in-memory attempt still protects its original TTL while this page remains mounted.
  }
}

function clearPendingFindingReviewCaseAttempt(
  findingId: string,
  expectedAttempt?: PendingFindingReviewCaseAttempt,
): void {
  try {
    const storageKey = pendingStorageKey(findingId);
    const serialized = window.sessionStorage.getItem(storageKey);
    if (
      serialized !== null
      && (!expectedAttempt || serialized === JSON.stringify(expectedAttempt))
    ) {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Storage can be unavailable in restrictive browser contexts.
  }
}

function pendingAttemptDiscardedMessage(status: 'invalid' | 'expired'): string {
  if (status === 'expired') {
    return 'A tentativa anterior expirou e foi descartada. Clique novamente para iniciar uma nova tentativa.';
  }
  return 'O registro temporário da tentativa era inválido e foi descartado. Clique novamente para iniciar uma nova tentativa.';
}

function mergeDecisionHistory(
  history: FindingReviewCaseDetail['decisionHistory'],
  decision: CreateFindingReviewDecisionResponse['decision'],
): FindingReviewCaseDetail['decisionHistory'] {
  return [...history.filter((item) => item.id !== decision.id), decision]
    .sort((left, right) => {
      if (left.caseVersion !== right.caseVersion) return left.caseVersion - right.caseVersion;
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
}

function decisionStorageKey(caseId: string): string {
  return `${DECISION_STORAGE_PREFIX}${caseId}`;
}

export function createPendingFindingReviewDecisionAttempt(
  caseId: string,
  identityConclusion: FindingReviewIdentityConclusion,
  justification: string,
  expectedVersion: number,
  idempotencyKey: string,
  now = Date.now(),
): PendingFindingReviewDecisionAttempt {
  return {
    version: 1,
    caseId,
    identityConclusion,
    justification,
    expectedVersion,
    idempotencyKey,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS).toISOString(),
  };
}

export function parsePendingFindingReviewDecisionAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingFindingReviewDecisionAttempt | null {
  const inspected = inspectPendingFindingReviewDecisionAttempt(serialized, expectedCaseId, now);
  return inspected.status === 'valid' ? inspected.attempt : null;
}

function inspectPendingFindingReviewDecisionAttempt(
  serialized: string,
  expectedCaseId: string,
  now = Date.now(),
): PendingDecisionInspection {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { status: 'invalid', attempt: null };
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).sort();
    if (keys.join(',') !== 'caseId,createdAt,expectedVersion,expiresAt,idempotencyKey,identityConclusion,justification,version') {
      return { status: 'invalid', attempt: null };
    }
    if (
      candidate.version !== 1
      || candidate.caseId !== expectedCaseId
      || !isFindingReviewCaseId(candidate.caseId)
      || (candidate.identityConclusion !== 'SAME_ASSET'
        && candidate.identityConclusion !== 'DIFFERENT_ASSETS')
      || typeof candidate.justification !== 'string'
      || candidate.justification.length < 1
      || candidate.justification.length > MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH
      || candidate.justification !== candidate.justification.trim()
      || !Number.isSafeInteger(candidate.expectedVersion)
      || Number(candidate.expectedVersion) < 1
      || typeof candidate.idempotencyKey !== 'string'
      || !IDEMPOTENCY_KEY_PATTERN.test(candidate.idempotencyKey)
      || typeof candidate.createdAt !== 'string'
      || typeof candidate.expiresAt !== 'string'
    ) return { status: 'invalid', attempt: null };
    const createdAt = Date.parse(candidate.createdAt);
    const expiresAt = Date.parse(candidate.expiresAt);
    if (
      !Number.isFinite(createdAt)
      || !Number.isFinite(expiresAt)
      || new Date(createdAt).toISOString() !== candidate.createdAt
      || new Date(expiresAt).toISOString() !== candidate.expiresAt
      || createdAt > now
      || expiresAt - createdAt !== PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS
    ) return { status: 'invalid', attempt: null };
    if (expiresAt <= now) return { status: 'expired', attempt: null };
    return { status: 'valid', attempt: candidate as unknown as PendingFindingReviewDecisionAttempt };
  } catch {
    return { status: 'invalid', attempt: null };
  }
}

function readPendingFindingReviewDecisionAttempt(caseId: string): PendingDecisionInspection | {
  status: 'missing'; attempt: null;
} {
  try {
    const key = decisionStorageKey(caseId);
    const serialized = window.sessionStorage.getItem(key);
    if (serialized === null) return { status: 'missing', attempt: null };
    const inspected = inspectPendingFindingReviewDecisionAttempt(serialized, caseId);
    if (inspected.status !== 'valid') window.sessionStorage.removeItem(key);
    return inspected;
  } catch {
    return { status: 'missing', attempt: null };
  }
}

function storePendingFindingReviewDecisionAttempt(
  attempt: PendingFindingReviewDecisionAttempt,
): void {
  try {
    window.sessionStorage.setItem(decisionStorageKey(attempt.caseId), JSON.stringify(attempt));
  } catch {
    // The in-memory envelope remains available during this mounted page.
  }
}

function clearPendingFindingReviewDecisionAttempt(
  caseId: string,
  expectedAttempt?: PendingFindingReviewDecisionAttempt,
): void {
  try {
    const key = decisionStorageKey(caseId);
    const serialized = window.sessionStorage.getItem(key);
    if (serialized !== null && (!expectedAttempt || serialized === JSON.stringify(expectedAttempt))) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in restrictive browser contexts.
  }
}

export function FindingReviewCasesPage({
  initialSearchParams = {},
  loadCases = getFindingReviewCases,
  loadDetail = getFindingReviewCase,
  createCase = createFindingReviewCase,
  updateStatus = updateFindingReviewCaseStatus,
  createDecision = createFindingReviewDecision,
}: Props) {
  const firstLocation = useMemo(() => locationFromParams(initialSearchParams), [initialSearchParams]);
  const [query, setQuery] = useState<FindingReviewCaseQuery>(firstLocation.query);
  const queryRef = useRef(firstLocation.query);
  const [form, setForm] = useState<FindingReviewCaseFilterForm>(
    () => formFromQuery(firstLocation.query, false),
  );
  const initialDateHydrationSuperseded = useRef(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [result, setResult] = useState<FindingReviewCaseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listReload, setListReload] = useState(0);
  const mounted = useRef(false);
  const listSequence = useRef(0);
  const listController = useRef<AbortController | null>(null);

  const [detail, setDetail] = useState<FindingReviewCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(firstLocation.caseId));
  const [detailError, setDetailError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(firstLocation.caseId);
  const expandedIdRef = useRef<string | null>(firstLocation.caseId);
  const detailSequence = useRef(0);
  const detailController = useRef<AbortController | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const detailFocusFrame = useRef<number | null>(null);
  const restoreFocusFrame = useRef<number | null>(null);

  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);
  const [statusConflict, setStatusConflict] = useState(false);
  const statusInFlight = useRef(false);
  const statusController = useRef<AbortController | null>(null);
  const statusSequence = useRef(0);

  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSuccess, setDecisionSuccess] = useState<string | null>(null);
  const [decisionUncertain, setDecisionUncertain] = useState(false);
  const [decisionReloadRequired, setDecisionReloadRequired] = useState(false);
  const decisionInFlight = useRef(false);
  const decisionController = useRef<AbortController | null>(null);
  const decisionSequence = useRef(0);
  const pendingDecisionAttempt = useRef<PendingFindingReviewDecisionAttempt | null>(null);

  const [requestedFindingId, setRequestedFindingId] = useState<string | null>(
    firstLocation.requestedFindingId,
  );
  const [creationLoading, setCreationLoading] = useState(false);
  const [creationResult, setCreationResult] = useState<CreateFindingReviewCaseResponse | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [existingCaseId, setExistingCaseId] = useState<string | null>(null);
  const creationInFlight = useRef(false);
  const creationController = useRef<AbortController | null>(null);
  const creationSequence = useRef(0);
  const pendingCreationAttempt = useRef<PendingFindingReviewCaseAttempt | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listSequence.current += 1;
      detailSequence.current += 1;
      creationSequence.current += 1;
      listController.current?.abort();
      detailController.current?.abort();
      creationController.current?.abort();
      statusSequence.current += 1;
      statusController.current?.abort();
      if (decisionInFlight.current && pendingDecisionAttempt.current) {
        storePendingFindingReviewDecisionAttempt(pendingDecisionAttempt.current);
      }
      decisionSequence.current += 1;
      decisionController.current?.abort();
      if (detailFocusFrame.current !== null) {
        window.cancelAnimationFrame(detailFocusFrame.current);
        detailFocusFrame.current = null;
      }
      if (restoreFocusFrame.current !== null) {
        window.cancelAnimationFrame(restoreFocusFrame.current);
        restoreFocusFrame.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Keep the server and the first browser render timezone-independent. Local
    // datetime values are populated only after hydration in the browser.
    const frame = window.requestAnimationFrame(() => {
      if (!initialDateHydrationSuperseded.current) setForm(formFromQuery(firstLocation.query));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [firstLocation.query]);

  useEffect(() => {
    const controller = new AbortController();
    listController.current = controller;
    const sequence = ++listSequence.current;
    const expectedQuery = serializeFindingReviewCaseQuery(query);
    queryRef.current = query;

    void loadCases(query, { signal: controller.signal })
      .then((value) => {
        if (!canCommitList(sequence, controller, expectedQuery)) return;
        setResult(value);
      })
      .catch((cause) => {
        if (!canCommitList(sequence, controller, expectedQuery) || isAbort(cause)) return;
        setError(displayError(cause, 'Não foi possível carregar os casos.'));
      })
      .finally(() => {
        if (!canCommitList(sequence, controller, expectedQuery)) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, [listReload, loadCases, query]);

  useEffect(() => {
    if (!expandedId) return;
    const requestedId = expandedId;
    const controller = new AbortController();
    detailController.current = controller;
    const sequence = ++detailSequence.current;

    void loadDetail(requestedId, { signal: controller.signal })
      .then((value) => {
        if (!canCommitDetail(sequence, controller, requestedId)) return;
        setDetail(value);
        restorePendingDecisionForDetail(value);
      })
      .catch((cause) => {
        if (!canCommitDetail(sequence, controller, requestedId) || isAbort(cause)) return;
        setDetailError(displayError(cause, 'Não foi possível carregar o detalhe do caso.'));
      })
      .finally(() => {
        if (!canCommitDetail(sequence, controller, requestedId)) return;
        setDetailLoading(false);
      });

    return () => controller.abort();
  }, [detailReload, expandedId, loadDetail]);

  useEffect(() => {
    const restoreFromUrl = (): void => {
      const restored = browserLocationState();
      if (restoreFocusFrame.current !== null) {
        window.cancelAnimationFrame(restoreFocusFrame.current);
        restoreFocusFrame.current = null;
      }
      initialDateHydrationSuperseded.current = true;
      invalidateListRequest();
      queryRef.current = restored.query;
      setLoading(true);
      setError(null);
      setFilterError(null);
      setForm(formFromQuery(restored.query));
      setQuery(restored.query);
      creationSequence.current += 1;
      creationController.current?.abort();
      creationController.current = null;
      pendingCreationAttempt.current = null;
      creationInFlight.current = false;
      setCreationLoading(false);
      setCreationResult(null);
      setCreationError(null);
      setExistingCaseId(null);
      setRequestedFindingId(restored.requestedFindingId);
      if (restored.caseId !== expandedIdRef.current) {
        invalidateDecisionRequest();
        invalidateStatusRequest();
        invalidateDetailRequest();
        detailTrigger.current = null;
        expandedIdRef.current = restored.caseId;
        setExpandedId(restored.caseId);
        setDetail(null);
        setDetailError(null);
        setDetailLoading(Boolean(restored.caseId));
      }
    };
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
  }, []);

  useEffect(() => {
    if (detailFocusFrame.current !== null) {
      window.cancelAnimationFrame(detailFocusFrame.current);
      detailFocusFrame.current = null;
    }
    if (
      !expandedId
      || detailLoading
      || (!detail && !detailError)
      || !detailHeading.current
    ) return;
    const requestedId = expandedId;
    const requestedHeading = detailHeading.current;
    detailFocusFrame.current = window.requestAnimationFrame(() => {
      detailFocusFrame.current = null;
      if (
        mounted.current
        && expandedIdRef.current === requestedId
        && detailHeading.current === requestedHeading
      ) {
        requestedHeading.focus();
      }
    });
    return () => {
      if (detailFocusFrame.current !== null) {
        window.cancelAnimationFrame(detailFocusFrame.current);
        detailFocusFrame.current = null;
      }
    };
  }, [detail, detailError, detailLoading, expandedId]);

  function canCommitList(
    sequence: number,
    controller: AbortController,
    expectedQuery: string,
  ): boolean {
    return mounted.current
      && sequence === listSequence.current
      && !controller.signal.aborted
      && expectedQuery === serializeFindingReviewCaseQuery(queryRef.current);
  }

  function canCommitDetail(
    sequence: number,
    controller: AbortController,
    requestedId: string,
  ): boolean {
    return mounted.current
      && sequence === detailSequence.current
      && !controller.signal.aborted
      && expandedIdRef.current === requestedId;
  }

  function invalidateListRequest(): void {
    listSequence.current += 1;
    listController.current?.abort();
    listController.current = null;
  }

  function invalidateDetailRequest(): void {
    detailSequence.current += 1;
    detailController.current?.abort();
    detailController.current = null;
    if (detailFocusFrame.current !== null) {
      window.cancelAnimationFrame(detailFocusFrame.current);
      detailFocusFrame.current = null;
    }
  }

  function invalidateStatusRequest(): void {
    statusSequence.current += 1;
    statusController.current?.abort();
    statusController.current = null;
    statusInFlight.current = false;
    setStatusLoading(false);
    setStatusError(null);
    setStatusSuccess(null);
    setStatusConflict(false);
  }

  function restorePendingDecisionForDetail(value: FindingReviewCaseDetail): void {
    if (value.currentDecision) {
      clearPendingFindingReviewDecisionAttempt(value.id);
      pendingDecisionAttempt.current = null;
      setDecisionUncertain(false);
      return;
    }
    const stored = readPendingFindingReviewDecisionAttempt(value.id);
    if (stored.status === 'valid') {
      pendingDecisionAttempt.current = stored.attempt;
      setDecisionUncertain(true);
      setDecisionError(null);
    } else if (stored.status === 'invalid' || stored.status === 'expired') {
      pendingDecisionAttempt.current = null;
      setDecisionUncertain(false);
      setDecisionError(stored.status === 'expired'
        ? 'A tentativa incerta anterior expirou e foi descartada.'
        : 'A tentativa incerta armazenada era inválida e foi descartada.');
    }
  }

  function invalidateDecisionRequest(persistUncertain = true): void {
    if (persistUncertain && decisionInFlight.current && pendingDecisionAttempt.current) {
      storePendingFindingReviewDecisionAttempt(pendingDecisionAttempt.current);
    }
    decisionSequence.current += 1;
    decisionController.current?.abort();
    decisionController.current = null;
    decisionInFlight.current = false;
    setDecisionLoading(false);
    setDecisionError(null);
    setDecisionSuccess(null);
    setDecisionUncertain(false);
    setDecisionReloadRequired(false);
    pendingDecisionAttempt.current = null;
  }

  function updateQuery(next: FindingReviewCaseQuery, nextRequestedFindingId = requestedFindingId): void {
    invalidateListRequest();
    queryRef.current = next;
    setLoading(true);
    setError(null);
    pushLocation(next, expandedIdRef.current, nextRequestedFindingId);
    updateRequestedFinding(nextRequestedFindingId);
    setQuery(next);
  }

  function updateRequestedFinding(next: string | null): void {
    if (next === requestedFindingId) return;
    creationSequence.current += 1;
    creationController.current?.abort();
    creationController.current = null;
    pendingCreationAttempt.current = null;
    creationInFlight.current = false;
    setCreationLoading(false);
    setCreationResult(null);
    setCreationError(null);
    setExistingCaseId(null);
    setRequestedFindingId(next);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = buildFindingReviewCaseQueryFromForm(form);
    setFilterError(parsed.error);
    if (parsed.query) updateQuery(parsed.query, null);
  }

  function clearFilters(): void {
    const next = { ...DEFAULT_FINDING_REVIEW_CASE_QUERY };
    setForm(formFromQuery(next));
    setFilterError(null);
    updateQuery(next, null);
  }

  function retryList(): void {
    invalidateListRequest();
    setLoading(true);
    setError(null);
    setListReload((value) => value + 1);
  }

  function changePage(page: number): void {
    if (page < 1 || page === query.page) return;
    updateQuery({ ...query, page });
  }

  function openDetail(id: string, trigger?: HTMLButtonElement): void {
    if (!isFindingReviewCaseId(id)) return;
    if (restoreFocusFrame.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrame.current);
      restoreFocusFrame.current = null;
    }
    if (expandedIdRef.current === id) {
      closeDetail(true);
      return;
    }
    invalidateDecisionRequest();
    invalidateStatusRequest();
    invalidateDetailRequest();
    if (trigger) detailTrigger.current = trigger;
    else detailTrigger.current = null;
    expandedIdRef.current = id;
    setExpandedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    pushLocation(queryRef.current, id, requestedFindingId);
  }

  function closeDetail(updateHistory: boolean): void {
    invalidateDecisionRequest();
    invalidateStatusRequest();
    invalidateDetailRequest();
    expandedIdRef.current = null;
    setExpandedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    if (updateHistory) pushLocation(queryRef.current, null, requestedFindingId);
    const trigger = detailTrigger.current;
    detailTrigger.current = null;
    if (restoreFocusFrame.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrame.current);
    }
    restoreFocusFrame.current = window.requestAnimationFrame(() => {
      restoreFocusFrame.current = null;
      if (mounted.current && expandedIdRef.current === null) trigger?.focus();
    });
  }

  function retryDetail(): void {
    const current = expandedIdRef.current;
    if (!current) return;
    invalidateDetailRequest();
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setDetailReload((value) => value + 1);
  }

  async function submitStatusTransition(
    target: ActiveFindingReviewCaseStatus,
    justification?: string,
  ): Promise<void> {
    const current = detail;
    if (
      !current
      || expandedIdRef.current !== current.id
      || statusInFlight.current
      || decisionInFlight.current
      || !getAllowedFindingReviewCaseStatusDestinations(current.status).includes(target)
    ) return;

    invalidateDetailRequest();
    const controller = new AbortController();
    const sequence = ++statusSequence.current;
    const expectedId = current.id;
    const expectedVersion = current.version;
    statusController.current = controller;
    statusInFlight.current = true;
    setStatusLoading(true);
    setStatusError(null);
    setStatusSuccess(null);
    setStatusConflict(false);

    try {
      const updated = await updateStatus(expectedId, target, expectedVersion, justification, {
        signal: controller.signal,
      });
      if (
        updated.id !== expectedId
        || updated.status !== target
        || updated.version !== expectedVersion + 1
      ) {
        throw new ApiError('A API retornou uma transição incompatível com a solicitação.', 502);
      }
      if (!canCommitStatus(sequence, controller, expectedId)) return;
      setDetail((value) => value?.id === expectedId ? {
        ...value,
        status: updated.status,
        version: updated.version,
        updatedAt: updated.updatedAt,
      } : value);
      setStatusSuccess(`Status alterado para ${getFindingReviewCaseStatusLabel(updated.status)}.`);
      setListReload((value) => value + 1);
      setDetailReload((value) => value + 1);
    } catch (cause) {
      if (!canCommitStatus(sequence, controller, expectedId) || isAbort(cause)) return;
      if (cause instanceof ApiError && cause.status === 409) {
        setStatusConflict(true);
        setStatusError('Este caso foi alterado por outra operação. Recarregue os dados antes de tentar novamente.');
      } else if (cause instanceof ApiError && cause.status === 400) {
        setStatusError('A transição solicitada não é permitida para o estado atual do caso.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setStatusError('O caso não foi encontrado. Recarregue a lista para confirmar sua situação.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setStatusError('As transições de casos estão indisponíveis neste ambiente. Nenhum dado foi alterado.');
      } else {
        setStatusConflict(true);
        setStatusError('Não foi possível confirmar o resultado. Recarregue o caso para verificar o estado atual.');
      }
    } finally {
      if (sequence === statusSequence.current) statusInFlight.current = false;
      if (statusController.current === controller) statusController.current = null;
      if (mounted.current && sequence === statusSequence.current) setStatusLoading(false);
    }
  }

  function canCommitStatus(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === statusSequence.current
      && !controller.signal.aborted
      && expandedIdRef.current === expectedId;
  }

  function reloadAfterStatusConflict(): void {
    setStatusError(null);
    setStatusConflict(false);
    setStatusSuccess(null);
    retryDetail();
    retryList();
  }

  async function submitDecision(
    identityConclusion?: FindingReviewIdentityConclusion,
    justification?: string,
  ): Promise<void> {
    const current = detail;
    if (
      !current
      || expandedIdRef.current !== current.id
      || decisionInFlight.current
      || statusInFlight.current
    ) return;

    let attempt = pendingDecisionAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewDecisionAttempt(
        JSON.stringify(attempt),
        current.id,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewDecisionAttempt(current.id, attempt);
        pendingDecisionAttempt.current = null;
        setDecisionUncertain(false);
        setDecisionError(inspected.status === 'expired'
          ? 'A tentativa incerta expirou. Revise a decisão antes de iniciar uma nova tentativa.'
          : 'A tentativa incerta era inválida e foi descartada. Revise a decisão novamente.');
        return;
      }
      attempt = inspected.attempt;
    } else {
      const normalizedJustification = justification?.trim() ?? '';
      if (!identityConclusion || normalizedJustification.length < 1) return;
      attempt = createPendingFindingReviewDecisionAttempt(
        current.id,
        identityConclusion,
        normalizedJustification,
        current.version,
        createFindingReviewIdempotencyKey(() => crypto.randomUUID()),
      );
      pendingDecisionAttempt.current = attempt;
    }

    const controller = new AbortController();
    const sequence = ++decisionSequence.current;
    const expectedId = attempt.caseId;
    decisionController.current = controller;
    decisionInFlight.current = true;
    setDecisionLoading(true);
    setDecisionError(null);
    setDecisionSuccess(null);
    setDecisionReloadRequired(false);

    try {
      const created = await createDecision(
        attempt.caseId,
        attempt.identityConclusion,
        attempt.justification,
        attempt.expectedVersion,
        attempt.idempotencyKey,
        { signal: controller.signal },
      );
      if (
        created.decision.caseId !== expectedId
        || created.decision.identityConclusion !== attempt.identityConclusion
        || created.decision.justification !== attempt.justification
        || created.decision.caseVersion !== attempt.expectedVersion + 1
      ) throw new ApiError('A API retornou uma decisão incompatível com a solicitação.', 502);

      clearPendingFindingReviewDecisionAttempt(expectedId, attempt);
      if (pendingDecisionAttempt.current === attempt) pendingDecisionAttempt.current = null;
      if (!canCommitDecision(sequence, controller, expectedId)) return;
      setDecisionUncertain(false);
      setDetail((value) => value?.id === expectedId ? {
        ...value,
        currentDecision: created.decision,
        decisionHistory: mergeDecisionHistory(value.decisionHistory, created.decision),
        version: created.decision.caseVersion,
      } : value);
      setDecisionSuccess(created.idempotentReplay
        ? 'Decisão já registrada, recuperada com segurança.'
        : 'Decisão registrada com sucesso.');
      setListReload((value) => value + 1);
      void refreshDecisionDetail(expectedId, sequence);
    } catch (cause) {
      const conclusive = cause instanceof ApiError
        && [400, 404, 409, 422, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewDecisionAttempt(expectedId, attempt);
        if (pendingDecisionAttempt.current === attempt) pendingDecisionAttempt.current = null;
      } else {
        storePendingFindingReviewDecisionAttempt(attempt);
      }
      if (!canCommitDecision(sequence, controller, expectedId)) return;
      if (!conclusive) {
        setDecisionUncertain(true);
        setDecisionError('Não foi possível confirmar se a decisão foi registrada. Tente novamente para consultar o mesmo resultado com segurança. A mesma chave idempotente será reutilizada.');
      } else if (cause instanceof ApiError && cause.code === 'IDEMPOTENCY_KEY_REUSED') {
        setDecisionUncertain(false);
        setDecisionReloadRequired(true);
        setDecisionError('Esta tentativa não corresponde à operação original associada à chave de segurança. Recarregue o caso antes de iniciar uma nova decisão.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_VERSION_CONFLICT') {
        setDecisionUncertain(false);
        setDecisionReloadRequired(true);
        setDecisionError('O caso foi alterado desde que você iniciou esta decisão.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_DECISION_ALREADY_RECORDED') {
        setDecisionUncertain(false);
        setDecisionError('Uma decisão já foi registrada para este caso. Os dados atuais serão recarregados.');
        void refreshDecisionDetail(expectedId, sequence);
      } else if (cause instanceof ApiError && cause.status === 422) {
        setDecisionUncertain(false);
        setDecisionError('A decisão não é mais permitida para o estado ou snapshot atual do caso.');
        void refreshDecisionDetail(expectedId, sequence);
      } else if (cause instanceof ApiError && cause.status === 404) {
        setDecisionUncertain(false);
        setDecisionError('O caso não foi encontrado. Recarregue a lista para confirmar sua situação.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setDecisionUncertain(false);
        setDecisionError('O registro de decisões está indisponível neste ambiente. Nenhum dado foi alterado.');
      } else {
        setDecisionUncertain(false);
        setDecisionError(displayError(cause, 'Não foi possível registrar a decisão.'));
      }
    } finally {
      if (sequence === decisionSequence.current) decisionInFlight.current = false;
      if (decisionController.current === controller) decisionController.current = null;
      if (mounted.current && sequence === decisionSequence.current) setDecisionLoading(false);
    }
  }

  function canCommitDecision(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === decisionSequence.current
      && !controller.signal.aborted
      && expandedIdRef.current === expectedId;
  }

  async function refreshDecisionDetail(
    caseId: string,
    expectedSequence = decisionSequence.current,
  ): Promise<void> {
    try {
      const refreshed = await loadDetail(caseId);
      if (
        !mounted.current
        || expandedIdRef.current !== caseId
        || decisionSequence.current !== expectedSequence
      ) return;
      setDetail((current) => {
        if (current?.id === caseId && current.currentDecision && !refreshed.currentDecision) {
          return {
            ...refreshed,
            currentDecision: current.currentDecision,
            decisionHistory: mergeDecisionHistory(
              refreshed.decisionHistory,
              current.currentDecision,
            ),
            version: Math.max(refreshed.version, current.version),
          };
        }
        return refreshed;
      });
      setDecisionReloadRequired(false);
      setListReload((value) => value + 1);
    } catch {
      if (
        !mounted.current
        || expandedIdRef.current !== caseId
        || decisionSequence.current !== expectedSequence
      ) return;
      setDecisionError((value) => value
        ?? 'A decisão foi confirmada, mas não foi possível atualizar todos os dados do caso.');
    }
  }

  function reloadAfterDecisionConflict(): void {
    pendingDecisionAttempt.current = null;
    setDecisionUncertain(false);
    setDecisionError(null);
    setDecisionSuccess(null);
    setDecisionReloadRequired(false);
    retryDetail();
    retryList();
  }

  async function submitCreation(): Promise<void> {
    if (!requestedFindingId || creationInFlight.current) return;
    const creationFindingId = requestedFindingId;
    let attempt = pendingCreationAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewCaseAttempt(
        JSON.stringify(attempt),
        creationFindingId,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewCaseAttempt(creationFindingId, attempt);
        pendingCreationAttempt.current = null;
        setCreationError(pendingAttemptDiscardedMessage(inspected.status));
        setExistingCaseId(null);
        return;
      }
      attempt = inspected.attempt;
      pendingCreationAttempt.current = attempt;
    } else {
      const stored = readPendingFindingReviewCaseAttempt(creationFindingId);
      if (stored.status === 'invalid' || stored.status === 'expired') {
        setCreationError(pendingAttemptDiscardedMessage(stored.status));
        setExistingCaseId(null);
        return;
      }
      attempt = stored.status === 'valid'
        ? stored.attempt
        : createPendingFindingReviewCaseAttempt(
          creationFindingId,
          createFindingReviewIdempotencyKey(() => crypto.randomUUID()),
        );
      pendingCreationAttempt.current = attempt;
    }
    const sequence = ++creationSequence.current;
    creationInFlight.current = true;
    const controller = new AbortController();
    creationController.current = controller;
    setCreationLoading(true);
    setCreationError(null);
    setExistingCaseId(null);
    try {
      const created = await createCase(creationFindingId, attempt.idempotencyKey, {
        signal: controller.signal,
      });
      clearPendingFindingReviewCaseAttempt(creationFindingId, attempt);
      if (pendingCreationAttempt.current === attempt) pendingCreationAttempt.current = null;
      if (!mounted.current || sequence !== creationSequence.current) return;
      setCreationResult(created);
      openDetail(created.id);
      retryList();
    } catch (cause) {
      const conclusive = cause instanceof ApiError
        && [400, 404, 409, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewCaseAttempt(creationFindingId, attempt);
        if (pendingCreationAttempt.current === attempt) pendingCreationAttempt.current = null;
      } else {
        storePendingFindingReviewCaseAttempt(attempt);
      }
      if (!mounted.current || sequence !== creationSequence.current) return;
      if (cause instanceof ApiError && cause.status === 409 && cause.existingCaseId) {
        setExistingCaseId(cause.existingCaseId);
        setCreationError('Já existe um caso ativo para este assunto.');
      } else if (cause instanceof ApiError && cause.status === 409) {
        setCreationError('A chave da tentativa anterior não pode ser reutilizada. Tente novamente.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setCreationError('A criação de casos está desabilitada neste ambiente. Nenhum dado foi alterado.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setCreationError('O achado não está mais disponível. Atualize a lista de achados antes de tentar novamente.');
      } else if (cause instanceof ApiError && cause.status === 400) {
        setCreationError('A solicitação de criação é inválida. Revise o achado selecionado.');
      } else {
        setCreationError(
          'Não foi possível confirmar o resultado. Tente novamente: a mesma chave idempotente será reutilizada.',
        );
      }
    } finally {
      if (sequence === creationSequence.current) creationInFlight.current = false;
      if (creationController.current === controller) creationController.current = null;
      if (mounted.current && sequence === creationSequence.current) setCreationLoading(false);
    }
  }

  return (
    <main className="page-shell review-cases-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Revisão humana auditável</p>
          <h1>Casos de revisão</h1>
          <p className="page-description">Acompanhe casos persistidos sem alterar automaticamente o inventário.</p>
        </div>
        {result ? <div className="summary-pill"><strong>{result.pagination.totalItems}</strong><span>casos encontrados</span></div> : null}
      </header>

      {requestedFindingId ? (
        <section className="review-create-card" aria-labelledby="review-create-title">
          <div>
            <p className="section-kicker">Achado selecionado</p>
            <h2 id="review-create-title">Criar caso de revisão</h2>
            <code>{requestedFindingId}</code>
            <p>A criação preserva um snapshot histórico. Ela não decide o achado e não altera ativos.</p>
          </div>
          <button className="button button-primary" type="button" disabled={creationLoading || Boolean(creationResult)} onClick={() => void submitCreation()}>
            {creationLoading ? 'Criando…' : creationResult ? 'Caso registrado' : 'Criar caso'}
          </button>
          {creationResult ? <p className="form-message form-message-success" role="status">{creationResult.idempotentReplay ? 'Caso recuperado por replay idempotente.' : 'Caso criado com sucesso.'}</p> : null}
          {creationError ? <div className="form-message form-message-error" role="alert">{creationError}{existingCaseId ? <button className="table-link-button" type="button" onClick={(event) => openDetail(existingCaseId, event.currentTarget)}> Abrir caso existente</button> : null}</div> : null}
        </section>
      ) : null}

      <section className="filter-card" aria-labelledby="review-filter-title">
        <div className="filter-card-heading"><div><p className="section-kicker">Refine a fila</p><h2 id="review-filter-title">Filtros e ordenação</h2></div></div>
        <form className="filter-grid review-case-filter-grid" onSubmit={submitFilters}>
          <label>Status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option>{FINDING_REVIEW_CASE_STATUSES.map((value) => <option key={value} value={value}>{getFindingReviewCaseStatusLabel(value)}</option>)}</select></label>
          <label>Atualidade<select value={form.staleness} onChange={(event) => setForm((current) => ({ ...current, staleness: event.target.value }))}><option value="">Todas</option>{FINDING_REVIEW_STALENESSES.map((value) => <option key={value} value={value}>{getFindingReviewStalenessLabel(value)}</option>)}</select></label>
          <label>Tipo de achado<select value={form.findingType} onChange={(event) => setForm((current) => ({ ...current, findingType: event.target.value }))}><option value="">Todos</option>{CONFLICT_FINDING_TYPES.map((value) => <option key={value} value={value}>{getConflictFindingTypeLabel(value)}</option>)}</select></label>
          <label>ID do achado<input value={form.findingId} onChange={(event) => setForm((current) => ({ ...current, findingId: event.target.value }))} /></label>
          <label>Criado por<input maxLength={100} value={form.createdBy} onChange={(event) => setForm((current) => ({ ...current, createdBy: event.target.value }))} /></label>
          <label>ID do ativo<input placeholder="UUID do ativo" value={form.assetId} onChange={(event) => setForm((current) => ({ ...current, assetId: event.target.value }))} /></label>
          <label>Criado a partir de<input type="datetime-local" step="1" value={form.createdFrom} onChange={(event) => setForm((current) => ({ ...current, createdFrom: event.target.value }))} /><small>Horário local do navegador</small></label>
          <label>Criado até<input type="datetime-local" step="1" value={form.createdTo} onChange={(event) => setForm((current) => ({ ...current, createdTo: event.target.value }))} /><small>Horário local do navegador</small></label>
          <label>Ordenar por<select value={form.sortBy} onChange={(event) => setForm((current) => ({ ...current, sortBy: event.target.value as FindingReviewCaseSortField }))}><option value="createdAt">Criação</option><option value="updatedAt">Atualização</option><option value="status">Status</option><option value="staleness">Atualidade</option></select></label>
          <label>Direção<select value={form.sortDirection} onChange={(event) => setForm((current) => ({ ...current, sortDirection: event.target.value as FindingReviewSortDirection }))}><option value="desc">Decrescente</option><option value="asc">Crescente</option></select></label>
          <label>Itens por página<select value={form.pageSize} onChange={(event) => setForm((current) => ({ ...current, pageSize: event.target.value }))}>{[10, 25, 50, 100].map((value) => <option key={value}>{value}</option>)}</select></label>
          <div className="filter-actions"><button className="button button-primary" type="submit">Aplicar filtros</button><button className="button button-secondary" type="button" onClick={clearFilters}>Limpar filtros</button></div>
          {filterError ? <p className="form-message form-message-error review-filter-error" role="alert">{filterError}</p> : null}
        </form>
      </section>

      {loading && !result ? <LoadingState label="Carregando casos…" /> : null}
      {error && !result ? <ErrorState message={error} retry={retryList} /> : null}
      {result ? (
        <>
          {error ? <div className="finding-inline-error" role="alert"><span>{error}</span><button className="button button-secondary" type="button" onClick={retryList}>Tentar novamente</button></div> : null}
          <div className="table-scroll review-cases-table-wrap">
            <table className="data-table review-cases-table">
              <thead><tr><th>Caso</th><th>Tipo</th><th>Status</th><th>Atualidade</th><th>Versão</th><th>Criado por</th><th>Ativos</th><th>Eventos</th><th>Criado em</th><th>Atualizado em</th><th>Ação</th></tr></thead>
              <tbody>{result.items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.id.slice(0, 8)}</strong><small title={item.findingId}>{item.findingId}</small></td>
                  <td>{getConflictFindingTypeLabel(item.findingType)}</td>
                  <td><span className="status-badge">{getFindingReviewCaseStatusLabel(item.status)}</span></td>
                  <td>{getFindingReviewStalenessLabel(item.staleness)}</td>
                  <td>{item.version}</td><td>{item.createdBy}</td><td>{item.assetCount}</td><td>{item.eventCount}</td><td>{formatDateTime(item.createdAt)}</td><td>{formatDateTime(item.updatedAt)}</td>
                  <td><button className="table-link-button" type="button" aria-controls={DETAIL_PANEL_ID} aria-expanded={expandedId === item.id} onClick={(event: ReactMouseEvent<HTMLButtonElement>) => openDetail(item.id, event.currentTarget)}>{expandedId === item.id ? 'Fechar' : 'Ver detalhe'}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {result.items.length === 0 ? <section className="empty-state"><h2>Nenhum caso encontrado.</h2><p>Revise os filtros ou crie um caso a partir de um achado.</p></section> : null}
          <nav className="pagination" aria-label="Paginação dos casos"><div className="pagination-summary"><strong>Página {result.pagination.page} de {Math.max(result.pagination.totalPages, 1)}</strong><span>{result.pagination.totalItems} resultados</span></div><div className="pagination-actions"><button type="button" disabled={result.pagination.page <= 1 || loading} onClick={() => changePage(result.pagination.page - 1)}>Anterior</button><button type="button" disabled={result.pagination.page >= result.pagination.totalPages || loading} onClick={() => changePage(result.pagination.page + 1)}>Próxima</button></div></nav>
        </>
      ) : null}

      {expandedId ? (
        <section id={DETAIL_PANEL_ID} className="review-case-detail" aria-labelledby="review-case-detail-title">
          <ReviewCaseDetail
            detail={detail}
            loading={detailLoading}
            error={detailError}
            retry={retryDetail}
            close={() => closeDetail(true)}
            headingRef={detailHeading}
            statusLoading={statusLoading}
            statusError={statusError}
            statusSuccess={statusSuccess}
            statusConflict={statusConflict}
            submitStatus={submitStatusTransition}
            reloadStatus={reloadAfterStatusConflict}
            decisionLoading={decisionLoading}
            decisionError={decisionError}
            decisionSuccess={decisionSuccess}
            decisionUncertain={decisionUncertain}
            decisionReloadRequired={decisionReloadRequired}
            decisionPendingAttempt={pendingDecisionAttempt.current}
            submitDecision={submitDecision}
            reloadDecision={reloadAfterDecisionConflict}
          />
        </section>
      ) : null}
    </main>
  );
}

function ReviewCaseDetail({
  detail,
  loading,
  error,
  retry,
  close,
  headingRef,
  statusLoading,
  statusError,
  statusSuccess,
  statusConflict,
  submitStatus,
  reloadStatus,
  decisionLoading,
  decisionError,
  decisionSuccess,
  decisionUncertain,
  decisionReloadRequired,
  decisionPendingAttempt,
  submitDecision,
  reloadDecision,
}: {
  detail: FindingReviewCaseDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  close: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  statusLoading: boolean;
  statusError: string | null;
  statusSuccess: string | null;
  statusConflict: boolean;
  submitStatus: (
    status: ActiveFindingReviewCaseStatus,
    justification?: string,
  ) => Promise<void>;
  reloadStatus: () => void;
  decisionLoading: boolean;
  decisionError: string | null;
  decisionSuccess: string | null;
  decisionUncertain: boolean;
  decisionReloadRequired: boolean;
  decisionPendingAttempt: PendingFindingReviewDecisionAttempt | null;
  submitDecision: (
    identityConclusion?: FindingReviewIdentityConclusion,
    justification?: string,
  ) => Promise<void>;
  reloadDecision: () => void;
}) {
  if (loading) return <><div className="review-detail-toolbar"><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div><LoadingState label="Carregando detalhe do caso…" /></>;
  if (error) return <><div className="review-detail-toolbar"><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div><ErrorState message={error} retry={retry} /></>;
  if (!detail) return null;
  return (
    <>
      <div className="finding-section-heading review-detail-toolbar"><div><p className="section-kicker">Registro histórico</p><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2></div><div><span className="status-badge">{getFindingReviewCaseStatusLabel(detail.status)}</span><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div></div>
      <dl className="review-case-metadata"><div><dt>ID</dt><dd>{detail.id}</dd></div><div><dt>Achado</dt><dd>{detail.findingId}</dd></div><div><dt>Política</dt><dd>{detail.policyVersion}</dd></div><div><dt>Atualidade</dt><dd>{getFindingReviewStalenessLabel(detail.staleness)}</dd></div><div><dt>Criado por</dt><dd>{detail.createdBy}</dd></div><div><dt>Versão</dt><dd>{detail.version}</dd></div></dl>
      <IdentityDecisionControl
        key={`${detail.id}:${detail.version}:${detail.currentDecision?.id ?? 'none'}`}
        detail={detail}
        loading={decisionLoading}
        mutationBlocked={statusLoading || statusConflict}
        error={decisionError}
        success={decisionSuccess}
        uncertain={decisionUncertain}
        reloadRequired={decisionReloadRequired}
        pendingAttempt={decisionPendingAttempt?.caseId === detail.id
          ? decisionPendingAttempt
          : null}
        submit={submitDecision}
        reload={reloadDecision}
      />
      <StatusTransitionControl
        key={`${detail.id}:${detail.status}:${detail.version}`}
        detail={detail}
        loading={statusLoading}
        error={statusError}
        success={statusSuccess}
        conflict={statusConflict}
        submit={submitStatus}
        reload={reloadStatus}
        mutationBlocked={decisionLoading || decisionUncertain || decisionReloadRequired}
      />
      <div className="review-detail-grid">
        <article><h3>Ativos históricos e vínculos atuais</h3>{detail.assets.map((asset) => <div className="review-asset-record" key={asset.assetIdAtCreation}><strong>{asset.assetNameAtCreation}</strong><small>Na criação: {asset.assetIdAtCreation}</small><span>{asset.role}</span>{asset.currentAssetAvailable && asset.currentAssetId ? <Link href={`/assets/${encodeURIComponent(asset.currentAssetId)}`}>Ver vínculo atual: {asset.currentAssetName}</Link> : <em>Ativo atual não disponível. O vínculo histórico foi preservado.</em>}</div>)}</article>
        <article><h3>Histórico de eventos</h3><ol className="review-event-list">{detail.events.map((event) => <li key={event.id}><strong>{getFindingReviewEventLabel(event.eventType)}</strong>{formatStatusTransition(event.metadata)}{formatDecisionEvent(event.eventType, event.metadata)}{formatTransitionJustification(event.metadata)}<span>Versão {event.versionBefore ?? 0} → {event.versionAfter}</span><small>{formatDateTime(event.createdAt)} · {event.actor}</small></li>)}</ol></article>
      </div>
      <details className="review-snapshot"><summary>Visualizar snapshot histórico</summary><p>Hash: <code>{detail.originalSnapshotHash}</code></p><pre>{JSON.stringify(detail.originalSnapshot, null, 2)}</pre></details>
    </>
  );
}

function getSupportedDecisionOptions(snapshot: unknown): FindingReviewIdentityConclusion[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const options = (snapshot as Record<string, unknown>).reviewOptions;
  if (!Array.isArray(options)) return [];
  return [...new Set(options.filter((option): option is FindingReviewIdentityConclusion => (
    option === 'SAME_ASSET' || option === 'DIFFERENT_ASSETS'
  )))];
}

function IdentityDecisionControl({
  detail,
  loading,
  mutationBlocked,
  error,
  success,
  uncertain,
  reloadRequired,
  pendingAttempt,
  submit,
  reload,
}: {
  detail: FindingReviewCaseDetail;
  loading: boolean;
  mutationBlocked: boolean;
  error: string | null;
  success: string | null;
  uncertain: boolean;
  reloadRequired: boolean;
  pendingAttempt: PendingFindingReviewDecisionAttempt | null;
  submit: (
    identityConclusion?: FindingReviewIdentityConclusion,
    justification?: string,
  ) => Promise<void>;
  reload: () => void;
}) {
  const options = getSupportedDecisionOptions(detail.originalSnapshot);
  const distinctAssetCount = new Set(detail.assets.map((asset) => asset.assetIdAtCreation)).size;
  const eligible = detail.status === 'IN_REVIEW'
    && detail.currentDecision === null
    && options.length > 0
    && distinctAssetCount >= 2;
  const [conclusion, setConclusion] = useState<FindingReviewIdentityConclusion | ''>(
    pendingAttempt?.identityConclusion ?? '',
  );
  const [justification, setJustification] = useState(pendingAttempt?.justification ?? '');
  const [confirmation, setConfirmation] = useState(false);
  const [conclusionError, setConclusionError] = useState<string | null>(null);
  const [justificationError, setJustificationError] = useState<string | null>(null);
  const firstRadio = useRef<HTMLInputElement | null>(null);
  const justificationField = useRef<HTMLTextAreaElement | null>(null);
  const confirmationHeading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
  }, [confirmation]);

  if (detail.currentDecision) {
    return (
      <section className="review-decision-control" aria-labelledby="review-decision-title">
        <div><p className="section-kicker">Conclusão humana</p><h3 id="review-decision-title">Decisão de identidade</h3></div>
        <article className="review-decision-card">
          <strong>{getFindingReviewIdentityConclusionLabel(detail.currentDecision.identityConclusion)}</strong>
          <p className="review-decision-justification">{detail.currentDecision.justification}</p>
          <small>{formatDateTime(detail.currentDecision.createdAt)} · {detail.currentDecision.createdBy} · versão {detail.currentDecision.caseVersion}</small>
          <p>Esta decisão não alterou automaticamente o inventário.</p>
        </article>
        <DecisionHistory decisions={detail.decisionHistory} />
        {success ? <p className="form-message form-message-success" role="status" aria-live="polite">{success}</p> : null}
      </section>
    );
  }

  const ineligibleMessage = detail.status === 'OPEN'
    ? 'A investigação precisa estar em revisão antes de registrar uma decisão.'
    : detail.status === 'WAITING_FOR_EVIDENCE'
      ? 'Retome a revisão após reunir as evidências necessárias.'
      : options.length === 0
        ? 'Este tipo de finding não aceita uma conclusão de identidade.'
        : distinctAssetCount < 2
          ? 'Não há múltiplos ativos históricos suficientes para esta decisão.'
          : 'Uma decisão de identidade não está disponível no estado atual.';

  const locked = loading || mutationBlocked || uncertain || reloadRequired;
  const normalizedJustification = justification.trim();

  function reviewDecision(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    let invalid = false;
    if (!conclusion) {
      setConclusionError('Selecione uma conclusão de identidade.');
      firstRadio.current?.focus();
      invalid = true;
    }
    if (normalizedJustification.length < 1) {
      setJustificationError('Informe uma justificativa para a decisão.');
      if (!invalid) justificationField.current?.focus();
      invalid = true;
    } else if (normalizedJustification.length > MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH) {
      setJustificationError('A justificativa deve ter no máximo 1000 caracteres.');
      if (!invalid) justificationField.current?.focus();
      invalid = true;
    }
    if (invalid) return;
    setConclusionError(null);
    setJustificationError(null);
    setConfirmation(true);
  }

  return (
    <section className="review-decision-control" aria-labelledby="review-decision-title">
      <div><p className="section-kicker">Conclusão humana</p><h3 id="review-decision-title">Decisão de identidade</h3><p>O backend valida novamente todas as condições antes do registro.</p></div>
      {!eligible && !uncertain ? <p className="review-decision-guidance">{ineligibleMessage}</p> : null}
      {uncertain && pendingAttempt ? (
        <div className="review-decision-uncertain" role="alert">
          <strong>Resultado incerto</strong>
          <p>Não foi possível confirmar se a decisão foi registrada. Tente novamente para consultar o mesmo resultado com segurança. A mesma chave idempotente será reutilizada.</p>
          <button className="button button-primary" type="button" disabled={loading || mutationBlocked} onClick={() => void submit()}>{loading ? 'Tentando novamente…' : 'Tentar novamente'}</button>
        </div>
      ) : eligible && !confirmation ? (
        <form className="review-decision-form" onSubmit={reviewDecision}>
          <fieldset disabled={locked} aria-invalid={conclusionError !== null} aria-describedby={conclusionError ? 'review-decision-conclusion-error' : undefined}>
            <legend>Os registros investigados representam a mesma identidade de ativo?</legend>
            {options.map((option, index) => (
              <label className="review-decision-option" key={option}>
                <input
                  ref={index === 0 ? firstRadio : undefined}
                  type="radio"
                  name="identity-conclusion"
                  value={option}
                  checked={conclusion === option}
                  onChange={() => { setConclusion(option); setConclusionError(null); }}
                />
                <span><strong>{getFindingReviewIdentityConclusionLabel(option)}</strong><small>{option === 'SAME_ASSET'
                  ? 'Os registros representam o mesmo ativo. Esta conclusão não mescla nem altera cadastros automaticamente.'
                  : 'Os registros representam ativos distintos. Esta conclusão não separa, exclui ou corrige ativos automaticamente.'}</small></span>
              </label>
            ))}
          </fieldset>
          {conclusionError ? <p id="review-decision-conclusion-error" className="form-message form-message-error" role="alert">{conclusionError}</p> : null}
          <label htmlFor="review-decision-justification">Justificativa</label>
          <textarea
            id="review-decision-justification"
            ref={justificationField}
            value={justification}
            maxLength={MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH + 1}
            disabled={locked}
            aria-invalid={justificationError !== null}
            aria-describedby="review-decision-justification-help review-decision-counter"
            onInput={(event) => { setJustification(event.currentTarget.value); setJustificationError(null); }}
          />
          <small id="review-decision-justification-help">Espaços no início e no fim serão desconsiderados. Não inclua senhas, tokens ou dados sensíveis.</small>
          <span id="review-decision-counter" className="review-decision-counter">{justification.length} / {MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH}</span>
          {justificationError ? <p className="form-message form-message-error" role="alert">{justificationError}</p> : null}
          <button className="button button-primary" type="submit" disabled={locked}>Revisar decisão</button>
        </form>
      ) : eligible ? (
        <div className="review-decision-confirmation">
          <h4 ref={confirmationHeading} tabIndex={-1}>Confirme a decisão</h4>
          <dl><div><dt>Conclusão</dt><dd>{getFindingReviewIdentityConclusionLabel(conclusion as FindingReviewIdentityConclusion)}</dd></div><div><dt>Justificativa</dt><dd className="review-decision-justification">{normalizedJustification}</dd></div></dl>
          <p>Registrar a decisão não resolve o caso e não altera o inventário. A decisão não poderá ser editada nesta versão.</p>
          <div className="review-decision-actions"><button className="button button-primary" type="button" disabled={loading || mutationBlocked} onClick={() => void submit(conclusion as FindingReviewIdentityConclusion, normalizedJustification)}>{loading ? 'Registrando…' : 'Registrar decisão'}</button><button className="button button-secondary" type="button" disabled={loading} onClick={() => setConfirmation(false)}>Voltar e editar</button></div>
        </div>
      ) : null}
      {success ? <p className="form-message form-message-success" role="status" aria-live="polite">{success}</p> : null}
      {error ? <div className="form-message form-message-error" role="alert">{error}{reloadRequired ? <button className="table-link-button" type="button" onClick={reload}> Recarregar caso</button> : null}</div> : null}
      {loading ? <p className="form-message" role="status" aria-live="polite">Registrando a decisão…</p> : null}
    </section>
  );
}

function DecisionHistory({ decisions }: { decisions: FindingReviewCaseDetail['decisionHistory'] }) {
  if (decisions.length === 0) return null;
  return (
    <details className="review-decision-history">
      <summary>Histórico de decisões ({decisions.length})</summary>
      <ol>{decisions.map((decision) => <li key={decision.id}><strong>{getFindingReviewIdentityConclusionLabel(decision.identityConclusion)}</strong><p className="review-decision-justification">{decision.justification}</p><small>{formatDateTime(decision.createdAt)} · {decision.createdBy} · versão {decision.caseVersion}</small></li>)}</ol>
    </details>
  );
}

function StatusTransitionControl({
  detail,
  loading,
  error,
  success,
  conflict,
  submit,
  reload,
  mutationBlocked,
}: {
  detail: FindingReviewCaseDetail;
  loading: boolean;
  error: string | null;
  success: string | null;
  conflict: boolean;
  submit: (status: ActiveFindingReviewCaseStatus, justification?: string) => Promise<void>;
  reload: () => void;
  mutationBlocked: boolean;
}) {
  const destinations = getAllowedFindingReviewCaseStatusDestinations(detail.status);
  const [target, setTarget] = useState<ActiveFindingReviewCaseStatus | ''>('');
  const [justification, setJustification] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const conflictAlert = useRef<HTMLDivElement | null>(null);
  const justificationField = useRef<HTMLTextAreaElement | null>(null);

  const justificationRequired = target !== ''
    && requiresFindingReviewCaseWaitingJustification(detail.status, target);

  useEffect(() => {
    if (conflict) conflictAlert.current?.focus();
  }, [conflict]);

  if (destinations.length === 0) {
    return <section className="review-status-control" aria-labelledby="review-status-title"><h3 id="review-status-title">Estado operacional</h3><p>Este caso está em um estado terminal. Transições operacionais não estão disponíveis.</p></section>;
  }

  return (
    <section className="review-status-control" aria-labelledby="review-status-title">
      <div><h3 id="review-status-title">Alterar estado operacional</h3><p>Estado atual: <strong>{getFindingReviewCaseStatusLabel(detail.status)}</strong> · versão {detail.version}. A alteração não modifica o inventário.</p></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!target) return;
        if (justificationRequired) {
          const normalized = justification.trim();
          if (normalized.length === 0) {
            setValidationError('Informe uma justificativa para esta transição.');
            justificationField.current?.focus();
            return;
          }
          if (normalized.length > MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH) {
            setValidationError('A justificativa deve ter no máximo 500 caracteres.');
            justificationField.current?.focus();
            return;
          }
          setValidationError(null);
          void submit(target, normalized);
          return;
        }
        setValidationError(null);
        void submit(target);
      }}>
        <label htmlFor="review-case-next-status">Novo estado</label>
        <select id="review-case-next-status" value={target} disabled={loading || conflict || mutationBlocked} onChange={(event) => {
          const next = event.target.value as ActiveFindingReviewCaseStatus | '';
          setTarget(next);
          setValidationError(null);
          if (
            next === ''
            || !requiresFindingReviewCaseWaitingJustification(detail.status, next)
          ) {
            setJustification('');
          }
        }}>
          <option value="">Selecione…</option>
          {destinations.map((status) => <option key={status} value={status}>{getFindingReviewCaseStatusLabel(status)}</option>)}
        </select>
        {justificationRequired ? (
          <div className="review-status-justification">
            <label htmlFor="review-case-status-justification">Justificativa</label>
            <textarea
              id="review-case-status-justification"
              ref={justificationField}
              value={justification}
              required
              maxLength={MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH}
              disabled={loading || conflict || mutationBlocked}
              aria-describedby="review-case-status-justification-help"
              aria-invalid={validationError !== null}
              onInput={(event) => {
                setJustification(event.currentTarget.value);
                if (validationError) setValidationError(null);
              }}
            />
            <small id="review-case-status-justification-help">Explique o contexto operacional. Não inclua credenciais, tokens ou dados sensíveis.</small>
          </div>
        ) : null}
        <button className="button button-primary" type="submit" disabled={loading || conflict || mutationBlocked || !target}>{loading ? 'Alterando…' : 'Confirmar alteração'}</button>
      </form>
      {validationError ? <p className="form-message form-message-error" role="alert">{validationError}</p> : null}
      {loading ? <p className="form-message" role="status" aria-live="polite">Alterando o estado do caso…</p> : null}
      {success ? <p className="form-message form-message-success" role="status" aria-live="polite">{success}</p> : null}
      {error ? <div ref={conflictAlert} className="form-message form-message-error" role="alert" tabIndex={conflict ? -1 : undefined}>{error}{conflict ? <button className="table-link-button" type="button" onClick={reload}> Recarregar caso</button> : null}</div> : null}
    </section>
  );
}

function formatStatusTransition(metadata: Record<string, string> | null) {
  if (!metadata) return null;
  const before = metadata.statusBefore;
  const after = metadata.statusAfter;
  if (
    !FINDING_REVIEW_CASE_STATUSES.includes(before as FindingReviewCaseStatus)
    || !FINDING_REVIEW_CASE_STATUSES.includes(after as FindingReviewCaseStatus)
  ) return null;
  return <span>{getFindingReviewCaseStatusLabel(before as FindingReviewCaseStatus)} → {getFindingReviewCaseStatusLabel(after as FindingReviewCaseStatus)}</span>;
}

function formatTransitionJustification(metadata: Record<string, string> | null) {
  const justification = metadata?.justification;
  if (!justification || justification.trim().length === 0) return null;
  return <span className="review-event-justification"><b>Justificativa:</b> {justification}</span>;
}

function formatDecisionEvent(eventType: string, metadata: Record<string, string> | null) {
  if (eventType !== 'CASE_DECISION_RECORDED') return null;
  const conclusion = metadata?.identityConclusion;
  if (conclusion !== 'SAME_ASSET' && conclusion !== 'DIFFERENT_ASSETS') return null;
  return <span>Conclusão: {getFindingReviewIdentityConclusionLabel(conclusion)}</span>;
}
