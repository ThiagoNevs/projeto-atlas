import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api-error';
import type {
  CreateFindingReviewCaseResponse,
  FindingReviewCasesRequestOptions,
} from '../../lib/api';
import { createFindingReviewIdempotencyKey } from '../../lib/finding-review-cases';
import {
  clearPendingFindingReviewCaseAttempt,
  createPendingFindingReviewCaseAttempt,
  inspectPendingFindingReviewCaseAttempt,
  pendingReviewCaseAttemptDiscardedMessage,
  readPendingFindingReviewCaseAttempt,
  storePendingFindingReviewCaseAttempt,
  type PendingFindingReviewCaseAttempt,
} from './review-case-creation-pending';

export type ReviewCaseCreator = (
  findingId: string,
  key: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<CreateFindingReviewCaseResponse>;

interface Options {
  createCase: ReviewCaseCreator;
  onSuccess: (created: CreateFindingReviewCaseResponse) => void;
}

export function useReviewCaseCreationCommand({ createCase, onSuccess }: Options) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateFindingReviewCaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingCaseId, setExistingCaseId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const pendingAttempt = useRef<PendingFindingReviewCaseAttempt | null>(null);
  const mounted = useRef(false);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, []);

  function resetForIntentChange(): void {
    sequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    pendingAttempt.current = null;
    inFlight.current = false;
    setLoading(false);
    setResult(null);
    setError(null);
    setExistingCaseId(null);
  }

  async function submit(findingId: string | null): Promise<void> {
    if (!findingId || inFlight.current) return;
    const creationFindingId = findingId;
    let attempt = pendingAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewCaseAttempt(
        JSON.stringify(attempt),
        creationFindingId,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewCaseAttempt(creationFindingId, attempt);
        pendingAttempt.current = null;
        setError(pendingReviewCaseAttemptDiscardedMessage(inspected.status));
        setExistingCaseId(null);
        return;
      }
      attempt = inspected.attempt;
      pendingAttempt.current = attempt;
    } else {
      const stored = readPendingFindingReviewCaseAttempt(creationFindingId);
      if (stored.status === 'invalid' || stored.status === 'expired') {
        setError(pendingReviewCaseAttemptDiscardedMessage(stored.status));
        setExistingCaseId(null);
        return;
      }
      attempt = stored.status === 'valid'
        ? stored.attempt
        : createPendingFindingReviewCaseAttempt(
          creationFindingId,
          createFindingReviewIdempotencyKey(() => crypto.randomUUID()),
        );
      pendingAttempt.current = attempt;
    }

    const requestSequence = ++sequence.current;
    inFlight.current = true;
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    setExistingCaseId(null);
    try {
      const created = await createCase(creationFindingId, attempt.idempotencyKey, {
        signal: controller.signal,
      });
      clearPendingFindingReviewCaseAttempt(creationFindingId, attempt);
      if (pendingAttempt.current === attempt) pendingAttempt.current = null;
      if (!mounted.current || requestSequence !== sequence.current) return;
      setResult(created);
      onSuccessRef.current(created);
    } catch (cause) {
      const conclusive = cause instanceof ApiError && [400, 404, 409, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewCaseAttempt(creationFindingId, attempt);
        if (pendingAttempt.current === attempt) pendingAttempt.current = null;
      } else {
        storePendingFindingReviewCaseAttempt(attempt);
      }
      if (!mounted.current || requestSequence !== sequence.current) return;
      if (cause instanceof ApiError && cause.status === 409 && cause.existingCaseId) {
        setExistingCaseId(cause.existingCaseId);
        setError('Já existe um caso ativo para este assunto.');
      } else if (cause instanceof ApiError && cause.status === 409) {
        setError('A chave da tentativa anterior não pode ser reutilizada. Tente novamente.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setError('A criação de casos está desabilitada neste ambiente. Nenhum dado foi alterado.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setError('O achado não está mais disponível. Atualize a lista de achados antes de tentar novamente.');
      } else if (cause instanceof ApiError && cause.status === 400) {
        setError('A solicitação de criação é inválida. Revise o achado selecionado.');
      } else {
        setError(
          'Não foi possível confirmar o resultado. Tente novamente: a mesma chave idempotente será reutilizada.',
        );
      }
    } finally {
      if (requestSequence === sequence.current) inFlight.current = false;
      if (requestController.current === controller) requestController.current = null;
      if (mounted.current && requestSequence === sequence.current) setLoading(false);
    }
  }

  return {
    loading,
    result,
    error,
    existingCaseId,
    submit,
    resetForIntentChange,
  };
}
