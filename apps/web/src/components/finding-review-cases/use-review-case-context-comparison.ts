'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api-error';
import type {
  FindingReviewCasesRequestOptions,
  FindingReviewContextComparisonResponse,
} from '../../lib/api';

export type ReviewCaseContextComparisonLoader = (
  id: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<FindingReviewContextComparisonResponse>;

export interface BoundContextComparisonResult {
  caseId: string;
  caseVersion: number;
  response: FindingReviewContextComparisonResponse;
}

export type ContextComparisonErrorCategory =
  'network' | 'timeout' | 'not-found' | 'unavailable' | 'invalid-response' | 'stale' | 'unknown';

export type ContextComparisonState =
  | { phase: 'idle' }
  | { phase: 'loading'; previous: BoundContextComparisonResult | null }
  | { phase: 'success'; value: BoundContextComparisonResult }
  | {
      phase: 'error';
      previous: BoundContextComparisonResult | null;
      category: ContextComparisonErrorCategory;
      message: string;
    };

interface Options {
  caseId: string;
  caseVersion: number;
  findingId: string;
  policyVersion: string;
  snapshotHash: string;
  mutationBlocked: boolean;
  loadComparison: ReviewCaseContextComparisonLoader;
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      (error instanceof ApiError && error.status === 0 && /cancelada/i.test(error.message)))
  );
}

function comparisonError(error: unknown): {
  category: ContextComparisonErrorCategory;
  message: string;
} {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return {
        category: 'network',
        message:
          'Não foi possível verificar o contexto atual. Confira a conexão e tente novamente.',
      };
    }
    if (error.status === 408) {
      return {
        category: 'timeout',
        message: 'A verificação demorou mais que o esperado. Tente novamente.',
      };
    }
    if (error.status === 404) {
      return {
        category: 'not-found',
        message: 'O caso não está mais disponível para comparação. Recarregue o detalhe.',
      };
    }
    if (error.status === 503) {
      return {
        category: 'unavailable',
        message: 'A comparação de contexto está temporariamente indisponível.',
      };
    }
    if (error.status === 502) {
      return { category: 'invalid-response', message: error.message };
    }
  }
  return {
    category: 'unknown',
    message:
      error instanceof Error
        ? error.message
        : 'Não foi possível verificar o contexto atual. Tente novamente.',
  };
}

export function useReviewCaseContextComparison({
  caseId,
  caseVersion,
  findingId,
  policyVersion,
  snapshotHash,
  mutationBlocked,
  loadComparison,
}: Options) {
  const [state, setState] = useState<ContextComparisonState>({ phase: 'idle' });
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

  function currentResult(): BoundContextComparisonResult | null {
    if (state.phase === 'success') return state.value;
    if (state.phase === 'loading' || state.phase === 'error') return state.previous;
    return null;
  }

  function reset(): void {
    sequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    setState({ phase: 'idle' });
  }

  async function verify(): Promise<void> {
    if (mutationBlocked) return;
    const previous = currentResult();
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const requestSequence = ++sequence.current;
    const requestedCaseId = caseId;
    const requestedCaseVersion = caseVersion;
    setState({ phase: 'loading', previous });

    const canCommit = (): boolean =>
      mounted.current &&
      requestSequence === sequence.current &&
      !controller.signal.aborted &&
      !mutationBlocked;

    try {
      const response = await loadComparison(requestedCaseId, { signal: controller.signal });
      if (!canCommit()) return;
      if (response.caseId !== requestedCaseId || response.caseVersion !== requestedCaseVersion) {
        setState({
          phase: 'error',
          previous: null,
          category: 'stale',
          message:
            'O caso mudou durante a verificação. Recarregue o detalhe antes de tentar novamente.',
        });
        return;
      }
      if (
        response.baseline.findingId !== findingId ||
        response.baseline.policyVersion !== policyVersion ||
        response.baseline.snapshotHash !== snapshotHash
      ) {
        setState({
          phase: 'error',
          previous: null,
          category: 'invalid-response',
          message:
            'A API retornou uma comparação incompatível com o contexto histórico deste caso.',
        });
        return;
      }
      setState({
        phase: 'success',
        value: { caseId: requestedCaseId, caseVersion: requestedCaseVersion, response },
      });
    } catch (cause) {
      if (!canCommit() || isAbort(cause)) return;
      const error = comparisonError(cause);
      setState({ phase: 'error', previous, ...error });
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }

  return {
    state,
    verify,
    reset,
    loading: state.phase === 'loading',
    result: currentResult(),
  };
}
