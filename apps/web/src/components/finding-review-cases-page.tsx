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
  createFindingReviewCase,
  getFindingReviewCase,
  getFindingReviewCases,
  type CreateFindingReviewCaseResponse,
  type FindingReviewCaseDetail,
  type FindingReviewCaseListResponse,
  type FindingReviewCaseQuery,
  type FindingReviewCasesRequestOptions,
} from '../lib/api';
import { CONFLICT_FINDING_TYPES, getConflictFindingTypeLabel } from '../lib/conflict-findings';
import {
  DEFAULT_FINDING_REVIEW_CASE_QUERY,
  FINDING_REVIEW_CASE_STATUSES,
  FINDING_REVIEW_SORT_FIELDS,
  FINDING_REVIEW_STALENESSES,
  createFindingReviewIdempotencyKey,
  getFindingReviewCaseStatusLabel,
  getFindingReviewEventLabel,
  getFindingReviewStalenessLabel,
  isFindingReviewCaseId,
  isFindingReviewFindingId,
  isFindingReviewTimestamp,
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

interface Props {
  initialSearchParams?: Record<string, string | string[] | undefined>;
  loadCases?: ReviewCasesLoader;
  loadDetail?: ReviewCaseDetailLoader;
  createCase?: ReviewCaseCreator;
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
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/=-]{1,128}$/;
export const PENDING_REVIEW_CASE_ATTEMPT_TTL_MS = 15 * 60 * 1000;

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

export function FindingReviewCasesPage({
  initialSearchParams = {},
  loadCases = getFindingReviewCases,
  loadDetail = getFindingReviewCase,
  createCase = createFindingReviewCase,
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
  const restoreFocusFrame = useRef<number | null>(null);

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
      if (restoreFocusFrame.current !== null) {
        window.cancelAnimationFrame(restoreFocusFrame.current);
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
    if (
      !expandedId
      || detailLoading
      || (!detail && !detailError)
      || !detailHeading.current
    ) return;
    const requestedId = expandedId;
    const frame = window.requestAnimationFrame(() => {
      if (mounted.current && expandedIdRef.current === requestedId) {
        detailHeading.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
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
          <ReviewCaseDetail detail={detail} loading={detailLoading} error={detailError} retry={retryDetail} close={() => closeDetail(true)} headingRef={detailHeading} />
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
}: {
  detail: FindingReviewCaseDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  close: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  if (loading) return <><div className="review-detail-toolbar"><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div><LoadingState label="Carregando detalhe do caso…" /></>;
  if (error) return <><div className="review-detail-toolbar"><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div><ErrorState message={error} retry={retry} /></>;
  if (!detail) return null;
  return (
    <>
      <div className="finding-section-heading review-detail-toolbar"><div><p className="section-kicker">Registro histórico</p><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2></div><div><span className="status-badge">{getFindingReviewCaseStatusLabel(detail.status)}</span><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div></div>
      <dl className="review-case-metadata"><div><dt>ID</dt><dd>{detail.id}</dd></div><div><dt>Achado</dt><dd>{detail.findingId}</dd></div><div><dt>Política</dt><dd>{detail.policyVersion}</dd></div><div><dt>Atualidade</dt><dd>{getFindingReviewStalenessLabel(detail.staleness)}</dd></div><div><dt>Criado por</dt><dd>{detail.createdBy}</dd></div><div><dt>Versão</dt><dd>{detail.version}</dd></div></dl>
      <div className="review-detail-grid">
        <article><h3>Ativos históricos e vínculos atuais</h3>{detail.assets.map((asset) => <div className="review-asset-record" key={asset.assetIdAtCreation}><strong>{asset.assetNameAtCreation}</strong><small>Na criação: {asset.assetIdAtCreation}</small><span>{asset.role}</span>{asset.currentAssetAvailable && asset.currentAssetId ? <Link href={`/assets/${encodeURIComponent(asset.currentAssetId)}`}>Ver vínculo atual: {asset.currentAssetName}</Link> : <em>Ativo atual não disponível. O vínculo histórico foi preservado.</em>}</div>)}</article>
        <article><h3>Histórico de eventos</h3><ol className="review-event-list">{detail.events.map((event) => <li key={event.id}><strong>{getFindingReviewEventLabel(event.eventType)}</strong><span>Versão {event.versionBefore ?? 0} → {event.versionAfter}</span><small>{formatDateTime(event.createdAt)} · {event.actor}</small></li>)}</ol></article>
      </div>
      <details className="review-snapshot"><summary>Visualizar snapshot histórico</summary><p>Hash: <code>{detail.originalSnapshotHash}</code></p><pre>{JSON.stringify(detail.originalSnapshot, null, 2)}</pre></details>
    </>
  );
}
