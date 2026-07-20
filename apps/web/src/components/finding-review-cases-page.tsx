'use client';

import Link from 'next/link.js';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  serializeFindingReviewCaseQuery,
  type FindingReviewCaseSortField,
  type FindingReviewCaseStatus,
  type FindingReviewSortDirection,
  type FindingReviewStaleness,
} from '../lib/finding-review-cases';
import { formatDateTime } from '../lib/format';

export type ReviewCasesLoader = (query: FindingReviewCaseQuery) => Promise<FindingReviewCaseListResponse>;
export type ReviewCaseDetailLoader = (id: string) => Promise<FindingReviewCaseDetail>;
export type ReviewCaseCreator = (findingId: string, key: string) => Promise<CreateFindingReviewCaseResponse>;

interface Props {
  initialSearchParams?: Record<string, string | string[] | undefined>;
  loadCases?: ReviewCasesLoader;
  loadDetail?: ReviewCaseDetailLoader;
  createCase?: ReviewCaseCreator;
}

interface FormState {
  status: string;
  staleness: string;
  findingType: string;
  findingId: string;
  createdBy: string;
  sortBy: FindingReviewCaseSortField;
  sortDirection: FindingReviewSortDirection;
  pageSize: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function initialQuery(params: Record<string, string | string[] | undefined>): FindingReviewCaseQuery {
  const positive = (key: string, fallback: number): number => {
    const value = Number(first(params[key]));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const status = first(params.status);
  const staleness = first(params.staleness);
  const findingType = first(params.findingType);
  const sortBy = first(params.sortBy);
  const sortDirection = first(params.sortDirection);
  return {
    page: positive('page', 1),
    pageSize: Math.min(positive('pageSize', 25), 100),
    status: FINDING_REVIEW_CASE_STATUSES.includes(status as FindingReviewCaseStatus)
      ? status as FindingReviewCaseStatus : undefined,
    staleness: FINDING_REVIEW_STALENESSES.includes(staleness as FindingReviewStaleness)
      ? staleness as FindingReviewStaleness : undefined,
    findingType: CONFLICT_FINDING_TYPES.includes(findingType as never) ? findingType as never : undefined,
    findingId: first(params.findingId)?.trim() || undefined,
    createdBy: first(params.createdBy)?.trim() || undefined,
    sortBy: FINDING_REVIEW_SORT_FIELDS.includes(sortBy as FindingReviewCaseSortField)
      ? sortBy as FindingReviewCaseSortField : 'createdAt',
    sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
  };
}

function formFromQuery(query: FindingReviewCaseQuery): FormState {
  return {
    status: query.status ?? '',
    staleness: query.staleness ?? '',
    findingType: query.findingType ?? '',
    findingId: query.findingId ?? '',
    createdBy: query.createdBy ?? '',
    sortBy: query.sortBy ?? 'createdAt',
    sortDirection: query.sortDirection ?? 'desc',
    pageSize: String(query.pageSize ?? 25),
  };
}

function replaceUrl(query: FindingReviewCaseQuery): void {
  const serialized = serializeFindingReviewCaseQuery(query);
  window.history.pushState(null, '', `/conflict-review-cases${serialized ? `?${serialized}` : ''}`);
}

function displayError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 503) {
    return 'O fluxo de casos de revisão está temporariamente indisponível.';
  }
  return error instanceof Error ? error.message : fallback;
}

export function FindingReviewCasesPage({
  initialSearchParams = {},
  loadCases = getFindingReviewCases,
  loadDetail = getFindingReviewCase,
  createCase = createFindingReviewCase,
}: Props) {
  const firstQuery = useMemo(() => initialQuery(initialSearchParams), [initialSearchParams]);
  const [query, setQuery] = useState<FindingReviewCaseQuery>(firstQuery);
  const [form, setForm] = useState<FormState>(() => formFromQuery(firstQuery));
  const [result, setResult] = useState<FindingReviewCaseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const listSequence = useRef(0);

  const [detail, setDetail] = useState<FindingReviewCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(first(initialSearchParams.caseId)));
  const [detailError, setDetailError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(first(initialSearchParams.caseId) ?? null);

  const requestedFindingId = first(initialSearchParams.create) === '1'
    ? first(initialSearchParams.findingId) : undefined;
  const [creationLoading, setCreationLoading] = useState(false);
  const [creationResult, setCreationResult] = useState<CreateFindingReviewCaseResponse | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [existingCaseId, setExistingCaseId] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const sequence = ++listSequence.current;
    void loadCases(query)
      .then((value) => { if (sequence === listSequence.current) setResult(value); })
      .catch((cause) => { if (sequence === listSequence.current) setError(displayError(cause, 'Não foi possível carregar os casos.')); })
      .finally(() => { if (sequence === listSequence.current) setLoading(false); });
  }, [loadCases, query, reload]);

  useEffect(() => {
    if (!expandedId) return;
    let active = true;
    void loadDetail(expandedId)
      .then((value) => { if (active) setDetail(value); })
      .catch((cause) => { if (active) setDetailError(displayError(cause, 'Não foi possível carregar o detalhe do caso.')); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [expandedId, loadDetail]);

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next: FindingReviewCaseQuery = {
      page: 1,
      pageSize: Number(form.pageSize),
      status: form.status as FindingReviewCaseStatus || undefined,
      staleness: form.staleness as FindingReviewStaleness || undefined,
      findingType: form.findingType as FindingReviewCaseQuery['findingType'] || undefined,
      findingId: form.findingId.trim() || undefined,
      createdBy: form.createdBy.trim() || undefined,
      sortBy: form.sortBy,
      sortDirection: form.sortDirection,
    };
    replaceUrl(next);
    setLoading(true);
    setError(null);
    setQuery(next);
  }

  function clearFilters(): void {
    const next = { ...DEFAULT_FINDING_REVIEW_CASE_QUERY };
    setForm(formFromQuery(next));
    replaceUrl(next);
    setLoading(true);
    setError(null);
    setQuery(next);
  }

  function changePage(page: number): void {
    const next = { ...query, page };
    replaceUrl(next);
    setLoading(true);
    setError(null);
    setQuery(next);
  }

  function openDetail(id: string): void {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setExpandedId(id);
  }

  async function submitCreation(): Promise<void> {
    if (!requestedFindingId || creationLoading) return;
    setCreationLoading(true);
    setCreationError(null);
    setExistingCaseId(null);
    idempotencyKey.current ??= createFindingReviewIdempotencyKey(() => crypto.randomUUID());
    try {
      const created = await createCase(requestedFindingId, idempotencyKey.current);
      setCreationResult(created);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      setExpandedId(created.id);
      setLoading(true);
      setReload((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && cause.existingCaseId) {
        setExistingCaseId(cause.existingCaseId);
        setCreationError('Já existe um caso ativo para este assunto.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setCreationError('A criação de casos está desabilitada neste ambiente. Nenhum dado foi alterado.');
      } else if (cause instanceof ApiError && cause.status === 404) {
        setCreationError('O achado não está mais disponível. Atualize a lista de achados antes de tentar novamente.');
      } else {
        setCreationError(displayError(cause, 'Não foi possível criar o caso de revisão.'));
      }
    } finally {
      setCreationLoading(false);
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
          {creationError ? <div className="form-message form-message-error" role="alert">{creationError}{existingCaseId ? <button className="table-link-button" type="button" onClick={() => openDetail(existingCaseId)}> Abrir caso existente</button> : null}</div> : null}
        </section>
      ) : null}

      <section className="filter-card" aria-labelledby="review-filter-title">
        <div className="filter-card-heading"><div><p className="section-kicker">Refine a fila</p><h2 id="review-filter-title">Filtros e ordenação</h2></div></div>
        <form className="filter-grid review-case-filter-grid" onSubmit={submitFilters}>
          <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="">Todos</option>{FINDING_REVIEW_CASE_STATUSES.map((value) => <option key={value} value={value}>{getFindingReviewCaseStatusLabel(value)}</option>)}</select></label>
          <label>Atualidade<select value={form.staleness} onChange={(event) => setForm({ ...form, staleness: event.target.value })}><option value="">Todas</option>{FINDING_REVIEW_STALENESSES.map((value) => <option key={value} value={value}>{getFindingReviewStalenessLabel(value)}</option>)}</select></label>
          <label>Tipo de achado<select value={form.findingType} onChange={(event) => setForm({ ...form, findingType: event.target.value })}><option value="">Todos</option>{CONFLICT_FINDING_TYPES.map((value) => <option key={value} value={value}>{getConflictFindingTypeLabel(value)}</option>)}</select></label>
          <label>ID do achado<input value={form.findingId} onChange={(event) => setForm({ ...form, findingId: event.target.value })} /></label>
          <label>Criado por<input value={form.createdBy} onChange={(event) => setForm({ ...form, createdBy: event.target.value })} /></label>
          <label>Ordenar por<select value={form.sortBy} onChange={(event) => setForm({ ...form, sortBy: event.target.value as FindingReviewCaseSortField })}><option value="createdAt">Criação</option><option value="updatedAt">Atualização</option><option value="status">Status</option><option value="staleness">Atualidade</option></select></label>
          <label>Direção<select value={form.sortDirection} onChange={(event) => setForm({ ...form, sortDirection: event.target.value as FindingReviewSortDirection })}><option value="desc">Decrescente</option><option value="asc">Crescente</option></select></label>
          <label>Itens por página<select value={form.pageSize} onChange={(event) => setForm({ ...form, pageSize: event.target.value })}>{[10, 25, 50, 100].map((value) => <option key={value}>{value}</option>)}</select></label>
          <div className="filter-actions"><button className="button button-primary" type="submit">Aplicar filtros</button><button className="button button-secondary" type="button" onClick={clearFilters}>Limpar filtros</button></div>
        </form>
      </section>

      {loading && !result ? <LoadingState label="Carregando casos…" /> : null}
      {error && !result ? <ErrorState message={error} retry={() => { setLoading(true); setError(null); setReload((value) => value + 1); }} /> : null}
      {result ? (
        <>
          {error ? <div className="finding-inline-error" role="alert"><span>{error}</span><button className="button button-secondary" type="button" onClick={() => { setLoading(true); setError(null); setReload((value) => value + 1); }}>Tentar novamente</button></div> : null}
          <div className="table-scroll review-cases-table-wrap">
            <table className="data-table review-cases-table">
              <thead><tr><th>Caso</th><th>Tipo</th><th>Status</th><th>Atualidade</th><th>Ativos</th><th>Eventos</th><th>Atualizado em</th><th>Ação</th></tr></thead>
              <tbody>{result.items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.id.slice(0, 8)}</strong><small>{item.findingId}</small></td>
                  <td>{getConflictFindingTypeLabel(item.findingType)}</td>
                  <td><span className="status-badge">{getFindingReviewCaseStatusLabel(item.status)}</span></td>
                  <td>{getFindingReviewStalenessLabel(item.staleness)}</td><td>{item.assetCount}</td><td>{item.eventCount}</td><td>{formatDateTime(item.updatedAt)}</td>
                  <td><button className="table-link-button" type="button" aria-expanded={expandedId === item.id} onClick={() => openDetail(item.id)}>{expandedId === item.id ? 'Fechar' : 'Ver detalhe'}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {result.items.length === 0 ? <section className="empty-state"><h2>Nenhum caso encontrado.</h2><p>Revise os filtros ou crie um caso a partir de um achado.</p></section> : null}
          {expandedId ? <ReviewCaseDetail detail={detail} loading={detailLoading} error={detailError} retry={() => { setDetail(null); setDetailError(null); setDetailLoading(true); const current = expandedId; setExpandedId(null); queueMicrotask(() => setExpandedId(current)); }} /> : null}
          <nav className="pagination" aria-label="Paginação dos casos"><div className="pagination-summary"><strong>Página {result.pagination.page} de {Math.max(result.pagination.totalPages, 1)}</strong><span>{result.pagination.totalItems} resultados</span></div><div className="pagination-actions"><button type="button" disabled={result.pagination.page <= 1 || loading} onClick={() => changePage(result.pagination.page - 1)}>Anterior</button><button type="button" disabled={result.pagination.page >= result.pagination.totalPages || loading} onClick={() => changePage(result.pagination.page + 1)}>Próxima</button></div></nav>
        </>
      ) : null}
    </main>
  );
}

function ReviewCaseDetail({ detail, loading, error, retry }: { detail: FindingReviewCaseDetail | null; loading: boolean; error: string | null; retry: () => void }) {
  if (loading) return <LoadingState label="Carregando detalhe do caso…" />;
  if (error) return <ErrorState message={error} retry={retry} />;
  if (!detail) return null;
  return (
    <section className="review-case-detail" aria-labelledby="review-case-detail-title">
      <div className="finding-section-heading"><div><p className="section-kicker">Registro histórico</p><h2 id="review-case-detail-title">Detalhe do caso</h2></div><span className="status-badge">{getFindingReviewCaseStatusLabel(detail.status)}</span></div>
      <dl className="review-case-metadata"><div><dt>ID</dt><dd>{detail.id}</dd></div><div><dt>Achado</dt><dd>{detail.findingId}</dd></div><div><dt>Política</dt><dd>{detail.policyVersion}</dd></div><div><dt>Atualidade</dt><dd>{getFindingReviewStalenessLabel(detail.staleness)}</dd></div><div><dt>Criado por</dt><dd>{detail.createdBy}</dd></div><div><dt>Versão</dt><dd>{detail.version}</dd></div></dl>
      <div className="review-detail-grid">
        <article><h3>Ativos históricos e vínculos atuais</h3>{detail.assets.map((asset) => <div className="review-asset-record" key={asset.assetIdAtCreation}><strong>{asset.assetNameAtCreation}</strong><small>Na criação: {asset.assetIdAtCreation}</small><span>{asset.role}</span>{asset.currentAssetAvailable && asset.currentAssetId ? <Link href={`/assets/${asset.currentAssetId}`}>Ver vínculo atual: {asset.currentAssetName}</Link> : <em>O ativo histórico não está disponível atualmente.</em>}</div>)}</article>
        <article><h3>Histórico de eventos</h3><ol className="review-event-list">{detail.events.map((event) => <li key={event.id}><strong>{getFindingReviewEventLabel(event.eventType)}</strong><span>Versão {event.versionBefore ?? 0} → {event.versionAfter}</span><small>{formatDateTime(event.createdAt)} · {event.actor}</small></li>)}</ol></article>
      </div>
      <details className="review-snapshot"><summary>Visualizar snapshot histórico</summary><p>Hash: <code>{detail.originalSnapshotHash}</code></p><pre>{JSON.stringify(detail.originalSnapshot, null, 2)}</pre></details>
    </section>
  );
}
