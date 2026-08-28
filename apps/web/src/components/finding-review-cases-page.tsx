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
  createFindingReviewCaseReopen,
  createFindingReviewCaseResolution,
  createFindingReviewDecision,
  createFindingReviewCase,
  getFindingReviewCase,
  getFindingReviewCases,
  updateFindingReviewCaseStatus,
  type ActiveFindingReviewCaseStatus,
  type FindingReviewCaseDetail,
  type FindingReviewCaseQuery,
  type FindingReviewIdentityConclusion,
} from '../lib/api';
import { CONFLICT_FINDING_TYPES, getConflictFindingTypeLabel } from '../lib/conflict-findings';
import {
  FINDING_REVIEW_CASE_STATUSES,
  FINDING_REVIEW_STALENESSES,
  MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH,
  getAllowedFindingReviewCaseStatusDestinations,
  getFindingReviewCaseStatusLabel,
  getFindingReviewIdentityConclusionLabel,
  getFindingReviewEventLabel,
  getFindingReviewStalenessLabel,
  isFindingReviewCaseId,
  requiresFindingReviewCaseWaitingJustification,
  type FindingReviewCaseSortField,
  type FindingReviewCaseStatus,
  type FindingReviewSortDirection,
} from '../lib/finding-review-cases';
import { formatDateTime } from '../lib/format';
import {
  MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH,
  MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH,
  MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH,
  PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS,
  PENDING_REVIEW_REOPEN_ATTEMPT_TTL_MS,
  PENDING_REVIEW_RESOLUTION_ATTEMPT_TTL_MS,
  createPendingFindingReviewDecisionAttempt,
  createPendingFindingReviewReopenAttempt,
  createPendingFindingReviewResolutionAttempt,
  parsePendingFindingReviewDecisionAttempt,
  parsePendingFindingReviewReopenAttempt,
  parsePendingFindingReviewResolutionAttempt,
  type PendingFindingReviewDecisionAttempt,
  type PendingFindingReviewReopenAttempt,
  type PendingFindingReviewResolutionAttempt,
} from './finding-review-cases/review-case-command-pending';
import {
  useReviewCaseCommands,
  type ReviewCaseDecisionCreator,
  type ReviewCaseReopenCreator,
  type ReviewCaseResolutionCreator,
  type ReviewCaseStatusUpdater,
} from './finding-review-cases/use-review-case-commands';
import {
  buildFindingReviewCaseQueryFromForm,
  reviewCaseLocationFromParams,
  reviewCaseLocationFromSearchParams,
  reviewCaseLocationUrl,
  type FindingReviewCaseFilterForm,
} from './finding-review-cases/review-case-location';
import {
  PENDING_REVIEW_CASE_ATTEMPT_TTL_MS,
  createPendingFindingReviewCaseAttempt,
  parsePendingFindingReviewCaseAttempt,
  type PendingFindingReviewCaseAttempt,
} from './finding-review-cases/review-case-creation-pending';
import {
  useReviewCaseListController,
  type ReviewCasesLoader,
} from './finding-review-cases/use-review-case-list-controller';
import {
  useReviewCaseDetailController,
  type ReviewCaseDetailLoader,
} from './finding-review-cases/use-review-case-detail-controller';
import {
  useReviewCaseCreationCommand,
  type ReviewCaseCreator,
} from './finding-review-cases/use-review-case-creation-command';

export {
  MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH,
  MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH,
  MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH,
  PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS,
  PENDING_REVIEW_REOPEN_ATTEMPT_TTL_MS,
  PENDING_REVIEW_RESOLUTION_ATTEMPT_TTL_MS,
  createPendingFindingReviewDecisionAttempt,
  createPendingFindingReviewReopenAttempt,
  createPendingFindingReviewResolutionAttempt,
  parsePendingFindingReviewDecisionAttempt,
  parsePendingFindingReviewReopenAttempt,
  parsePendingFindingReviewResolutionAttempt,
  PENDING_REVIEW_CASE_ATTEMPT_TTL_MS,
  buildFindingReviewCaseQueryFromForm,
  createPendingFindingReviewCaseAttempt,
  parsePendingFindingReviewCaseAttempt,
};
export type {
  PendingFindingReviewDecisionAttempt,
  PendingFindingReviewReopenAttempt,
  PendingFindingReviewResolutionAttempt,
  ReviewCaseDecisionCreator,
  ReviewCaseReopenCreator,
  ReviewCaseResolutionCreator,
  ReviewCaseStatusUpdater,
  FindingReviewCaseFilterForm,
  PendingFindingReviewCaseAttempt,
};

export type { ReviewCasesLoader, ReviewCaseDetailLoader, ReviewCaseCreator };
interface Props {
  initialSearchParams?: Record<string, string | string[] | undefined>;
  loadCases?: ReviewCasesLoader;
  loadDetail?: ReviewCaseDetailLoader;
  createCase?: ReviewCaseCreator;
  updateStatus?: ReviewCaseStatusUpdater;
  createDecision?: ReviewCaseDecisionCreator;
  createResolution?: ReviewCaseResolutionCreator;
  createReopen?: ReviewCaseReopenCreator;
}

type ReviewCaseCommands = ReturnType<typeof useReviewCaseCommands>;

const DETAIL_PANEL_ID = 'finding-review-case-detail';
function pushLocation(
  query: FindingReviewCaseQuery,
  caseId: string | null,
  requestedFindingId: string | null,
): void {
  window.history.pushState(null, '', reviewCaseLocationUrl(query, caseId, requestedFindingId));
}

export function FindingReviewCasesPage({
  initialSearchParams = {},
  loadCases = getFindingReviewCases,
  loadDetail = getFindingReviewCase,
  createCase = createFindingReviewCase,
  updateStatus = updateFindingReviewCaseStatus,
  createDecision = createFindingReviewDecision,
  createResolution = createFindingReviewCaseResolution,
  createReopen = createFindingReviewCaseReopen,
}: Props) {
  const firstLocation = useMemo(
    () => reviewCaseLocationFromParams(initialSearchParams),
    [initialSearchParams],
  );
  const commandsRef = useRef<ReviewCaseCommands | null>(null);
  const listController = useReviewCaseListController({
    initialQuery: firstLocation.query,
    loadCases,
  });
  const detailController = useReviewCaseDetailController({
    initialSelectedId: firstLocation.caseId,
    loadDetail,
    onDetailLoaded: (value) => commandsRef.current?.restoreForDetail(value),
  });
  const mounted = useRef(false);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const detailFocusFrame = useRef<number | null>(null);
  const restoreFocusFrame = useRef<number | null>(null);

  const [requestedFindingId, setRequestedFindingId] = useState<string | null>(
    firstLocation.requestedFindingId,
  );
  const creationController = useReviewCaseCreationCommand({
    createCase,
    onSuccess: (created) => {
      openDetail(created.id);
      listController.reload();
    },
  });

  const commands = useReviewCaseCommands({
    detail: detailController.detail,
    selectedCaseIdRef: detailController.selectedIdRef,
    updateStatus,
    createDecision,
    createResolution,
    createReopen,
    applyDetailUpdate: detailController.applyLocalUpdate,
    invalidateDetailRequest: invalidateDetailInteraction,
    loadFreshDetail: detailController.loadFreshDetail,
    requestDetailReload: detailController.requestReload,
    requestListReload: listController.reload,
    retryDetail,
    retryList: listController.reload,
  });
  commandsRef.current = commands;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
    const restoreFromUrl = (): void => {
      const restored = reviewCaseLocationFromSearchParams(
        new URLSearchParams(window.location.search),
      );
      if (restoreFocusFrame.current !== null) {
        window.cancelAnimationFrame(restoreFocusFrame.current);
        restoreFocusFrame.current = null;
      }
      listController.restoreQuery(restored.query);
      creationController.resetForIntentChange();
      setRequestedFindingId(restored.requestedFindingId);
      if (restored.caseId !== detailController.selectedIdRef.current) {
        commandsRef.current?.invalidateAll();
        cancelDetailFocus();
        detailTrigger.current = null;
        detailController.restoreSelection(restored.caseId);
      }
    };
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
    // The listener is deliberately installed once and reads current controller refs internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (detailFocusFrame.current !== null) {
      window.cancelAnimationFrame(detailFocusFrame.current);
      detailFocusFrame.current = null;
    }
    if (
      !detailController.selectedId
      || detailController.loading
      || (!detailController.detail && !detailController.error)
      || !detailHeading.current
    ) return;
    const requestedId = detailController.selectedId;
    const requestedHeading = detailHeading.current;
    detailFocusFrame.current = window.requestAnimationFrame(() => {
      detailFocusFrame.current = null;
      if (
        mounted.current
        && detailController.selectedIdRef.current === requestedId
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
  }, [
    detailController.detail,
    detailController.error,
    detailController.loading,
    detailController.selectedId,
    detailController.selectedIdRef,
  ]);

  function cancelDetailFocus(): void {
    if (detailFocusFrame.current !== null) {
      window.cancelAnimationFrame(detailFocusFrame.current);
      detailFocusFrame.current = null;
    }
  }

  function invalidateDetailInteraction(): void {
    cancelDetailFocus();
    detailController.invalidateRequest();
  }

  function updateQuery(next: FindingReviewCaseQuery, nextRequestedFindingId = requestedFindingId): void {
    pushLocation(next, detailController.selectedIdRef.current, nextRequestedFindingId);
    updateRequestedFinding(nextRequestedFindingId);
    listController.startQuery(next);
  }

  function updateRequestedFinding(next: string | null): void {
    if (next === requestedFindingId) return;
    creationController.resetForIntentChange();
    setRequestedFindingId(next);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = listController.parseFilters();
    if (next) updateQuery(next, null);
  }

  function clearFilters(): void {
    const next = listController.resetFilters();
    updateQuery(next, null);
  }

  function changePage(page: number): void {
    const next = listController.queryForPage(page);
    if (next) updateQuery(next);
  }

  function openDetail(id: string, trigger?: HTMLButtonElement): void {
    if (!isFindingReviewCaseId(id)) return;
    if (restoreFocusFrame.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrame.current);
      restoreFocusFrame.current = null;
    }
    if (detailController.selectedIdRef.current === id) {
      closeDetail(true);
      return;
    }
    commandsRef.current?.invalidateAll();
    cancelDetailFocus();
    if (trigger) detailTrigger.current = trigger;
    else detailTrigger.current = null;
    detailController.select(id);
    pushLocation(listController.queryRef.current, id, requestedFindingId);
  }

  function closeDetail(updateHistory: boolean): void {
    commandsRef.current?.invalidateAll();
    cancelDetailFocus();
    detailController.clear();
    if (updateHistory) pushLocation(listController.queryRef.current, null, requestedFindingId);
    const trigger = detailTrigger.current;
    detailTrigger.current = null;
    if (restoreFocusFrame.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrame.current);
    }
    restoreFocusFrame.current = window.requestAnimationFrame(() => {
      restoreFocusFrame.current = null;
      if (mounted.current && detailController.selectedIdRef.current === null) trigger?.focus();
    });
  }

  function retryDetail(): void {
    cancelDetailFocus();
    detailController.retry();
  }

  const {
    form,
    setForm,
    filterError,
    result,
    loading,
    error,
  } = listController;
  const {
    detail,
    loading: detailLoading,
    error: detailError,
    selectedId: expandedId,
  } = detailController;
  const {
    loading: creationLoading,
    result: creationResult,
    error: creationError,
    existingCaseId,
  } = creationController;

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
          <button className="button button-primary" type="button" disabled={creationLoading || Boolean(creationResult)} onClick={() => void creationController.submit(requestedFindingId)}>
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
      {error && !result ? <ErrorState message={error} retry={listController.reload} /> : null}
      {result ? (
        <>
          {error ? <div className="finding-inline-error" role="alert"><span>{error}</span><button className="button button-secondary" type="button" onClick={listController.reload}>Tentar novamente</button></div> : null}
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
            commands={commands}
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
  commands,
}: {
  detail: FindingReviewCaseDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  close: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  commands: ReviewCaseCommands;
}) {
  if (loading) return <><div className="review-detail-toolbar"><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div><LoadingState label="Carregando detalhe do caso…" /></>;
  if (error) return <><div className="review-detail-toolbar"><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div><ErrorState message={error} retry={retry} /></>;
  if (!detail) return null;
  return (
    <>
      <div className="finding-section-heading review-detail-toolbar"><div><p className="section-kicker">Registro histórico</p><h2 id="review-case-detail-title" ref={headingRef} tabIndex={-1}>Detalhe do caso</h2></div><div><span className="status-badge">{getFindingReviewCaseStatusLabel(detail.status)}</span><button className="button button-secondary" type="button" onClick={close}>Fechar detalhe</button></div></div>
      <dl className="review-case-metadata"><div><dt>ID</dt><dd>{detail.id}</dd></div><div><dt>Achado</dt><dd>{detail.findingId}</dd></div><div><dt>Política</dt><dd>{detail.policyVersion}</dd></div><div><dt>Atualidade</dt><dd>{getFindingReviewStalenessLabel(detail.staleness)}</dd></div><div><dt>Criado por</dt><dd>{detail.createdBy}</dd></div><div><dt>Versão</dt><dd>{detail.version}</dd></div></dl>
      <IdentityDecisionControl
        key={`decision:${detail.id}:${detail.version}:${detail.currentDecision?.id ?? 'none'}`}
        detail={detail}
        loading={commands.decision.loading}
        mutationBlocked={commands.decision.mutationBlocked}
        error={commands.decision.error}
        success={commands.decision.success}
        uncertain={commands.decision.uncertain}
        reloadRequired={commands.decision.reloadRequired}
        pendingAttempt={commands.decision.pendingAttempt?.caseId === detail.id
          ? commands.decision.pendingAttempt
          : null}
        submit={commands.decision.submit}
        reload={commands.decision.reload}
      />
      <ResolutionControl
        key={`resolution:${detail.id}:${detail.status}:${detail.version}:${detail.currentDecision?.id ?? 'none'}`}
        detail={detail}
        loading={commands.resolution.loading}
        mutationBlocked={commands.resolution.mutationBlocked}
        error={commands.resolution.error}
        success={commands.resolution.success}
        uncertain={commands.resolution.uncertain}
        reloadRequired={commands.resolution.reloadRequired}
        pendingAttempt={commands.resolution.pendingAttempt?.caseId === detail.id
          ? commands.resolution.pendingAttempt
          : null}
        submit={commands.resolution.submit}
        reload={commands.resolution.reload}
      />
      <ReopenControl
        key={`reopen:${detail.id}:${detail.status}:${detail.version}`}
        detail={detail}
        loading={commands.reopen.loading}
        mutationBlocked={commands.reopen.mutationBlocked}
        error={commands.reopen.error}
        success={commands.reopen.success}
        uncertain={commands.reopen.uncertain}
        reloadRequired={commands.reopen.reloadRequired}
        pendingAttempt={commands.reopen.pendingAttempt?.caseId === detail.id
          ? commands.reopen.pendingAttempt
          : null}
        existingCaseId={commands.reopen.existingCaseId}
        submit={commands.reopen.submit}
        reload={commands.reopen.reload}
        clearError={commands.reopen.clearError}
      />
      <StatusTransitionControl
        key={`status:${detail.id}:${detail.status}:${detail.version}`}
        detail={detail}
        loading={commands.status.loading}
        error={commands.status.error}
        success={commands.status.success}
        conflict={commands.status.conflict}
        submit={commands.status.submit}
        reload={commands.status.reload}
        mutationBlocked={commands.statusMutationBlocked}
      />
      <div className="review-detail-grid">
        <article><h3>Ativos históricos e vínculos atuais</h3>{detail.assets.map((asset) => <div className="review-asset-record" key={asset.assetIdAtCreation}><strong>{asset.assetNameAtCreation}</strong><small>Na criação: {asset.assetIdAtCreation}</small><span>{asset.role}</span>{asset.currentAssetAvailable && asset.currentAssetId ? <Link href={`/assets/${encodeURIComponent(asset.currentAssetId)}`}>Ver vínculo atual: {asset.currentAssetName}</Link> : <em>Ativo atual não disponível. O vínculo histórico foi preservado.</em>}</div>)}</article>
        <article><h3>Histórico de eventos</h3><ol className="review-event-list">{detail.events.map((event) => <li key={event.id}><strong>{getFindingReviewEventLabel(event.eventType)}</strong>{formatStatusTransition(event.metadata)}{formatDecisionEvent(event.eventType, event.metadata)}{formatResolutionEvent(event.eventType, event.metadata)}{formatReopenEvent(event.eventType)}{formatTransitionJustification(event.metadata)}<span>Versão {event.versionBefore ?? 0} → {event.versionAfter}</span><small>{formatDateTime(event.createdAt)} · {event.actor}</small></li>)}</ol></article>
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

function ResolutionControl({
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
  pendingAttempt: PendingFindingReviewResolutionAttempt | null;
  submit: (justification?: string) => Promise<void>;
  reload: () => void;
}) {
  const resolutionEvent = findResolutionEvent(detail.events);
  const [justification, setJustification] = useState(pendingAttempt?.justification ?? '');
  const [confirmation, setConfirmation] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const justificationField = useRef<HTMLTextAreaElement | null>(null);
  const confirmationHeading = useRef<HTMLHeadingElement | null>(null);
  const normalizedJustification = justification.trim();
  const locked = loading || mutationBlocked || uncertain || reloadRequired;

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
  }, [confirmation]);

  if (detail.status === 'RESOLVED') {
    return (
      <section className="review-resolution-control" aria-labelledby="review-resolution-title">
        <div><p className="section-kicker">Encerramento lógico</p><h3 id="review-resolution-title">Resolução do caso</h3></div>
        {resolutionEvent ? (
          <article className="review-resolution-card">
            <strong>Investigação concluída</strong>
            <p>{getResolutionConclusionCopy(resolutionEvent.metadata?.identityConclusion)}</p>
            <p className="review-decision-justification">{resolutionEvent.metadata?.justification}</p>
            <dl>
              <div><dt>Estado</dt><dd>Em análise → Resolvido</dd></div>
              <div><dt>Decisão utilizada</dt><dd>{getResolutionDecisionLabel(resolutionEvent.metadata?.identityConclusion)}</dd></div>
              <div><dt>Versão</dt><dd>{resolutionEvent.versionBefore ?? 0} → {resolutionEvent.versionAfter}</dd></div>
            </dl>
            <small>{formatDateTime(resolutionEvent.createdAt)} · {resolutionEvent.actor}</small>
          </article>
        ) : <p className="review-decision-guidance">O caso está resolvido, mas os detalhes do evento de resolução não estão disponíveis nesta resposta.</p>}
        {success ? <p className="form-message form-message-success" role="status" aria-live="polite">{success}</p> : null}
        {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const eligible = detail.status === 'IN_REVIEW' && detail.currentDecision !== null;
  const consequence = detail.currentDecision?.identityConclusion === 'SAME_ASSET'
    ? 'Esta conclusão não mescla ativos e não altera o inventário.'
    : 'Esta conclusão não aplica suppression automática e não altera o inventário.';

  function reviewResolution(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (normalizedJustification.length < 1) {
      setValidationError('Informe uma justificativa para concluir a investigação.');
      justificationField.current?.focus();
      return;
    }
    if (normalizedJustification.length > MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH) {
      setValidationError('A justificativa deve ter no máximo 1000 caracteres.');
      justificationField.current?.focus();
      return;
    }
    setValidationError(null);
    setConfirmation(true);
  }

  return (
    <section className="review-resolution-control" aria-labelledby="review-resolution-title">
      <div><p className="section-kicker">Encerramento lógico</p><h3 id="review-resolution-title">Resolução do caso</h3><p>A decisão de identidade registra a conclusão humana; a resolução encerra a investigação.</p></div>
      {detail.status === 'IN_REVIEW' && !detail.currentDecision && !uncertain ? (
        <p className="review-decision-guidance">Registre uma decisão de identidade antes de resolver o caso.</p>
      ) : null}
      {detail.status !== 'IN_REVIEW' && !uncertain ? (
        <p className="review-decision-guidance">A resolução fica disponível quando o caso está em análise e possui uma decisão de identidade.</p>
      ) : null}
      {uncertain && pendingAttempt ? (
        <div className="review-decision-uncertain" role="alert">
          <strong>Resultado incerto</strong>
          <p>Não foi possível confirmar se o caso foi resolvido. Tente novamente para consultar o mesmo resultado com segurança. A mesma chave idempotente será reutilizada.</p>
          <button className="button button-primary" type="button" disabled={loading || mutationBlocked} onClick={() => void submit()}>{loading ? 'Tentando novamente…' : 'Tentar novamente'}</button>
        </div>
      ) : eligible && !confirmation ? (
        <form className="review-resolution-form" onSubmit={reviewResolution}>
          <div className="review-resolution-context">
            <strong>{getResolutionConclusionCopy(detail.currentDecision?.identityConclusion)}</strong>
            <p>{consequence}</p>
          </div>
          <label htmlFor="review-resolution-justification">Justificativa da resolução</label>
          <textarea
            id="review-resolution-justification"
            ref={justificationField}
            value={justification}
            maxLength={MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH + 1}
            required
            disabled={locked}
            aria-invalid={validationError !== null}
            aria-describedby={`review-resolution-justification-help review-resolution-counter${validationError ? ' review-resolution-justification-error' : ''}`}
            onInput={(event) => { setJustification(event.currentTarget.value); setValidationError(null); }}
          />
          <small id="review-resolution-justification-help">Explique por que a investigação pode ser encerrada. Não inclua senhas, tokens ou dados sensíveis.</small>
          <span id="review-resolution-counter" className="review-decision-counter">{normalizedJustification.length} / {MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH}</span>
          {validationError ? <p id="review-resolution-justification-error" className="form-message form-message-error" role="alert">{validationError}</p> : null}
          <button className="button button-primary" type="submit" disabled={locked}>Revisar resolução</button>
        </form>
      ) : eligible ? (
        <div className="review-resolution-confirmation">
          <h4 ref={confirmationHeading} tabIndex={-1}>Confirme a resolução</h4>
          <dl>
            <div><dt>Decisão de identidade</dt><dd>{getResolutionDecisionLabel(detail.currentDecision?.identityConclusion)}</dd></div>
            <div><dt>Justificativa</dt><dd className="review-decision-justification">{normalizedJustification}</dd></div>
          </dl>
          <p>Ao confirmar, o status do caso passará para Resolvido e a investigação será encerrada. O Conflict não será alterado e nenhuma remediação será executada.</p>
          <p>{consequence}</p>
          <div className="review-decision-actions"><button className="button button-primary" type="button" disabled={loading || mutationBlocked} onClick={() => void submit(normalizedJustification)}>{loading ? 'Resolvendo…' : 'Resolver caso'}</button><button className="button button-secondary" type="button" disabled={loading} onClick={() => setConfirmation(false)}>Voltar e editar</button></div>
        </div>
      ) : null}
      {success ? <p className="form-message form-message-success" role="status" aria-live="polite">{success}</p> : null}
      {error ? <div className="form-message form-message-error" role="alert">{error}{reloadRequired ? <button className="table-link-button" type="button" onClick={reload}> Recarregar caso</button> : null}</div> : null}
      {loading ? <p className="form-message" role="status" aria-live="polite">Resolvendo o caso…</p> : null}
    </section>
  );
}

function ReopenControl({
  detail,
  loading,
  mutationBlocked,
  error,
  success,
  uncertain,
  reloadRequired,
  pendingAttempt,
  existingCaseId,
  submit,
  reload,
  clearError,
}: {
  detail: FindingReviewCaseDetail;
  loading: boolean;
  mutationBlocked: boolean;
  error: string | null;
  success: string | null;
  uncertain: boolean;
  reloadRequired: boolean;
  pendingAttempt: PendingFindingReviewReopenAttempt | null;
  existingCaseId: string | null;
  submit: (justification?: string) => Promise<void>;
  reload: () => void;
  clearError: () => void;
}) {
  const [justification, setJustification] = useState(pendingAttempt?.justification ?? '');
  const [confirmation, setConfirmation] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const justificationField = useRef<HTMLTextAreaElement | null>(null);
  const confirmationHeading = useRef<HTMLHeadingElement | null>(null);
  const normalizedJustification = justification.trim();
  const locked = loading || mutationBlocked || uncertain || reloadRequired;
  const serverJustificationError = Boolean(error && /justificativa/i.test(error));
  const serverJustificationErrorId = 'review-reopen-justification-server-error';

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
  }, [confirmation]);

  useEffect(() => {
    if (serverJustificationError) justificationField.current?.focus();
  }, [serverJustificationError]);

  if (detail.status !== 'RESOLVED' && !uncertain && !success && !error) return null;

  function reviewReopen(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (normalizedJustification.length < 1) {
      setValidationError('Informe uma justificativa para reabrir a investigação.');
      justificationField.current?.focus();
      return;
    }
    if (normalizedJustification.length > MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH) {
      setValidationError('A justificativa deve ter no máximo 1000 caracteres.');
      justificationField.current?.focus();
      return;
    }
    setValidationError(null);
    clearError();
    setConfirmation(true);
  }

  return (
    <section className="review-reopen-control" aria-labelledby="review-reopen-title">
      <div>
        <p className="section-kicker">Retomada controlada</p>
        <h3 id="review-reopen-title">Reabertura da investigação</h3>
        <p>Reabrir altera o caso de Resolvido para Em análise. A decisão e o histórico existentes são preservados.</p>
      </div>
      {uncertain && pendingAttempt ? (
        <div className="review-decision-uncertain" role="alert">
          <strong>Resultado incerto</strong>
          <p>Não foi possível confirmar se a investigação foi reaberta. Tente novamente para consultar o mesmo resultado com segurança. A mesma chave idempotente será reutilizada.</p>
          <button className="button button-primary" type="button" disabled={loading || mutationBlocked} onClick={() => void submit()}>{loading ? 'Tentando novamente…' : 'Tentar novamente'}</button>
        </div>
      ) : detail.status === 'RESOLVED' && (!confirmation || serverJustificationError) ? (
        <form className="review-reopen-form" onSubmit={reviewReopen}>
          <div className="review-reopen-context">
            <strong>Resolvido → Em análise</strong>
            <p>A reabertura não altera inventário, evidências ou conflitos e não executa remediação automática.</p>
          </div>
          <label htmlFor="review-reopen-justification">Justificativa da reabertura</label>
          <textarea
            id="review-reopen-justification"
            ref={justificationField}
            value={justification}
            maxLength={MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH + 1}
            required
            disabled={locked}
            aria-invalid={validationError !== null || serverJustificationError}
            aria-describedby={`review-reopen-justification-help review-reopen-counter${validationError ? ' review-reopen-justification-error' : ''}${serverJustificationError ? ` ${serverJustificationErrorId}` : ''}`}
            onInput={(event) => {
              setJustification(event.currentTarget.value);
              setValidationError(null);
              if (serverJustificationError) {
                setConfirmation(false);
                clearError();
              }
            }}
          />
          <small id="review-reopen-justification-help">Explique por que a investigação precisa ser retomada. Não inclua senhas, tokens ou dados sensíveis.</small>
          <span id="review-reopen-counter" className="review-decision-counter">{normalizedJustification.length} / {MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH}</span>
          {validationError ? <p id="review-reopen-justification-error" className="form-message form-message-error" role="alert">{validationError}</p> : null}
          <button className="button button-primary" type="submit" disabled={locked}>Revisar reabertura</button>
        </form>
      ) : detail.status === 'RESOLVED' ? (
        <div className="review-reopen-confirmation">
          <h4 ref={confirmationHeading} tabIndex={-1}>Confirme a reabertura</h4>
          <dl>
            <div><dt>Alteração</dt><dd>Resolvido → Em análise</dd></div>
            <div><dt>Justificativa</dt><dd className="review-decision-justification">{normalizedJustification}</dd></div>
          </dl>
          <p>A decisão atual será preservada e a resolução anterior permanecerá no histórico. O inventário, o Conflict e as evidências não serão modificados. Nenhuma remediação será executada.</p>
          <div className="review-decision-actions"><button className="button button-primary" type="button" disabled={loading || mutationBlocked} onClick={() => void submit(normalizedJustification)}>{loading ? 'Reabrindo…' : 'Reabrir investigação'}</button><button className="button button-secondary" type="button" disabled={loading} onClick={() => setConfirmation(false)}>Voltar e editar</button></div>
        </div>
      ) : null}
      {success ? <p className="form-message form-message-success" role="status" aria-live="polite">{success}</p> : null}
      {error ? <div id={serverJustificationError ? serverJustificationErrorId : undefined} className="form-message form-message-error" role="alert">{error}{reloadRequired ? <button className="table-link-button" type="button" onClick={reload}> Recarregar caso</button> : null}{existingCaseId ? <> <Link href={`/conflict-review-cases?caseId=${encodeURIComponent(existingCaseId)}`}>Abrir investigação existente</Link></> : null}</div> : null}
      {loading ? <p className="form-message" role="status" aria-live="polite">Reabrindo a investigação…</p> : null}
    </section>
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

function formatResolutionEvent(eventType: string, metadata: Record<string, string> | null) {
  if (eventType !== 'CASE_RESOLVED') return null;
  const conclusion = metadata?.identityConclusion;
  const decisionId = metadata?.decisionId;
  return (
    <>
      <span>Em análise → Resolvido</span>
      {conclusion === 'SAME_ASSET' || conclusion === 'DIFFERENT_ASSETS'
        ? <span>Decisão utilizada: {getFindingReviewIdentityConclusionLabel(conclusion)}</span>
        : null}
      {decisionId ? <span>Registro da decisão: {decisionId}</span> : null}
    </>
  );
}

function formatReopenEvent(eventType: string) {
  if (eventType !== 'CASE_REOPENED') return null;
  return <span>Resolvido → Em análise</span>;
}

function findResolutionEvent(
  events: FindingReviewCaseDetail['events'],
): FindingReviewCaseDetail['events'][number] | null {
  return events
    .filter((event) => event.eventType === 'CASE_RESOLVED')
    .sort((left, right) => {
      if (left.versionAfter !== right.versionAfter) return right.versionAfter - left.versionAfter;
      if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
      return left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
    })[0] ?? null;
}

function getResolutionDecisionLabel(value: string | undefined): string {
  if (value === 'SAME_ASSET' || value === 'DIFFERENT_ASSETS') {
    return getFindingReviewIdentityConclusionLabel(value);
  }
  return 'Decisão não disponível';
}

function getResolutionConclusionCopy(value: string | undefined): string {
  if (value === 'SAME_ASSET') {
    return 'Os registros foram considerados pertencentes ao mesmo ativo.';
  }
  if (value === 'DIFFERENT_ASSETS') {
    return 'Os registros foram considerados ativos diferentes.';
  }
  return 'A conclusão de identidade utilizada não está disponível.';
}
