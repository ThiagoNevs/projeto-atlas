import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api-error';
import type {
  FindingReviewCaseListResponse,
  FindingReviewCaseQuery,
  FindingReviewCasesRequestOptions,
} from '../../lib/api';
import {
  DEFAULT_FINDING_REVIEW_CASE_QUERY,
  serializeFindingReviewCaseQuery,
} from '../../lib/finding-review-cases';
import {
  buildFindingReviewCaseQueryFromForm,
  reviewCaseFilterFormFromQuery,
  type FindingReviewCaseFilterForm,
} from './review-case-location';

export type ReviewCasesLoader = (
  query: FindingReviewCaseQuery,
  options?: FindingReviewCasesRequestOptions,
) => Promise<FindingReviewCaseListResponse>;

interface Options {
  initialQuery: FindingReviewCaseQuery;
  loadCases: ReviewCasesLoader;
}

function displayListError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return 'O fluxo de casos de revisão está temporariamente indisponível.';
  }
  return error instanceof Error ? error.message : 'Não foi possível carregar os casos.';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || (
    error instanceof ApiError && error.status === 0 && /cancelada/i.test(error.message)
  ));
}

export function useReviewCaseListController({ initialQuery, loadCases }: Options) {
  const [query, setQuery] = useState<FindingReviewCaseQuery>(initialQuery);
  const queryRef = useRef(initialQuery);
  const [form, setForm] = useState<FindingReviewCaseFilterForm>(
    () => reviewCaseFilterFormFromQuery(initialQuery, false),
  );
  const initialDateHydrationSuperseded = useRef(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [result, setResult] = useState<FindingReviewCaseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!initialDateHydrationSuperseded.current) {
        setForm(reviewCaseFilterFormFromQuery(initialQuery));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialQuery]);

  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    const requestSequence = ++sequence.current;
    const expectedQuery = serializeFindingReviewCaseQuery(query);
    queryRef.current = query;

    const canCommit = (): boolean => mounted.current
      && requestSequence === sequence.current
      && !controller.signal.aborted
      && expectedQuery === serializeFindingReviewCaseQuery(queryRef.current);

    void loadCases(query, { signal: controller.signal })
      .then((value) => {
        if (canCommit()) setResult(value);
      })
      .catch((cause) => {
        if (!canCommit() || isAbort(cause)) return;
        setError(displayListError(cause));
      })
      .finally(() => {
        if (canCommit()) setLoading(false);
      });

    return () => controller.abort();
  }, [loadCases, query, reloadToken]);

  function invalidateRequest(): void {
    sequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
  }

  function startQuery(next: FindingReviewCaseQuery): void {
    invalidateRequest();
    queryRef.current = next;
    setLoading(true);
    setError(null);
    setQuery(next);
  }

  function restoreQuery(next: FindingReviewCaseQuery): void {
    initialDateHydrationSuperseded.current = true;
    setFilterError(null);
    setForm(reviewCaseFilterFormFromQuery(next));
    startQuery(next);
  }

  function parseFilters(): FindingReviewCaseQuery | null {
    const parsed = buildFindingReviewCaseQueryFromForm(form);
    setFilterError(parsed.error);
    return parsed.query;
  }

  function resetFilters(): FindingReviewCaseQuery {
    const next = { ...DEFAULT_FINDING_REVIEW_CASE_QUERY };
    setForm(reviewCaseFilterFormFromQuery(next));
    setFilterError(null);
    return next;
  }

  function queryForPage(page: number): FindingReviewCaseQuery | null {
    if (page < 1 || page === query.page) return null;
    return { ...query, page };
  }

  function reload(): void {
    invalidateRequest();
    setLoading(true);
    setError(null);
    setReloadToken((value) => value + 1);
  }

  return {
    query,
    queryRef,
    form,
    setForm,
    filterError,
    result,
    loading,
    error,
    startQuery,
    restoreQuery,
    parseFilters,
    resetFilters,
    queryForPage,
    reload,
    invalidateRequest,
  };
}
