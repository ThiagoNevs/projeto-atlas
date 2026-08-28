import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api-error';
import type {
  FindingReviewCaseDetail,
  FindingReviewCasesRequestOptions,
} from '../../lib/api';

export type ReviewCaseDetailLoader = (
  id: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<FindingReviewCaseDetail>;

interface Options {
  initialSelectedId: string | null;
  loadDetail: ReviewCaseDetailLoader;
  onDetailLoaded: (detail: FindingReviewCaseDetail) => void;
}

function displayDetailError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return 'O fluxo de casos de revisão está temporariamente indisponível.';
  }
  return error instanceof Error ? error.message : 'Não foi possível carregar o detalhe do caso.';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || (
    error instanceof ApiError && error.status === 0 && /cancelada/i.test(error.message)
  ));
}

export function useReviewCaseDetailController({
  initialSelectedId,
  loadDetail,
  onDetailLoaded,
}: Options) {
  const [detail, setDetail] = useState<FindingReviewCaseDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(initialSelectedId));
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const selectedIdRef = useRef<string | null>(initialSelectedId);
  const [reloadToken, setReloadToken] = useState(0);
  const sequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const onDetailLoadedRef = useRef(onDetailLoaded);

  useEffect(() => {
    onDetailLoadedRef.current = onDetailLoaded;
  }, [onDetailLoaded]);

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
    if (!selectedId) return;
    const requestedId = selectedId;
    const controller = new AbortController();
    requestController.current = controller;
    const requestSequence = ++sequence.current;

    const canCommit = (): boolean => mounted.current
      && requestSequence === sequence.current
      && !controller.signal.aborted
      && selectedIdRef.current === requestedId;

    void loadDetail(requestedId, { signal: controller.signal })
      .then((value) => {
        if (!canCommit()) return;
        setDetail(value);
        onDetailLoadedRef.current(value);
      })
      .catch((cause) => {
        if (!canCommit() || isAbort(cause)) return;
        setError(displayDetailError(cause));
      })
      .finally(() => {
        if (canCommit()) setLoading(false);
      });

    return () => controller.abort();
  }, [loadDetail, reloadToken, selectedId]);

  function invalidateRequest(): void {
    sequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
  }

  function select(id: string): void {
    invalidateRequest();
    selectedIdRef.current = id;
    setSelectedId(id);
    setDetail(null);
    setError(null);
    setLoading(true);
  }

  function clear(): void {
    invalidateRequest();
    selectedIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setError(null);
    setLoading(false);
  }

  function restoreSelection(id: string | null): void {
    if (id === selectedIdRef.current) return;
    if (id) select(id);
    else clear();
  }

  function retry(): void {
    if (!selectedIdRef.current) return;
    invalidateRequest();
    setDetail(null);
    setError(null);
    setLoading(true);
    setReloadToken((value) => value + 1);
  }

  function requestReload(): void {
    setReloadToken((value) => value + 1);
  }

  return {
    detail,
    loading,
    error,
    selectedId,
    selectedIdRef,
    select,
    clear,
    restoreSelection,
    retry,
    requestReload,
    invalidateRequest,
    applyLocalUpdate: setDetail,
    loadFreshDetail: (caseId: string) => loadDetail(caseId),
  };
}
