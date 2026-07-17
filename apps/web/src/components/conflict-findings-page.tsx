'use client';

import Link from 'next/link.js';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { ErrorState, LoadingState } from './page-state';
import {
  ApiError,
  getAssetConflictAnalysis,
  getConflictFindings,
  type ConflictFindingDetail,
  type ConflictFindingListItem,
  type ConflictFindingQueryParams,
  type ConflictFindingSortDirection,
  type ConflictFindingSortField,
  type ConflictFindingsRequestOptions,
  type ConflictFindingsResponse,
  type IdentityNetworkAnalysisResponse,
} from '../lib/api';
import {
  CONFLICT_FINDING_SORT_FIELDS,
  CONFLICT_FINDING_TYPES,
  CONFLICT_SOURCE_TYPES,
  CONFLICT_TEMPORAL_RELATIONSHIPS,
  DEFAULT_CONFLICT_FINDING_QUERY,
  conflictFindingSearchParamsResult,
  formatTemporalDifference,
  getConflictFindingTypeLabel,
  getConflictReviewOptionLabel,
  getConflictSourceTypeLabel,
  getConflictTemporalRelationshipLabel,
  hasConflictFindingFilters,
  isMatchingDetailedFinding,
  serializeConflictFindingQuery,
  type ConflictFindingSearchParamsResult,
  type ConflictFindingUrlIssue,
} from '../lib/conflict-findings';
import { formatDateTime } from '../lib/format';

export type ConflictFindingsLoader = (
  query: ConflictFindingQueryParams,
  options?: ConflictFindingsRequestOptions,
) => Promise<ConflictFindingsResponse>;

export type ConflictFindingDetailLoader = (
  assetId: string,
  options?: ConflictFindingsRequestOptions,
) => Promise<IdentityNetworkAnalysisResponse>;

interface ConflictFindingsPageProps {
  initialSearchParams?: Record<string, string | string[] | undefined>;
  loadFindings?: ConflictFindingsLoader;
  loadDetail?: ConflictFindingDetailLoader;
}

interface FilterForm {
  type: string;
  assetId: string;
  hostname: string;
  ip: string;
  sourceType: string;
  temporalRelationship: string;
  hasLimitations: string;
  sortBy: ConflictFindingSortField;
  sortDirection: ConflictFindingSortDirection;
  pageSize: string;
}

const sortLabels: Record<ConflictFindingSortField, string> = {
  type: 'Tipo',
  findingId: 'Identificador do achado',
  affectedAssets: 'Quantidade de ativos',
  observationCount: 'Quantidade de observações',
  firstObservedAt: 'Primeira observação',
  lastObservedAt: 'Última observação',
};

function formFromQuery(query: ConflictFindingQueryParams): FilterForm {
  return {
    type: query.type ?? '',
    assetId: query.assetId ?? '',
    hostname: query.hostname ?? '',
    ip: query.ip ?? '',
    sourceType: query.sourceType ?? '',
    temporalRelationship: query.temporalRelationship ?? '',
    hasLimitations:
      query.hasLimitations === undefined ? '' : query.hasLimitations ? 'true' : 'false',
    sortBy: query.sortBy ?? DEFAULT_CONFLICT_FINDING_QUERY.sortBy,
    sortDirection: query.sortDirection ?? DEFAULT_CONFLICT_FINDING_QUERY.sortDirection,
    pageSize: String(query.pageSize ?? DEFAULT_CONFLICT_FINDING_QUERY.pageSize),
  };
}

function formFromSearchParamsResult(result: ConflictFindingSearchParamsResult): FilterForm {
  const form = formFromQuery(result.query);
  for (const issue of result.issues) form[issue.field] = issue.value;
  return form;
}

function listErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) {
    return 'Os filtros informados não são válidos. Revise os valores e tente novamente.';
  }
  return error instanceof Error
    ? error.message
    : 'Não foi possível consultar os achados de identidade e rede.';
}

function replaceUrl(query: ConflictFindingQueryParams): void {
  const serialized = serializeConflictFindingQuery(query);
  window.history.pushState(null, '', serialized ? `/conflict-findings?${serialized}` : '/conflict-findings');
}

function sameAssetSet(left: string[], right: string[]): boolean {
  return [...left].sort().join('|') === [...right].sort().join('|');
}

export function ConflictFindingsPage({
  initialSearchParams = {},
  loadFindings = getConflictFindings,
  loadDetail = getAssetConflictAnalysis,
}: ConflictFindingsPageProps) {
  const firstSearchParamsResult = useMemo(
    () => conflictFindingSearchParamsResult(initialSearchParams),
    [initialSearchParams],
  );
  const [form, setForm] = useState<FilterForm>(() =>
    formFromSearchParamsResult(firstSearchParamsResult),
  );
  const [query, setQuery] = useState<ConflictFindingQueryParams>(firstSearchParamsResult.query);
  const [urlIssues, setUrlIssues] = useState<ConflictFindingUrlIssue[]>(
    firstSearchParamsResult.issues,
  );
  const [result, setResult] = useState<ConflictFindingsResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const listSequence = useRef(0);
  const hasLoaded = useRef(false);

  const [detailItem, setDetailItem] = useState<ConflictFindingListItem | null>(null);
  const [detailFinding, setDetailFinding] = useState<ConflictFindingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailStale, setDetailStale] = useState(false);
  const detailSequence = useRef(0);
  const detailController = useRef<AbortController | null>(null);
  const detailCloseButton = useRef<HTMLButtonElement | null>(null);
  const detailPanel = useRef<HTMLElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const pageContent = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++listSequence.current;

    void loadFindings(query, { signal: controller.signal })
      .then((loadedResult) => {
        if (sequence !== listSequence.current || controller.signal.aborted) return;
        setResult(loadedResult);
        hasLoaded.current = true;
      })
      .catch((loadError: unknown) => {
        if (sequence !== listSequence.current || controller.signal.aborted) return;
        setError(listErrorMessage(loadError));
      })
      .finally(() => {
        if (sequence !== listSequence.current || controller.signal.aborted) return;
        setInitialLoading(false);
        setUpdating(false);
      });

    return () => controller.abort();
  }, [loadFindings, query, requestVersion]);

  useEffect(() => {
    const restoreFromUrl = (): void => {
      const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
      const restored = conflictFindingSearchParamsResult(params);
      if (hasLoaded.current) setUpdating(true);
      else setInitialLoading(true);
      setError(null);
      setUrlIssues(restored.issues);
      setForm(formFromSearchParamsResult(restored));
      setQuery(restored.query);
    };
    window.addEventListener('popstate', restoreFromUrl);
    return () => window.removeEventListener('popstate', restoreFromUrl);
  }, []);

  const closeDetail = useCallback((): void => {
    detailController.current?.abort();
    detailSequence.current += 1;
    setDetailItem(null);
    setDetailFinding(null);
    setDetailLoading(false);
    setDetailError(null);
    setDetailStale(false);
    const trigger = detailTrigger.current;
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  useEffect(() => {
    if (!detailItem) return;
    const panel = detailPanel.current;
    const background = pageContent.current;
    if (!panel || !background) return;

    const previousInert = background.inert;
    const previousInertAttribute = background.getAttribute('inert');
    const previousAriaHidden = background.getAttribute('aria-hidden');
    background.inert = true;
    background.setAttribute('inert', '');
    background.setAttribute('aria-hidden', 'true');

    const focusableElements = (): HTMLElement[] =>
      [...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(
        (element) =>
          !element.hidden &&
          element.getAttribute('aria-hidden') !== 'true' &&
          !element.closest('[inert]'),
      );

    const focusFirst = (): void => {
      (focusableElements()[0] ?? panel).focus();
    };

    detailCloseButton.current?.focus();

    const containFocus = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetail();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const redirectExternalFocus = (event: FocusEvent): void => {
      if (!panel.contains(event.target as Node)) focusFirst();
    };

    window.addEventListener('keydown', containFocus, true);
    document.addEventListener('focusin', redirectExternalFocus, true);
    return () => {
      window.removeEventListener('keydown', containFocus, true);
      document.removeEventListener('focusin', redirectExternalFocus, true);
      background.inert = previousInert;
      if (previousInertAttribute === null) background.removeAttribute('inert');
      else background.setAttribute('inert', previousInertAttribute);
      if (previousAriaHidden === null) background.removeAttribute('aria-hidden');
      else background.setAttribute('aria-hidden', previousAriaHidden);
    };
  }, [closeDetail, detailItem]);

  useEffect(() => () => detailController.current?.abort(), []);

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = conflictFindingSearchParamsResult({
      page: '1',
      pageSize: form.pageSize,
      type: form.type || undefined,
      assetId: form.assetId || undefined,
      hostname: form.hostname || undefined,
      ip: form.ip || undefined,
      sourceType: form.sourceType || undefined,
      temporalRelationship: form.temporalRelationship || undefined,
      hasLimitations: form.hasLimitations || undefined,
      sortBy: form.sortBy,
      sortDirection: form.sortDirection,
    });
    const nextQuery = parsed.query;
    setUrlIssues(parsed.issues);
    prepareListUpdate();
    replaceUrl(nextQuery);
    setQuery(nextQuery);
  }

  function clearFilters(): void {
    const cleared = { ...DEFAULT_CONFLICT_FINDING_QUERY };
    setForm(formFromQuery(cleared));
    setUrlIssues([]);
    prepareListUpdate();
    replaceUrl(cleared);
    setQuery(cleared);
  }

  function retryList(): void {
    prepareListUpdate();
    setError(null);
    setRequestVersion((version) => version + 1);
  }

  function changePage(page: number): void {
    if (page < 1 || page === query.page) return;
    const nextQuery = { ...query, page };
    prepareListUpdate();
    replaceUrl(nextQuery);
    setQuery(nextQuery);
  }

  function prepareListUpdate(): void {
    if (hasLoaded.current) setUpdating(true);
    else setInitialLoading(true);
    setError(null);
  }

  const requestDetail = useCallback(
    (item: ConflictFindingListItem): void => {
      const technicalAssetId = item.affectedAssetIds[0];
      if (!technicalAssetId) return;
      detailController.current?.abort();
      const controller = new AbortController();
      detailController.current = controller;
      const sequence = ++detailSequence.current;
      setDetailLoading(true);
      setDetailError(null);
      setDetailStale(false);
      setDetailFinding(null);

      void loadDetail(technicalAssetId, { signal: controller.signal })
        .then((analysis) => {
          if (sequence !== detailSequence.current || controller.signal.aborted) return;
          const finding = analysis.findings.find((candidate) => candidate.findingId === item.findingId);
          if (!finding || !isMatchingDetailedFinding(item, finding)) {
            setDetailStale(true);
            return;
          }
          setDetailFinding(finding);
        })
        .catch((loadError: unknown) => {
          if (sequence !== detailSequence.current || controller.signal.aborted) return;
          setDetailError(
            loadError instanceof Error
              ? loadError.message
              : 'Não foi possível carregar a análise detalhada.',
          );
        })
        .finally(() => {
          if (sequence === detailSequence.current && !controller.signal.aborted) {
            setDetailLoading(false);
          }
        });
    },
    [loadDetail],
  );

  function openDetail(
    item: ConflictFindingListItem,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    detailTrigger.current = event.currentTarget;
    setDetailItem(item);
    requestDetail(item);
  }

  const filtered = hasConflictFindingFilters(query);

  return (
    <main className="page-shell conflict-findings-shell">
      <div ref={pageContent} className="finding-page-content">
      <header className="page-heading conflict-findings-heading">
        <div>
          <p className="eyebrow">Análise derivada e somente leitura</p>
          <h1>Achados de identidade e rede</h1>
          <p className="page-description">
            Situações derivadas do inventário que podem precisar de revisão humana.
          </p>
        </div>
        {result && !initialLoading ? (
          <div className="summary-pill">
            <strong>{result.summary.totalFindings}</strong>
            <span>{result.summary.totalFindings === 1 ? 'achado filtrado' : 'achados filtrados'}</span>
          </div>
        ) : null}
      </header>

      <section className="shadow-mode-notice" aria-label="Aviso sobre o modo sombra">
        <strong>Modo sombra</strong>
        <p>
          Os achados são calculados em modo sombra. Nenhum conflito formal foi criado e nenhuma
          alteração foi aplicada ao inventário.
        </p>
      </section>

      <section className="filter-card" aria-labelledby="finding-filter-title">
        <div className="filter-card-heading">
          <div>
            <p className="section-kicker">Localize situações para revisão</p>
            <h2 id="finding-filter-title">Filtros e ordenação</h2>
          </div>
          <p>Os filtros alteram somente a visualização, nunca a identidade dos achados.</p>
        </div>
        <form className="filter-grid finding-filter-grid" onSubmit={applyFilters}>
          <label>
            Tipo
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
            >
              <option value="">Todos</option>
              {CONFLICT_FINDING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getConflictFindingTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            ID do ativo
            <input
              value={form.assetId}
              onChange={(event) => setForm({ ...form, assetId: event.target.value })}
              placeholder="UUID do ativo"
            />
          </label>
          <label>
            Hostname
            <input
              value={form.hostname}
              onChange={(event) => setForm({ ...form, hostname: event.target.value })}
              placeholder="Ex.: SRV-APP-01"
            />
          </label>
          <label>
            IP
            <input
              value={form.ip}
              onChange={(event) => setForm({ ...form, ip: event.target.value })}
              placeholder="IPv4 ou IPv6"
            />
          </label>
          <label>
            Fonte
            <select
              value={form.sourceType}
              onChange={(event) => setForm({ ...form, sourceType: event.target.value })}
            >
              <option value="">Todas</option>
              {CONFLICT_SOURCE_TYPES.map((source) => (
                <option key={source} value={source}>
                  {getConflictSourceTypeLabel(source)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contexto temporal
            <select
              value={form.temporalRelationship}
              onChange={(event) =>
                setForm({ ...form, temporalRelationship: event.target.value })
              }
            >
              <option value="">Todos</option>
              {CONFLICT_TEMPORAL_RELATIONSHIPS.map((relationship) => (
                <option key={relationship} value={relationship}>
                  {getConflictTemporalRelationshipLabel(relationship)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Limitações
            <select
              value={form.hasLimitations}
              onChange={(event) => setForm({ ...form, hasLimitations: event.target.value })}
            >
              <option value="">Todos</option>
              <option value="true">Com limitações</option>
              <option value="false">Sem limitações</option>
            </select>
          </label>
          <label>
            Ordenar por
            <select
              value={form.sortBy}
              onChange={(event) =>
                setForm({ ...form, sortBy: event.target.value as ConflictFindingSortField })
              }
            >
              {CONFLICT_FINDING_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {sortLabels[field]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Direção
            <select
              value={form.sortDirection}
              onChange={(event) =>
                setForm({
                  ...form,
                  sortDirection: event.target.value as ConflictFindingSortDirection,
                })
              }
            >
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </select>
          </label>
          <label>
            Itens por página
            <select
              value={form.pageSize}
              onChange={(event) => setForm({ ...form, pageSize: event.target.value })}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-actions finding-filter-actions">
            <button className="button button-primary" type="submit">
              Aplicar filtros
            </button>
            <button className="button button-secondary" type="button" onClick={clearFilters}>
              Limpar filtros
            </button>
          </div>
        </form>
        {urlIssues.length > 0 ? (
          <div className="finding-url-issues" role="alert">
            <strong>Revise os filtros informados</strong>
            <ul>
              {urlIssues.map((issue) => (
                <li key={issue.field}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {initialLoading && !result ? <LoadingState label="Carregando achados…" /> : null}
      {!result && !initialLoading && error ? <ErrorState message={error} retry={retryList} /> : null}

      {result ? (
        <>
          {updating ? (
            <p className="finding-update-status" role="status">
              Atualizando achados…
            </p>
          ) : null}
          {error ? (
            <div className="finding-inline-error" role="alert">
              <span>{error}</span>
              <button className="button button-secondary" type="button" onClick={retryList}>
                Tentar novamente
              </button>
            </div>
          ) : null}

          <section className="finding-summary-section" aria-labelledby="finding-summary-title">
            <div className="finding-section-heading">
              <div>
                <p className="section-kicker">Resumo do conjunto filtrado</p>
                <h2 id="finding-summary-title">Visão geral dos achados</h2>
              </div>
              <p>O resumo considera todos os resultados filtrados, não somente a página atual.</p>
            </div>
            <div className="finding-summary-grid">
              <SummaryCard label="Total de achados" value={result.summary.totalFindings} />
              <SummaryCard label="Ativos afetados" value={result.summary.affectedAssets} />
              <SummaryCard
                label="Achados com limitações"
                value={result.summary.findingsWithLimitations}
              />
              {CONFLICT_FINDING_TYPES.map((type) => (
                <SummaryCard
                  key={type}
                  label={getConflictFindingTypeLabel(type)}
                  value={result.summary.byType[type]}
                />
              ))}
            </div>
          </section>

          {result.limitations.length > 0 ? (
            <details className="finding-global-limitations">
              <summary>Limitações conhecidas da análise</summary>
              <ul>
                {result.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {result.items.length === 0 ? (
            <section className="empty-state finding-empty-state">
              <span className="empty-mark">A</span>
              <h2>
                {filtered
                  ? 'Nenhum achado corresponde aos filtros aplicados.'
                  : 'Nenhum achado foi identificado no inventário atual.'}
              </h2>
              <p>
                {filtered
                  ? 'Ajuste ou limpe os filtros para consultar outro recorte.'
                  : 'O Atlas não derivou situações incompatíveis com os dados disponíveis.'}
              </p>
            </section>
          ) : (
            <section className="finding-list" aria-label="Lista de achados de identidade e rede">
              {result.items.map((item) => (
                <FindingCard key={item.findingId} item={item} onOpenDetail={openDetail} />
              ))}
            </section>
          )}

          <nav className="pagination finding-pagination" aria-label="Paginação dos achados">
            <div className="pagination-summary">
              <strong>
                Página {result.pagination.page} de {Math.max(result.pagination.totalPages, 1)}
              </strong>
              <span>
                {result.pagination.totalItems}{' '}
                {result.pagination.totalItems === 1 ? 'resultado' : 'resultados'}
              </span>
            </div>
            <div className="pagination-actions">
              <button
                type="button"
                disabled={!result.pagination.hasPreviousPage || updating}
                onClick={() => changePage(result.pagination.page - 1)}
              >
                <span aria-hidden="true">←</span> Anterior
              </button>
              <button
                type="button"
                disabled={!result.pagination.hasNextPage || updating}
                onClick={() => changePage(result.pagination.page + 1)}
              >
                Próxima <span aria-hidden="true">→</span>
              </button>
            </div>
          </nav>
        </>
      ) : null}
      </div>

      {detailItem ? (
        <DetailPanel
          item={detailItem}
          finding={detailFinding}
          loading={detailLoading}
          error={detailError}
          stale={detailStale}
          closeButtonRef={detailCloseButton}
          panelRef={detailPanel}
          onClose={closeDetail}
          onRetry={() => requestDetail(detailItem)}
        />
      ) : null}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="finding-summary-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function FindingCard({
  item,
  onOpenDetail,
}: {
  item: ConflictFindingListItem;
  onOpenDetail: (
    item: ConflictFindingListItem,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  const titleId = `finding-title-${item.findingId}`;
  return (
    <article className="finding-card" aria-labelledby={titleId}>
      <div className="finding-card-heading">
        <div>
          <span className="finding-review-badge">Requer revisão humana</span>
          <h2 id={titleId}>{getConflictFindingTypeLabel(item.type)}</h2>
          <code className="finding-id">{item.findingId}</code>
        </div>
        <div className="finding-card-count">
          <strong>{item.affectedAssetIds.length}</strong>
          <span>{item.affectedAssetIds.length === 1 ? 'ativo afetado' : 'ativos afetados'}</span>
        </div>
      </div>

      <p className="finding-explanation">{item.explanationSummary}</p>

      <div className="finding-identity-grid">
        {item.normalizedHostname ? (
          <div>
            <span>Hostname relacionado</span>
            <code>{item.normalizedHostname}</code>
          </div>
        ) : null}
        {item.normalizedIp ? (
          <div>
            <span>IP relacionado</span>
            <code>{item.normalizedIp}</code>
          </div>
        ) : null}
      </div>
      {item.normalizedIp ? (
        <p className="finding-ip-notice">
          O compartilhamento do IP não comprova que os registros representam o mesmo ativo.
        </p>
      ) : null}

      <section className="finding-assets" aria-label="Ativos afetados">
        <h3>Ativos envolvidos</h3>
        <div className="finding-asset-links">
          {item.affectedAssets.map((asset) => (
            <Link key={asset.assetId} href={`/assets/${asset.assetId}`}>
              <strong>{asset.persistedName}</strong>
              <span>{asset.assetId}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="finding-context-grid">
        <section>
          <h3>Contexto temporal</h3>
          <strong>{getConflictTemporalRelationshipLabel(item.temporalContext.relationship)}</strong>
          <dl>
            <div>
              <dt>Primeira observação</dt>
              <dd>{formatDateTime(item.temporalContext.firstObservedAt)}</dd>
            </div>
            <div>
              <dt>Última observação</dt>
              <dd>{formatDateTime(item.temporalContext.lastObservedAt)}</dd>
            </div>
            <div>
              <dt>Diferença temporal</dt>
              <dd>{formatTemporalDifference(item.temporalContext.differenceMilliseconds)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Fontes observadas</h3>
          <div className="finding-source-list">
            {item.sourceTypes.map((source) => (
              <span key={source}>{getConflictSourceTypeLabel(source)}</span>
            ))}
          </div>
          <dl className="finding-observation-counts">
            <div>
              <dt>Observações atuais</dt>
              <dd>{item.currentObservationCount}</dd>
            </div>
            <div>
              <dt>Observações históricas</dt>
              <dd>{item.historicalObservationCount}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{item.observationCount}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="finding-review-options">
        <h3>Possibilidades para uma análise futura</h3>
        <ul>
          {item.reviewOptions.map((option) => (
            <li key={option}>{getConflictReviewOptionLabel(option)}</li>
          ))}
        </ul>
      </section>

      <footer className="finding-card-footer">
        <span>
          {item.limitationCount}{' '}
          {item.limitationCount === 1 ? 'limitação específica' : 'limitações específicas'}
        </span>
        <button
          className="button button-secondary"
          type="button"
          aria-label={`Ver análise detalhada de ${item.findingId}`}
          onClick={(event) => onOpenDetail(item, event)}
        >
          Ver análise detalhada
        </button>
      </footer>
    </article>
  );
}

function DetailPanel({
  item,
  finding,
  loading,
  error,
  stale,
  closeButtonRef,
  panelRef,
  onClose,
  onRetry,
}: {
  item: ConflictFindingListItem;
  finding: ConflictFindingDetail | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="finding-detail-backdrop">
      <section
        ref={panelRef}
        className="finding-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finding-detail-title"
        aria-describedby="finding-detail-description"
        tabIndex={-1}
      >
        <header className="finding-detail-heading">
          <div>
            <p className="section-kicker">Análise individual sob demanda</p>
            <h2 id="finding-detail-title">{getConflictFindingTypeLabel(item.type)}</h2>
            <p id="finding-detail-description">
              O ativo usado para recuperar esta análise é apenas uma referência técnica da consulta.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Fechar
          </button>
        </header>

        <code className="finding-id detail-finding-id">{item.findingId}</code>
        <p className="finding-detail-shadow-note">
          Modo sombra: nenhuma decisão foi aplicada e nenhuma opção foi selecionada.
        </p>

        {loading ? <LoadingState label="Carregando análise detalhada…" /> : null}
        {!loading && error ? <ErrorState message={error} retry={onRetry} /> : null}
        {!loading && stale ? (
          <div className="finding-stale-message" role="status">
            Este achado pode ter mudado porque o inventário foi atualizado. Atualize a listagem para
            consultar o estado atual.
          </div>
        ) : null}

        {!loading && !error && !stale && finding ? (
          <div className="finding-detail-content">
            <section>
              <h3>Ativos afetados</h3>
              <div className="finding-asset-links">
                {item.affectedAssets
                  .filter((asset) => finding.affectedAssetIds.includes(asset.assetId))
                  .map((asset) => (
                    <Link key={asset.assetId} href={`/assets/${asset.assetId}`}>
                      <strong>{asset.persistedName}</strong>
                      <span>{asset.assetId}</span>
                    </Link>
                  ))}
              </div>
            </section>

            <section>
              <h3>Contexto temporal</h3>
              <p>{getConflictTemporalRelationshipLabel(finding.temporalContext.relationship)}</p>
              <dl className="finding-detail-dates">
                <div>
                  <dt>Primeira observação</dt>
                  <dd>{formatDateTime(finding.temporalContext.firstObservedAt)}</dd>
                </div>
                <div>
                  <dt>Última observação</dt>
                  <dd>{formatDateTime(finding.temporalContext.lastObservedAt)}</dd>
                </div>
                <div>
                  <dt>Diferença temporal</dt>
                  <dd>{formatTemporalDifference(finding.temporalContext.differenceMilliseconds)}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h3>Observações</h3>
              <div className="finding-observation-list">
                {finding.observations.map((observation, index) => (
                  <article
                    key={`${observation.assetId}-${observation.attribute}-${observation.normalizedValue}-${observation.evidenceId ?? 'sem-evidencia'}-${index}`}
                  >
                    <div className="finding-observation-heading">
                      <strong>
                        {observation.attribute === 'HOSTNAME' ? 'Hostname' : 'Endereço IP'}
                      </strong>
                      <span>{observation.current ? 'Observação atual' : 'Observação histórica'}</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Valor original</dt>
                        <dd>{observation.value}</dd>
                      </div>
                      <div>
                        <dt>Valor normalizado</dt>
                        <dd>{observation.normalizedValue}</dd>
                      </div>
                      <div>
                        <dt>Fonte</dt>
                        <dd>
                          {observation.source} · {getConflictSourceTypeLabel(observation.sourceType)}
                        </dd>
                      </div>
                      <div>
                        <dt>Evidência relacionada</dt>
                        <dd>{observation.evidenceId ?? 'Não vinculada'}</dd>
                      </div>
                      <div>
                        <dt>Observada em</dt>
                        <dd>{formatDateTime(observation.observedAt)}</dd>
                      </div>
                      <div>
                        <dt>Ingerida em</dt>
                        <dd>{formatDateTime(observation.ingestedAt)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>

            <section className="finding-detail-columns">
              <div>
                <h3>Explicações</h3>
                <ul>
                  {finding.explanation.map((explanation) => (
                    <li key={explanation}>{explanation}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Limitações específicas</h3>
                <ul>
                  {finding.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="finding-review-options">
              <h3>Possibilidades para uma análise futura</h3>
              <ul>
                {finding.reviewOptions.map((option) => (
                  <li key={option}>{getConflictReviewOptionLabel(option)}</li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function detailedFindingMatchesListItem(
  item: ConflictFindingListItem,
  finding: ConflictFindingDetail,
): boolean {
  return (
    isMatchingDetailedFinding(item, finding) &&
    sameAssetSet(item.affectedAssetIds, finding.affectedAssetIds)
  );
}
