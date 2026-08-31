'use client';

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ApiError,
  type ActiveFindingReviewCaseStatus,
  type CreateFindingReviewCaseReopenResponse,
  type CreateFindingReviewCaseResolutionResponse,
  type CreateFindingReviewDecisionResponse,
  type CreateFindingReviewDecisionSupersessionResponse,
  type FindingReviewCaseDetail,
  type FindingReviewCasesRequestOptions,
  type FindingReviewDecision,
  type FindingReviewIdentityConclusion,
  type UpdateFindingReviewCaseStatusResponse,
} from '../../lib/api';
import {
  createFindingReviewIdempotencyKey,
  getAllowedFindingReviewCaseStatusDestinations,
  getFindingReviewCaseStatusLabel,
  isFindingReviewCaseId,
} from '../../lib/finding-review-cases';
import {
  MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH,
  MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH,
  clearPendingFindingReviewDecisionAttempt,
  clearPendingFindingReviewDecisionSupersessionAttempt,
  clearPendingFindingReviewReopenAttempt,
  clearPendingFindingReviewResolutionAttempt,
  createPendingFindingReviewDecisionAttempt,
  createPendingFindingReviewDecisionSupersessionAttempt,
  createPendingFindingReviewReopenAttempt,
  createPendingFindingReviewResolutionAttempt,
  inspectPendingFindingReviewDecisionAttempt,
  inspectPendingFindingReviewDecisionSupersessionAttempt,
  inspectPendingFindingReviewReopenAttempt,
  inspectPendingFindingReviewResolutionAttempt,
  readPendingFindingReviewDecisionAttempt,
  readPendingFindingReviewDecisionSupersessionAttempt,
  readPendingFindingReviewReopenAttempt,
  readPendingFindingReviewResolutionAttempt,
  storePendingFindingReviewDecisionAttempt,
  storePendingFindingReviewDecisionSupersessionAttempt,
  storePendingFindingReviewReopenAttempt,
  storePendingFindingReviewResolutionAttempt,
  type PendingFindingReviewDecisionAttempt,
  type PendingFindingReviewDecisionSupersessionAttempt,
  type PendingFindingReviewReopenAttempt,
  type PendingFindingReviewResolutionAttempt,
} from './review-case-command-pending';

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

export type ReviewCaseResolutionCreator = (
  id: string,
  expectedVersion: number,
  justification: string,
  key: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<CreateFindingReviewCaseResolutionResponse>;

export type ReviewCaseDecisionSuperseder = (
  caseId: string,
  supersededDecisionId: string,
  identityConclusion: FindingReviewIdentityConclusion,
  justification: string,
  correctionReason: string,
  expectedVersion: number,
  key: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<CreateFindingReviewDecisionSupersessionResponse>;

export type ReviewCaseReopenCreator = (
  id: string,
  expectedVersion: number,
  justification: string,
  key: string,
  options?: FindingReviewCasesRequestOptions,
) => Promise<CreateFindingReviewCaseReopenResponse>;

interface UseReviewCaseCommandsOptions {
  detail: FindingReviewCaseDetail | null;
  selectedCaseIdRef: RefObject<string | null>;
  updateStatus: ReviewCaseStatusUpdater;
  createDecision: ReviewCaseDecisionCreator;
  supersedeDecision: ReviewCaseDecisionSuperseder;
  createResolution: ReviewCaseResolutionCreator;
  createReopen: ReviewCaseReopenCreator;
  applyDetailUpdate: Dispatch<SetStateAction<FindingReviewCaseDetail | null>>;
  invalidateDetailRequest: () => void;
  loadFreshDetail: (caseId: string) => Promise<FindingReviewCaseDetail>;
  requestDetailReload: () => void;
  requestListReload: () => void;
  retryDetail: () => void;
  retryList: () => void;
}

function displayError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message.trim()) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function mergeDecisionHistory(
  history: FindingReviewCaseDetail['decisionHistory'],
  decision: FindingReviewDecision,
): FindingReviewCaseDetail['decisionHistory'] {
  return [...history.filter((item) => item.id !== decision.id), decision]
    .sort((left, right) => {
      if (left.caseVersion !== right.caseVersion) return left.caseVersion - right.caseVersion;
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
}

function latestKnownDecision(
  history: FindingReviewCaseDetail['decisionHistory'],
): FindingReviewDecision | null {
  return history.reduce<FindingReviewDecision | null>((latest, decision) => {
    if (!latest) return decision;
    if (decision.caseVersion !== latest.caseVersion) {
      return decision.caseVersion > latest.caseVersion ? decision : latest;
    }
    if (decision.createdAt !== latest.createdAt) {
      return decision.createdAt > latest.createdAt ? decision : latest;
    }
    return decision.id > latest.id ? decision : latest;
  }, null);
}

function reconcileDecisionDetail(
  current: FindingReviewCaseDetail,
  refreshed: FindingReviewCaseDetail,
): FindingReviewCaseDetail {
  const mergedHistory = current.decisionHistory.reduce(
    (history, decision) => mergeDecisionHistory(history, decision),
    refreshed.decisionHistory,
  );
  const currentDecision = latestKnownDecision(mergedHistory);
  if (refreshed.version < current.version) {
    return {
      ...current,
      currentDecision,
      decisionHistory: mergedHistory,
      version: Math.max(current.version, currentDecision?.caseVersion ?? 0),
    };
  }
  return {
    ...refreshed,
    currentDecision,
    decisionHistory: mergedHistory,
    version: Math.max(refreshed.version, current.version, currentDecision?.caseVersion ?? 0),
  };
}

function mergeResolutionEvent(
  events: FindingReviewCaseDetail['events'],
  resolution: CreateFindingReviewCaseResolutionResponse['resolution'],
): FindingReviewCaseDetail['events'] {
  const event: FindingReviewCaseDetail['events'][number] = {
    id: resolution.eventId,
    eventType: 'CASE_RESOLVED',
    versionBefore: resolution.versionBefore,
    versionAfter: resolution.versionAfter,
    actor: resolution.resolvedBy,
    metadata: {
      decisionId: resolution.decisionId,
      identityConclusion: resolution.identityConclusion,
      justification: resolution.justification,
    },
    createdAt: resolution.resolvedAt,
  };
  return [...events.filter((item) => item.id !== event.id), event]
    .sort((left, right) => {
      if (left.versionAfter !== right.versionAfter) return left.versionAfter - right.versionAfter;
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}

export function useReviewCaseCommands({
  detail,
  selectedCaseIdRef,
  updateStatus,
  createDecision,
  supersedeDecision,
  createResolution,
  createReopen,
  applyDetailUpdate,
  invalidateDetailRequest,
  loadFreshDetail,
  requestDetailReload,
  requestListReload,
  retryDetail,
  retryList,
}: UseReviewCaseCommandsOptions) {
  const mounted = useRef(false);

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
  const [renderedDecisionAttempt, setRenderedDecisionAttempt] = useState<
    PendingFindingReviewDecisionAttempt | null
  >(null);

  const [supersessionLoading, setSupersessionLoading] = useState(false);
  const [supersessionError, setSupersessionError] = useState<string | null>(null);
  const [supersessionFieldError, setSupersessionFieldError] = useState<
    'justification' | 'correctionReason' | null
  >(null);
  const [supersessionSuccess, setSupersessionSuccess] = useState<string | null>(null);
  const [supersessionUncertain, setSupersessionUncertain] = useState(false);
  const [supersessionReloadRequired, setSupersessionReloadRequired] = useState(false);
  const supersessionInFlight = useRef(false);
  const supersessionController = useRef<AbortController | null>(null);
  const supersessionSequence = useRef(0);
  const pendingSupersessionAttempt = useRef<
    PendingFindingReviewDecisionSupersessionAttempt | null
  >(null);
  const [renderedSupersessionAttempt, setRenderedSupersessionAttempt] = useState<
    PendingFindingReviewDecisionSupersessionAttempt | null
  >(null);

  const [resolutionLoading, setResolutionLoading] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [resolutionSuccess, setResolutionSuccess] = useState<string | null>(null);
  const [resolutionUncertain, setResolutionUncertain] = useState(false);
  const [resolutionReloadRequired, setResolutionReloadRequired] = useState(false);
  const resolutionInFlight = useRef(false);
  const resolutionController = useRef<AbortController | null>(null);
  const resolutionSequence = useRef(0);
  const pendingResolutionAttempt = useRef<PendingFindingReviewResolutionAttempt | null>(null);
  const [renderedResolutionAttempt, setRenderedResolutionAttempt] = useState<
    PendingFindingReviewResolutionAttempt | null
  >(null);

  const [reopenLoading, setReopenLoading] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenSuccess, setReopenSuccess] = useState<string | null>(null);
  const [reopenUncertain, setReopenUncertain] = useState(false);
  const [reopenReloadRequired, setReopenReloadRequired] = useState(false);
  const [reopenExistingCaseId, setReopenExistingCaseId] = useState<string | null>(null);
  const reopenInFlight = useRef(false);
  const reopenController = useRef<AbortController | null>(null);
  const reopenSequence = useRef(0);
  const pendingReopenAttempt = useRef<PendingFindingReviewReopenAttempt | null>(null);
  const [renderedReopenAttempt, setRenderedReopenAttempt] = useState<
    PendingFindingReviewReopenAttempt | null
  >(null);

  function assignDecisionAttempt(attempt: PendingFindingReviewDecisionAttempt | null): void {
    pendingDecisionAttempt.current = attempt;
    setRenderedDecisionAttempt(attempt);
  }

  function assignSupersessionAttempt(
    attempt: PendingFindingReviewDecisionSupersessionAttempt | null,
  ): void {
    pendingSupersessionAttempt.current = attempt;
    setRenderedSupersessionAttempt(attempt);
  }

  function assignResolutionAttempt(attempt: PendingFindingReviewResolutionAttempt | null): void {
    pendingResolutionAttempt.current = attempt;
    setRenderedResolutionAttempt(attempt);
  }

  function assignReopenAttempt(attempt: PendingFindingReviewReopenAttempt | null): void {
    pendingReopenAttempt.current = attempt;
    setRenderedReopenAttempt(attempt);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      statusSequence.current += 1;
      statusController.current?.abort();
      if (decisionInFlight.current && pendingDecisionAttempt.current) {
        storePendingFindingReviewDecisionAttempt(pendingDecisionAttempt.current);
      }
      decisionSequence.current += 1;
      decisionController.current?.abort();
      if (supersessionInFlight.current && pendingSupersessionAttempt.current) {
        storePendingFindingReviewDecisionSupersessionAttempt(pendingSupersessionAttempt.current);
      }
      supersessionSequence.current += 1;
      supersessionController.current?.abort();
      if (resolutionInFlight.current && pendingResolutionAttempt.current) {
        storePendingFindingReviewResolutionAttempt(pendingResolutionAttempt.current);
      }
      resolutionSequence.current += 1;
      resolutionController.current?.abort();
      if (reopenInFlight.current && pendingReopenAttempt.current) {
        storePendingFindingReviewReopenAttempt(pendingReopenAttempt.current);
      }
      reopenSequence.current += 1;
      reopenController.current?.abort();
    };
  }, []);

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
      assignDecisionAttempt(null);
      setDecisionUncertain(false);
      return;
    }
    const stored = readPendingFindingReviewDecisionAttempt(value.id);
    if (stored.status === 'valid') {
      assignDecisionAttempt(stored.attempt);
      setDecisionUncertain(true);
      setDecisionError(null);
    } else if (stored.status === 'invalid' || stored.status === 'expired') {
      assignDecisionAttempt(null);
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
    assignDecisionAttempt(null);
  }

  function restorePendingSupersessionForDetail(value: FindingReviewCaseDetail): void {
    const stored = readPendingFindingReviewDecisionSupersessionAttempt(value.id);
    if (stored.status === 'valid') {
      assignSupersessionAttempt(stored.attempt);
      setSupersessionUncertain(true);
      setSupersessionError(null);
    } else if (stored.status === 'invalid' || stored.status === 'expired') {
      assignSupersessionAttempt(null);
      setSupersessionUncertain(false);
      setSupersessionError(stored.status === 'expired'
        ? 'A tentativa incerta de correção expirou e foi descartada.'
        : 'A tentativa incerta de correção era inválida e foi descartada.');
    }
  }

  function invalidateSupersessionRequest(persistUncertain = true): void {
    if (persistUncertain && supersessionInFlight.current && pendingSupersessionAttempt.current) {
      storePendingFindingReviewDecisionSupersessionAttempt(pendingSupersessionAttempt.current);
    }
    supersessionSequence.current += 1;
    supersessionController.current?.abort();
    supersessionController.current = null;
    supersessionInFlight.current = false;
    setSupersessionLoading(false);
    setSupersessionError(null);
    setSupersessionFieldError(null);
    setSupersessionSuccess(null);
    setSupersessionUncertain(false);
    setSupersessionReloadRequired(false);
    assignSupersessionAttempt(null);
  }

  function restorePendingResolutionForDetail(value: FindingReviewCaseDetail): void {
    if (value.status === 'RESOLVED') {
      clearPendingFindingReviewResolutionAttempt(value.id);
      assignResolutionAttempt(null);
      setResolutionUncertain(false);
      return;
    }
    const stored = readPendingFindingReviewResolutionAttempt(value.id);
    if (stored.status === 'valid') {
      assignResolutionAttempt(stored.attempt);
      setResolutionUncertain(true);
      setResolutionError(null);
    } else if (stored.status === 'invalid' || stored.status === 'expired') {
      assignResolutionAttempt(null);
      setResolutionUncertain(false);
      setResolutionError(stored.status === 'expired'
        ? 'A tentativa incerta de resolução expirou e foi descartada.'
        : 'A tentativa incerta de resolução era inválida e foi descartada.');
    }
  }

  function invalidateResolutionRequest(persistUncertain = true): void {
    if (persistUncertain && resolutionInFlight.current && pendingResolutionAttempt.current) {
      storePendingFindingReviewResolutionAttempt(pendingResolutionAttempt.current);
    }
    resolutionSequence.current += 1;
    resolutionController.current?.abort();
    resolutionController.current = null;
    resolutionInFlight.current = false;
    setResolutionLoading(false);
    setResolutionError(null);
    setResolutionSuccess(null);
    setResolutionUncertain(false);
    setResolutionReloadRequired(false);
    assignResolutionAttempt(null);
  }

  function restorePendingReopenForDetail(value: FindingReviewCaseDetail): void {
    if (value.status !== 'RESOLVED') {
      clearPendingFindingReviewReopenAttempt(value.id);
      assignReopenAttempt(null);
      setReopenUncertain(false);
      return;
    }
    const stored = readPendingFindingReviewReopenAttempt(value.id);
    if (stored.status === 'valid') {
      assignReopenAttempt(stored.attempt);
      setReopenUncertain(true);
      setReopenError(null);
    } else if (stored.status === 'invalid' || stored.status === 'expired') {
      assignReopenAttempt(null);
      setReopenUncertain(false);
      setReopenError(stored.status === 'expired'
        ? 'A tentativa incerta de reabertura expirou e foi descartada.'
        : 'A tentativa incerta de reabertura era inválida e foi descartada.');
    }
  }

  function invalidateReopenRequest(persistUncertain = true): void {
    if (persistUncertain && reopenInFlight.current && pendingReopenAttempt.current) {
      storePendingFindingReviewReopenAttempt(pendingReopenAttempt.current);
    }
    reopenSequence.current += 1;
    reopenController.current?.abort();
    reopenController.current = null;
    reopenInFlight.current = false;
    setReopenLoading(false);
    setReopenError(null);
    setReopenSuccess(null);
    setReopenUncertain(false);
    setReopenReloadRequired(false);
    setReopenExistingCaseId(null);
    assignReopenAttempt(null);
  }

  function invalidateAll(): void {
    invalidateDecisionRequest();
    invalidateSupersessionRequest();
    invalidateResolutionRequest();
    invalidateReopenRequest();
    invalidateStatusRequest();
  }

  function restoreForDetail(value: FindingReviewCaseDetail): void {
    restorePendingDecisionForDetail(value);
    restorePendingSupersessionForDetail(value);
    restorePendingResolutionForDetail(value);
    restorePendingReopenForDetail(value);
  }

  function canCommitStatus(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === statusSequence.current
      && !controller.signal.aborted
      && selectedCaseIdRef.current === expectedId;
  }

  async function submitStatus(
    target: ActiveFindingReviewCaseStatus,
    justification?: string,
  ): Promise<void> {
    const current = detail;
    if (
      !current
      || selectedCaseIdRef.current !== current.id
      || statusInFlight.current
      || decisionInFlight.current
      || supersessionInFlight.current
      || supersessionUncertain
      || supersessionReloadRequired
      || statusConflict
      || resolutionInFlight.current
      || resolutionUncertain
      || resolutionReloadRequired
      || reopenInFlight.current
      || reopenUncertain
      || reopenReloadRequired
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
      applyDetailUpdate((value) => value?.id === expectedId ? {
        ...value,
        status: updated.status,
        version: updated.version,
        updatedAt: updated.updatedAt,
      } : value);
      setStatusSuccess(`Status alterado para ${getFindingReviewCaseStatusLabel(updated.status)}.`);
      requestListReload();
      requestDetailReload();
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

  function reloadStatus(): void {
    setStatusError(null);
    setStatusConflict(false);
    setStatusSuccess(null);
    retryDetail();
    retryList();
  }

  function canCommitDecision(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === decisionSequence.current
      && !controller.signal.aborted
      && selectedCaseIdRef.current === expectedId;
  }

  async function refreshDecisionDetail(
    caseId: string,
    expectedSequence = decisionSequence.current,
  ): Promise<void> {
    try {
      const refreshed = await loadFreshDetail(caseId);
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || decisionSequence.current !== expectedSequence
      ) return;
      applyDetailUpdate((current) => {
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
      requestListReload();
    } catch {
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || decisionSequence.current !== expectedSequence
      ) return;
      setDecisionError((value) => value
        ?? 'A decisão foi confirmada, mas não foi possível atualizar todos os dados do caso.');
    }
  }

  async function submitDecision(
    identityConclusion?: FindingReviewIdentityConclusion,
    justification?: string,
  ): Promise<void> {
    const current = detail;
    if (
      !current
      || selectedCaseIdRef.current !== current.id
      || decisionInFlight.current
      || statusInFlight.current
      || supersessionInFlight.current
      || supersessionUncertain
      || supersessionReloadRequired
      || resolutionInFlight.current
      || resolutionUncertain
      || resolutionReloadRequired
      || reopenInFlight.current
      || reopenUncertain
      || reopenReloadRequired
    ) return;

    let attempt = pendingDecisionAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewDecisionAttempt(
        JSON.stringify(attempt),
        current.id,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewDecisionAttempt(current.id, attempt);
        assignDecisionAttempt(null);
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
      assignDecisionAttempt(attempt);
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
      if (pendingDecisionAttempt.current === attempt) assignDecisionAttempt(null);
      if (!canCommitDecision(sequence, controller, expectedId)) return;
      setDecisionUncertain(false);
      applyDetailUpdate((value) => value?.id === expectedId ? {
        ...value,
        currentDecision: created.decision,
        decisionHistory: mergeDecisionHistory(value.decisionHistory, created.decision),
        version: created.decision.caseVersion,
      } : value);
      setDecisionSuccess(created.idempotentReplay
        ? 'Decisão já registrada, recuperada com segurança.'
        : 'Decisão registrada com sucesso.');
      requestListReload();
      void refreshDecisionDetail(expectedId, sequence);
    } catch (cause) {
      const conclusive = cause instanceof ApiError
        && [400, 404, 409, 422, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewDecisionAttempt(expectedId, attempt);
        if (pendingDecisionAttempt.current === attempt) assignDecisionAttempt(null);
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

  function reloadDecision(): void {
    assignDecisionAttempt(null);
    setDecisionUncertain(false);
    setDecisionError(null);
    setDecisionSuccess(null);
    setDecisionReloadRequired(false);
    retryDetail();
    retryList();
  }

  function canCommitSupersession(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === supersessionSequence.current
      && !controller.signal.aborted
      && selectedCaseIdRef.current === expectedId;
  }

  async function refreshSupersessionDetail(
    caseId: string,
    expectedSequence = supersessionSequence.current,
  ): Promise<void> {
    try {
      const refreshed = await loadFreshDetail(caseId);
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || supersessionSequence.current !== expectedSequence
      ) return;
      applyDetailUpdate((current) => current?.id === caseId
        ? reconcileDecisionDetail(current, refreshed)
        : current);
      setSupersessionReloadRequired(false);
    } catch {
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || supersessionSequence.current !== expectedSequence
      ) return;
      setSupersessionReloadRequired(true);
      setSupersessionError((value) => value
        ?? 'A correção foi confirmada, mas não foi possível atualizar todo o histórico do caso.');
    }
  }

  async function submitSupersession(
    identityConclusion?: FindingReviewIdentityConclusion,
    justification?: string,
    correctionReason?: string,
  ): Promise<void> {
    const current = detail;
    if (
      !current
      || selectedCaseIdRef.current !== current.id
      || supersessionInFlight.current
      || statusInFlight.current
      || statusConflict
      || decisionInFlight.current
      || decisionUncertain
      || decisionReloadRequired
      || resolutionInFlight.current
      || resolutionUncertain
      || resolutionReloadRequired
      || reopenInFlight.current
      || reopenUncertain
      || reopenReloadRequired
    ) return;

    let attempt = pendingSupersessionAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewDecisionSupersessionAttempt(
        JSON.stringify(attempt),
        current.id,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewDecisionSupersessionAttempt(current.id, attempt);
        assignSupersessionAttempt(null);
        setSupersessionUncertain(false);
        setSupersessionReloadRequired(true);
        setSupersessionError(inspected.status === 'expired'
          ? 'A tentativa incerta expirou. Revise a correção antes de iniciar uma nova tentativa.'
          : 'A tentativa incerta era inválida e foi descartada. Revise a correção novamente.');
        return;
      }
      attempt = inspected.attempt;
    } else {
      const currentDecision = current.currentDecision;
      const normalizedJustification = justification?.trim() ?? '';
      const normalizedCorrectionReason = correctionReason?.trim() ?? '';
      if (
        !currentDecision
        || current.status !== 'IN_REVIEW'
        || !identityConclusion
        || normalizedJustification.length < 1
        || normalizedCorrectionReason.length < 1
      ) return;
      attempt = createPendingFindingReviewDecisionSupersessionAttempt(
        current.id,
        currentDecision.id,
        identityConclusion,
        normalizedJustification,
        normalizedCorrectionReason,
        current.version,
        createFindingReviewIdempotencyKey(() => crypto.randomUUID()),
      );
      assignSupersessionAttempt(attempt);
    }

    // A completed idempotent command may still have a fresh detail GET in flight.
    // Superseding starts a new authoritative mutation and must make those older
    // command refreshes unable to commit after its local success.
    decisionSequence.current += 1;
    resolutionSequence.current += 1;
    reopenSequence.current += 1;
    invalidateDetailRequest();
    const controller = new AbortController();
    const sequence = ++supersessionSequence.current;
    const expectedId = attempt.caseId;
    supersessionController.current = controller;
    supersessionInFlight.current = true;
    setSupersessionLoading(true);
    setSupersessionError(null);
    setSupersessionFieldError(null);
    setSupersessionSuccess(null);
    setSupersessionReloadRequired(false);

    try {
      const created = await supersedeDecision(
        attempt.caseId,
        attempt.supersededDecisionId,
        attempt.identityConclusion,
        attempt.justification,
        attempt.correctionReason,
        attempt.expectedVersion,
        attempt.idempotencyKey,
        { signal: controller.signal },
      );
      if (
        created.decision.caseId !== expectedId
        || created.supersededDecisionId !== attempt.supersededDecisionId
        || created.decision.identityConclusion !== attempt.identityConclusion
        || created.decision.justification !== attempt.justification
        || created.decision.caseVersion !== attempt.expectedVersion + 1
      ) throw new ApiError('A API retornou uma correção incompatível com a solicitação.', 502);

      clearPendingFindingReviewDecisionSupersessionAttempt(expectedId, attempt);
      if (pendingSupersessionAttempt.current === attempt) assignSupersessionAttempt(null);
      if (!canCommitSupersession(sequence, controller, expectedId)) return;
      setSupersessionUncertain(false);
      applyDetailUpdate((value) => {
        if (value?.id !== expectedId) return value;
        const decisionHistory = mergeDecisionHistory(value.decisionHistory, created.decision);
        const currentDecision = latestKnownDecision(decisionHistory);
        return {
          ...value,
          currentDecision,
          decisionHistory,
          version: Math.max(value.version, created.decision.caseVersion),
        };
      });
      setSupersessionSuccess(created.idempotentReplay
        ? 'Decisão corrigida anteriormente, recuperada com segurança.'
        : 'Decisão corrigida.');
      requestListReload();
      void refreshSupersessionDetail(expectedId, sequence);
    } catch (cause) {
      const conclusive = cause instanceof ApiError
        && [400, 404, 409, 422, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewDecisionSupersessionAttempt(expectedId, attempt);
        if (pendingSupersessionAttempt.current === attempt) assignSupersessionAttempt(null);
      } else {
        storePendingFindingReviewDecisionSupersessionAttempt(attempt);
      }
      if (!canCommitSupersession(sequence, controller, expectedId)) return;
      if (!conclusive) {
        setSupersessionUncertain(true);
        setSupersessionError('Não foi possível confirmar se a decisão foi corrigida. Tente novamente para consultar o mesmo resultado com segurança.');
      } else if (cause instanceof ApiError && (
        cause.code === 'INVALID_FINDING_REVIEW_DECISION_JUSTIFICATION'
        || cause.code === 'FINDING_REVIEW_DECISION_JUSTIFICATION_REQUIRED'
      )) {
        setSupersessionFieldError('justification');
        setSupersessionError(cause.message);
      } else if (cause instanceof ApiError && (
        cause.code === 'INVALID_FINDING_REVIEW_DECISION_CORRECTION_REASON'
        || cause.code === 'FINDING_REVIEW_DECISION_CORRECTION_REASON_REQUIRED'
      )) {
        setSupersessionFieldError('correctionReason');
        setSupersessionError(cause.message);
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_DECISION_SUPERSESSION_NO_CHANGE') {
        setSupersessionError('Altere a conclusão ou a justificativa da decisão.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_VERSION_CONFLICT') {
        setSupersessionReloadRequired(true);
        setSupersessionError('O caso foi alterado desde que você iniciou esta correção.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_DECISION_NOT_CURRENT') {
        setSupersessionReloadRequired(true);
        setSupersessionError('Esta decisão não é mais a decisão atual. Atualize o caso.');
      } else if (cause instanceof ApiError && cause.code === 'IDEMPOTENCY_KEY_REUSED') {
        setSupersessionReloadRequired(true);
        setSupersessionError('Esta tentativa não corresponde à correção original. Recarregue o caso.');
      } else if (cause instanceof ApiError && cause.status === 422) {
        setSupersessionReloadRequired(true);
        setSupersessionError('A correção não é mais permitida para o estado ou snapshot atual do caso.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setSupersessionReloadRequired(true);
        setSupersessionError('O caso não foi encontrado. Recarregue a lista para confirmar sua situação.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setSupersessionError('A correção de decisões está indisponível neste ambiente. Nenhum dado foi alterado.');
      } else {
        setSupersessionError(displayError(cause, 'Não foi possível corrigir a decisão.'));
      }
    } finally {
      if (sequence === supersessionSequence.current) supersessionInFlight.current = false;
      if (supersessionController.current === controller) supersessionController.current = null;
      if (mounted.current && sequence === supersessionSequence.current) {
        setSupersessionLoading(false);
      }
    }
  }

  function reloadSupersession(): void {
    assignSupersessionAttempt(null);
    setSupersessionUncertain(false);
    setSupersessionError(null);
    setSupersessionFieldError(null);
    setSupersessionSuccess(null);
    setSupersessionReloadRequired(false);
    retryDetail();
    retryList();
  }

  function canCommitResolution(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === resolutionSequence.current
      && !controller.signal.aborted
      && selectedCaseIdRef.current === expectedId;
  }

  async function refreshResolutionDetail(
    caseId: string,
    expectedSequence = resolutionSequence.current,
  ): Promise<void> {
    try {
      const refreshed = await loadFreshDetail(caseId);
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || resolutionSequence.current !== expectedSequence
      ) return;
      applyDetailUpdate((current) => {
        if (current?.id === caseId && current.status === 'RESOLVED' && refreshed.status !== 'RESOLVED') {
          return current;
        }
        return refreshed;
      });
      setResolutionReloadRequired(false);
      requestListReload();
    } catch {
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || resolutionSequence.current !== expectedSequence
      ) return;
      setResolutionError((value) => value
        ?? 'A resolução foi confirmada, mas não foi possível atualizar todos os dados do caso.');
    }
  }

  async function submitResolution(justification?: string): Promise<void> {
    const current = detail;
    if (
      !current
      || selectedCaseIdRef.current !== current.id
      || resolutionInFlight.current
      || decisionInFlight.current
      || statusInFlight.current
      || supersessionInFlight.current
      || supersessionUncertain
      || supersessionReloadRequired
      || reopenInFlight.current
      || reopenUncertain
      || reopenReloadRequired
      || decisionUncertain
      || decisionReloadRequired
      || statusConflict
    ) return;

    let attempt = pendingResolutionAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewResolutionAttempt(
        JSON.stringify(attempt),
        current.id,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewResolutionAttempt(current.id, attempt);
        assignResolutionAttempt(null);
        setResolutionUncertain(false);
        setResolutionError(inspected.status === 'expired'
          ? 'A tentativa incerta expirou. Revise a resolução antes de iniciar uma nova tentativa.'
          : 'A tentativa incerta era inválida e foi descartada. Revise a resolução novamente.');
        return;
      }
      attempt = inspected.attempt;
    } else {
      const normalizedJustification = justification?.trim() ?? '';
      if (
        current.status !== 'IN_REVIEW'
        || current.currentDecision === null
        || normalizedJustification.length < 1
        || normalizedJustification.length > MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH
      ) return;
      attempt = createPendingFindingReviewResolutionAttempt(
        current.id,
        normalizedJustification,
        current.version,
        createFindingReviewIdempotencyKey(() => crypto.randomUUID()),
      );
      assignResolutionAttempt(attempt);
    }

    const controller = new AbortController();
    const sequence = ++resolutionSequence.current;
    const expectedId = attempt.caseId;
    resolutionController.current = controller;
    resolutionInFlight.current = true;
    setResolutionLoading(true);
    setResolutionError(null);
    setResolutionSuccess(null);
    setResolutionReloadRequired(false);

    try {
      const created = await createResolution(
        attempt.caseId,
        attempt.expectedVersion,
        attempt.justification,
        attempt.idempotencyKey,
        { signal: controller.signal },
      );
      const expectedDecision = current.currentDecision;
      if (
        created.resolution.caseId !== expectedId
        || created.resolution.versionBefore !== attempt.expectedVersion
        || created.resolution.versionAfter !== attempt.expectedVersion + 1
        || created.resolution.justification !== attempt.justification
        || created.resolution.previousStatus !== 'IN_REVIEW'
        || created.resolution.status !== 'RESOLVED'
        || !expectedDecision
        || created.resolution.decisionId !== expectedDecision.id
        || created.resolution.identityConclusion !== expectedDecision.identityConclusion
      ) throw new ApiError('A API retornou uma resolução incompatível com a solicitação.', 502);

      clearPendingFindingReviewResolutionAttempt(expectedId, attempt);
      if (pendingResolutionAttempt.current === attempt) assignResolutionAttempt(null);
      if (!canCommitResolution(sequence, controller, expectedId)) return;
      setResolutionUncertain(false);
      applyDetailUpdate((value) => value?.id === expectedId ? {
        ...value,
        status: created.resolution.status,
        version: created.resolution.versionAfter,
        updatedAt: created.resolution.resolvedAt,
        events: mergeResolutionEvent(value.events, created.resolution),
      } : value);
      setResolutionSuccess(created.idempotentReplay
        ? 'Resolução já registrada, recuperada com segurança.'
        : 'Caso resolvido com sucesso.');
      requestListReload();
      void refreshResolutionDetail(expectedId, sequence);
    } catch (cause) {
      const conclusive = cause instanceof ApiError
        && [400, 404, 409, 422, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewResolutionAttempt(expectedId, attempt);
        if (pendingResolutionAttempt.current === attempt) assignResolutionAttempt(null);
      } else {
        storePendingFindingReviewResolutionAttempt(attempt);
      }
      if (!canCommitResolution(sequence, controller, expectedId)) return;
      if (!conclusive) {
        setResolutionUncertain(true);
        setResolutionError('Não foi possível confirmar se o caso foi resolvido. Tente novamente para consultar o mesmo resultado com segurança. A mesma chave idempotente será reutilizada.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_VERSION_CONFLICT') {
        setResolutionUncertain(false);
        setResolutionReloadRequired(true);
        setResolutionError('O caso foi alterado desde que você iniciou esta resolução.');
      } else if (cause instanceof ApiError && cause.code === 'IDEMPOTENCY_KEY_REUSED') {
        setResolutionUncertain(false);
        setResolutionReloadRequired(true);
        setResolutionError('Esta tentativa não corresponde à operação original associada à chave de segurança. Recarregue o caso antes de iniciar uma nova resolução.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_RESOLUTION_NOT_ALLOWED') {
        setResolutionUncertain(false);
        setResolutionError('O caso não está mais disponível para resolução. Os dados atuais serão recarregados.');
        void refreshResolutionDetail(expectedId, sequence);
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_DECISION_REQUIRED') {
        setResolutionUncertain(false);
        setResolutionError('A decisão de identidade não está mais disponível. Os dados atuais serão recarregados.');
        void refreshResolutionDetail(expectedId, sequence);
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_RESOLUTION_JUSTIFICATION_REQUIRED') {
        setResolutionUncertain(false);
        setResolutionError('Informe uma justificativa para concluir a investigação.');
      } else if (cause instanceof ApiError && cause.code === 'INVALID_FINDING_REVIEW_RESOLUTION_JUSTIFICATION') {
        setResolutionUncertain(false);
        setResolutionError('A justificativa da resolução é inválida. Revise o conteúdo informado.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setResolutionUncertain(false);
        setResolutionError('O caso não foi encontrado. Recarregue a lista para confirmar sua situação.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setResolutionUncertain(false);
        setResolutionError('A resolução de casos está indisponível neste ambiente. Nenhum dado foi alterado.');
      } else {
        setResolutionUncertain(false);
        setResolutionError(displayError(cause, 'Não foi possível resolver o caso.'));
      }
    } finally {
      if (sequence === resolutionSequence.current) resolutionInFlight.current = false;
      if (resolutionController.current === controller) resolutionController.current = null;
      if (mounted.current && sequence === resolutionSequence.current) setResolutionLoading(false);
    }
  }

  function reloadResolution(): void {
    assignResolutionAttempt(null);
    setResolutionUncertain(false);
    setResolutionError(null);
    setResolutionSuccess(null);
    setResolutionReloadRequired(false);
    retryDetail();
    retryList();
  }

  function canCommitReopen(
    sequence: number,
    controller: AbortController,
    expectedId: string,
  ): boolean {
    return mounted.current
      && sequence === reopenSequence.current
      && !controller.signal.aborted
      && selectedCaseIdRef.current === expectedId;
  }

  async function refreshReopenDetail(
    caseId: string,
    expectedSequence = reopenSequence.current,
  ): Promise<void> {
    try {
      const refreshed = await loadFreshDetail(caseId);
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || reopenSequence.current !== expectedSequence
      ) return;
      applyDetailUpdate((current) => {
        if (current?.id === caseId && current.status === 'IN_REVIEW' && refreshed.status === 'RESOLVED') {
          return current;
        }
        return refreshed;
      });
      setReopenReloadRequired(false);
      requestListReload();
    } catch {
      if (
        !mounted.current
        || selectedCaseIdRef.current !== caseId
        || reopenSequence.current !== expectedSequence
      ) return;
      setReopenError((value) => value
        ?? 'A reabertura foi confirmada, mas não foi possível atualizar todo o histórico do caso.');
    }
  }

  async function submitReopen(justification?: string): Promise<void> {
    const current = detail;
    if (
      !current
      || selectedCaseIdRef.current !== current.id
      || reopenInFlight.current
      || statusInFlight.current
      || decisionInFlight.current
      || resolutionInFlight.current
      || supersessionInFlight.current
      || supersessionUncertain
      || supersessionReloadRequired
      || resolutionUncertain
      || resolutionReloadRequired
      || decisionUncertain
      || decisionReloadRequired
    ) return;

    let attempt = pendingReopenAttempt.current;
    if (attempt) {
      const inspected = inspectPendingFindingReviewReopenAttempt(
        JSON.stringify(attempt),
        current.id,
      );
      if (inspected.status !== 'valid') {
        clearPendingFindingReviewReopenAttempt(current.id, attempt);
        assignReopenAttempt(null);
        setReopenUncertain(false);
        setReopenReloadRequired(true);
        setReopenError(inspected.status === 'expired'
          ? 'A tentativa incerta expirou. Revise a reabertura antes de iniciar uma nova tentativa.'
          : 'A tentativa incerta era inválida e foi descartada. Revise a reabertura novamente.');
        return;
      }
      attempt = inspected.attempt;
    } else {
      const normalizedJustification = justification?.trim() ?? '';
      if (
        current.status !== 'RESOLVED'
        || normalizedJustification.length < 1
        || normalizedJustification.length > MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH
      ) return;
      attempt = createPendingFindingReviewReopenAttempt(
        current.id,
        normalizedJustification,
        current.version,
        createFindingReviewIdempotencyKey(() => crypto.randomUUID()),
      );
      assignReopenAttempt(attempt);
    }

    const controller = new AbortController();
    const sequence = ++reopenSequence.current;
    const expectedId = attempt.caseId;
    reopenController.current = controller;
    reopenInFlight.current = true;
    setReopenLoading(true);
    setReopenError(null);
    setReopenSuccess(null);
    setReopenReloadRequired(false);
    setReopenExistingCaseId(null);

    try {
      const created = await createReopen(
        attempt.caseId,
        attempt.expectedVersion,
        attempt.justification,
        attempt.idempotencyKey,
        { signal: controller.signal },
      );
      if (
        created.reopen.caseId !== expectedId
        || created.reopen.versionBefore !== attempt.expectedVersion
        || created.reopen.versionAfter !== attempt.expectedVersion + 1
        || created.reopen.justification !== attempt.justification
        || created.reopen.previousStatus !== 'RESOLVED'
        || created.reopen.status !== 'IN_REVIEW'
      ) throw new ApiError('A API retornou uma reabertura incompatível com a solicitação.', 502);

      clearPendingFindingReviewReopenAttempt(expectedId, attempt);
      if (pendingReopenAttempt.current === attempt) assignReopenAttempt(null);
      if (!canCommitReopen(sequence, controller, expectedId)) return;
      setReopenUncertain(false);
      applyDetailUpdate((value) => value?.id === expectedId ? {
        ...value,
        status: created.reopen.status,
        version: created.reopen.versionAfter,
        updatedAt: created.reopen.reopenedAt,
      } : value);
      setReopenSuccess(created.idempotentReplay
        ? 'Reabertura já registrada, recuperada com segurança.'
        : 'Investigação reaberta com sucesso.');
      requestListReload();
      void refreshReopenDetail(expectedId, sequence);
    } catch (cause) {
      const conclusive = cause instanceof ApiError
        && [400, 404, 409, 422, 503].includes(cause.status);
      if (conclusive) {
        clearPendingFindingReviewReopenAttempt(expectedId, attempt);
        if (pendingReopenAttempt.current === attempt) assignReopenAttempt(null);
      } else {
        storePendingFindingReviewReopenAttempt(attempt);
      }
      if (!canCommitReopen(sequence, controller, expectedId)) return;
      if (!conclusive) {
        setReopenUncertain(true);
        setReopenError('Não foi possível confirmar se a investigação foi reaberta. Tente novamente para consultar o mesmo resultado com segurança. A mesma chave idempotente será reutilizada.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_VERSION_CONFLICT') {
        setReopenUncertain(false);
        setReopenReloadRequired(true);
        setReopenError('O caso foi alterado desde que você iniciou esta reabertura.');
      } else if (cause instanceof ApiError && cause.code === 'IDEMPOTENCY_KEY_REUSED') {
        setReopenUncertain(false);
        setReopenReloadRequired(true);
        setReopenError('Esta tentativa não corresponde à operação original associada à chave de segurança. Recarregue o caso antes de iniciar uma nova reabertura.');
      } else if (cause instanceof ApiError && cause.code === 'ACTIVE_REVIEW_CASE_EXISTS') {
        setReopenUncertain(false);
        setReopenReloadRequired(true);
        setReopenExistingCaseId(isFindingReviewCaseId(cause.existingCaseId)
          ? cause.existingCaseId
          : null);
        setReopenError('Já existe outra investigação ativa para este assunto.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_CASE_REOPEN_NOT_ALLOWED') {
        setReopenUncertain(false);
        setReopenReloadRequired(true);
        setReopenError('O caso não está mais disponível para reabertura. Recarregue os dados atuais.');
      } else if (cause instanceof ApiError && cause.code === 'FINDING_REVIEW_REOPEN_JUSTIFICATION_REQUIRED') {
        setReopenUncertain(false);
        setReopenError('Informe uma justificativa para reabrir a investigação.');
      } else if (cause instanceof ApiError && cause.code === 'INVALID_FINDING_REVIEW_REOPEN_JUSTIFICATION') {
        setReopenUncertain(false);
        setReopenError('A justificativa da reabertura é inválida. Revise o conteúdo informado.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setReopenUncertain(false);
        setReopenError('O caso não foi encontrado. Recarregue a lista para confirmar sua situação.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setReopenUncertain(false);
        setReopenError('A reabertura de casos está indisponível neste ambiente. Nenhum dado foi alterado.');
      } else {
        setReopenUncertain(false);
        setReopenError(displayError(cause, 'Não foi possível reabrir a investigação.'));
      }
    } finally {
      if (sequence === reopenSequence.current) reopenInFlight.current = false;
      if (reopenController.current === controller) reopenController.current = null;
      if (mounted.current && sequence === reopenSequence.current) setReopenLoading(false);
    }
  }

  function reloadReopen(): void {
    assignReopenAttempt(null);
    setReopenUncertain(false);
    setReopenError(null);
    setReopenSuccess(null);
    setReopenReloadRequired(false);
    setReopenExistingCaseId(null);
    retryDetail();
    retryList();
  }

  return {
    status: {
      loading: statusLoading,
      error: statusError,
      success: statusSuccess,
      conflict: statusConflict,
      submit: submitStatus,
      reload: reloadStatus,
    },
    decision: {
      loading: decisionLoading,
      error: decisionError,
      success: decisionSuccess,
      uncertain: decisionUncertain,
      reloadRequired: decisionReloadRequired,
      pendingAttempt: renderedDecisionAttempt,
      submit: submitDecision,
      reload: reloadDecision,
      mutationBlocked: statusLoading || statusConflict || resolutionLoading
        || resolutionUncertain || resolutionReloadRequired || reopenLoading
        || reopenUncertain || reopenReloadRequired || supersessionLoading
        || supersessionUncertain || supersessionReloadRequired,
    },
    supersession: {
      loading: supersessionLoading,
      error: supersessionError,
      fieldError: supersessionFieldError,
      success: supersessionSuccess,
      uncertain: supersessionUncertain,
      reloadRequired: supersessionReloadRequired,
      pendingAttempt: renderedSupersessionAttempt,
      submit: submitSupersession,
      reload: reloadSupersession,
      clearError: () => {
        setSupersessionError(null);
        setSupersessionFieldError(null);
      },
      mutationBlocked: statusLoading || statusConflict || decisionLoading
        || decisionUncertain || decisionReloadRequired || resolutionLoading
        || resolutionUncertain || resolutionReloadRequired || reopenLoading
        || reopenUncertain || reopenReloadRequired,
    },
    resolution: {
      loading: resolutionLoading,
      error: resolutionError,
      success: resolutionSuccess,
      uncertain: resolutionUncertain,
      reloadRequired: resolutionReloadRequired,
      pendingAttempt: renderedResolutionAttempt,
      submit: submitResolution,
      reload: reloadResolution,
      mutationBlocked: statusLoading || statusConflict || decisionLoading
        || decisionUncertain || decisionReloadRequired || reopenLoading
        || reopenUncertain || reopenReloadRequired || supersessionLoading
        || supersessionUncertain || supersessionReloadRequired,
    },
    reopen: {
      loading: reopenLoading,
      error: reopenError,
      success: reopenSuccess,
      uncertain: reopenUncertain,
      reloadRequired: reopenReloadRequired,
      pendingAttempt: renderedReopenAttempt,
      existingCaseId: reopenExistingCaseId,
      submit: submitReopen,
      reload: reloadReopen,
      clearError: () => setReopenError(null),
      mutationBlocked: statusLoading || statusConflict || decisionLoading
        || decisionUncertain || decisionReloadRequired || resolutionLoading
        || resolutionUncertain || resolutionReloadRequired || supersessionLoading
        || supersessionUncertain || supersessionReloadRequired,
    },
    statusMutationBlocked: decisionLoading || decisionUncertain || decisionReloadRequired
      || resolutionLoading || resolutionUncertain || resolutionReloadRequired
      || reopenLoading || reopenUncertain || reopenReloadRequired || supersessionLoading
      || supersessionUncertain || supersessionReloadRequired,
    restoreForDetail,
    invalidateAll,
  };
}
