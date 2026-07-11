'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { Pagination } from '@/components/pagination';
import { ErrorState, LoadingState } from '@/components/page-state';
import { RelativeTime } from '@/components/relative-time';
import { StatusBadge } from '@/components/status-badge';
import {
  AdministrativeStatus,
  AssetQueryParams,
  AssetSummary,
  getAssets,
  OperationalStatus,
  PaginatedResponse,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { getAssetTypeLabel } from '@/lib/labels';
import { getStatusLabel } from '@/lib/status';

const operationalStatuses: OperationalStatus[] = [
  'UNKNOWN',
  'SEEN_RECENTLY',
  'OPERATIONAL',
  'DEGRADED',
  'UNAVAILABLE',
];
const administrativeStatuses: AdministrativeStatus[] = [
  'IN_USE',
  'IN_STOCK',
  'MAINTENANCE',
  'DEACTIVATED',
  'DISCARDED',
  'LOST',
  'STOLEN',
  'ARCHIVED',
];
const assetTypes = [
  'SERVER',
  'NOTEBOOK',
  'DESKTOP',
  'WORKSTATION',
  'VM',
  'NETWORK_DEVICE',
  'PRINTER',
  'STORAGE',
  'UNKNOWN',
];

type FilterForm = {
  search: string;
  operationalStatus: string;
  administrativeStatus: string;
  type: string;
  minConfidenceScore: string;
  minDataQualityScore: string;
  sortBy: NonNullable<AssetQueryParams['sortBy']>;
  sortDirection: NonNullable<AssetQueryParams['sortDirection']>;
};

const initialForm: FilterForm = {
  search: '',
  operationalStatus: '',
  administrativeStatus: '',
  type: '',
  minConfidenceScore: '',
  minDataQualityScore: '',
  sortBy: 'lastSeenAt',
  sortDirection: 'desc',
};

const initialQuery: AssetQueryParams = {
  page: 1,
  pageSize: 10,
  sortBy: 'lastSeenAt',
  sortDirection: 'desc',
};

export default function AssetsPage() {
  const [form, setForm] = useState<FilterForm>(initialForm);
  const [query, setQuery] = useState<AssetQueryParams>(initialQuery);
  const [result, setResult] = useState<PaginatedResponse<AssetSummary>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  function retry(): void {
    setLoading(true);
    setError(null);
    setRequestVersion((version) => version + 1);
  }

  function loadQuery(nextQuery: AssetQueryParams): void {
    setLoading(true);
    setError(null);
    setQuery(nextQuery);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    loadQuery({
      search: form.search.trim() || undefined,
      operationalStatus: (form.operationalStatus || undefined) as OperationalStatus | undefined,
      administrativeStatus: (form.administrativeStatus || undefined) as
        AdministrativeStatus | undefined,
      type: form.type || undefined,
      minConfidenceScore: form.minConfidenceScore ? Number(form.minConfidenceScore) : undefined,
      minDataQualityScore: form.minDataQualityScore ? Number(form.minDataQualityScore) : undefined,
      page: 1,
      pageSize: 10,
      sortBy: form.sortBy,
      sortDirection: form.sortDirection,
    });
  }

  function clearFilters(): void {
    setForm(initialForm);
    loadQuery(initialQuery);
  }

  useEffect(() => {
    let active = true;

    void getAssets(query)
      .then((loadedResult) => {
        if (active) setResult(loadedResult);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : 'Erro inesperado ao acessar a API.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query, requestVersion]);

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Inventário baseado em evidências</p>
          <h1>Ativos</h1>
          <p className="page-description">
            Visão consolidada dos ativos observados e da qualidade das informações disponíveis.
          </p>
        </div>
        <div className="page-heading-actions">
          <Link className="button button-secondary" href="/assets/import">
            Importar CSV
          </Link>
          <Link className="button button-primary" href="/assets/new">
            Adicionar ativo
          </Link>
          {!loading && !error ? (
            <div className="summary-pill">
              <strong>{result.total}</strong>
              <span>{result.total === 1 ? 'ativo encontrado' : 'ativos encontrados'}</span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="filter-card" aria-labelledby="assets-filter-title">
        <div className="filter-card-heading">
          <div>
            <p className="section-kicker">Refine o inventário</p>
            <h2 id="assets-filter-title">Filtros e busca</h2>
          </div>
          <p>Combine critérios para localizar rapidamente os ativos relevantes.</p>
        </div>
        <form className="filter-grid assets-filter-grid" onSubmit={applyFilters}>
          <label className="filter-search filter-field-wide">
            Buscar
            <input
              value={form.search}
              onChange={(event) => setForm({ ...form, search: event.target.value })}
              placeholder="Hostname, série, fabricante, IP ou MAC"
            />
          </label>
          <label>
            Status operacional
            <select
              value={form.operationalStatus}
              onChange={(event) => setForm({ ...form, operationalStatus: event.target.value })}
            >
              <option value="">Todos</option>
              {operationalStatuses.map((status) => (
                <option key={status} value={status}>
                  {getStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status administrativo
            <select
              value={form.administrativeStatus}
              onChange={(event) => setForm({ ...form, administrativeStatus: event.target.value })}
            >
              <option value="">Todos</option>
              {administrativeStatuses.map((status) => (
                <option key={status} value={status}>
                  {getStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
            >
              <option value="">Todos</option>
              {assetTypes.map((type) => (
                <option key={type} value={type}>
                  {getAssetTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Confiança mínima
            <input
              type="number"
              min="0"
              max="100"
              value={form.minConfidenceScore}
              onChange={(event) => setForm({ ...form, minConfidenceScore: event.target.value })}
              placeholder="0 a 100"
            />
          </label>
          <label>
            Qualidade mínima
            <input
              type="number"
              min="0"
              max="100"
              value={form.minDataQualityScore}
              onChange={(event) => setForm({ ...form, minDataQualityScore: event.target.value })}
              placeholder="0 a 100"
            />
          </label>
          <label>
            Ordenar por
            <select
              value={form.sortBy}
              onChange={(event) =>
                setForm({ ...form, sortBy: event.target.value as FilterForm['sortBy'] })
              }
            >
              <option value="name">Hostname</option>
              <option value="lastSeenAt">Última evidência</option>
              <option value="confidenceScore">Confiança</option>
              <option value="dataQualityScore">Qualidade</option>
              <option value="evidenceCount">Evidências</option>
              <option value="eventCount">Eventos</option>
            </select>
          </label>
          <label>
            Direção
            <select
              value={form.sortDirection}
              onChange={(event) =>
                setForm({
                  ...form,
                  sortDirection: event.target.value as FilterForm['sortDirection'],
                })
              }
            >
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </select>
          </label>
          <div className="filter-actions">
            <button className="button button-primary" type="submit">
              Aplicar filtros
            </button>
            <button className="button button-secondary" type="button" onClick={clearFilters}>
              Limpar filtros
            </button>
          </div>
        </form>
      </section>

      {loading ? <LoadingState label="Carregando inventário…" /> : null}
      {!loading && error ? <ErrorState message={error} retry={retry} /> : null}

      {!loading && !error && result.items.length === 0 ? (
        <section className="empty-state">
          <span className="empty-mark">A</span>
          <h2>Nenhum ativo encontrado</h2>
          <p>Ajuste os filtros ou faça uma nova ingestão para ampliar o inventário.</p>
        </section>
      ) : null}

      {!loading && !error && result.items.length > 0 ? (
        <>
          <section className="table-panel refined-table-panel" aria-label="Lista de ativos">
            <div className="table-scroll">
              <table className="assets-table assets-inventory-table">
                <thead>
                  <tr>
                    <th>Hostname atual</th>
                    <th>Tipo</th>
                    <th>Operacional</th>
                    <th>Administrativo</th>
                    <th>Última evidência</th>
                    <th className="number-column">Confiança</th>
                    <th className="number-column">Qualidade</th>
                    <th className="number-column">Evidências</th>
                    <th className="number-column">Eventos</th>
                    <th className="row-action-heading" aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((asset) => (
                    <tr key={asset.id}>
                      <td className="asset-identity-cell">
                        <Link
                          className="asset-name"
                          href={`/assets/${asset.id}`}
                          title={asset.name}
                        >
                          {asset.name}
                        </Link>
                        <span
                          className="cell-subtitle canonical-key"
                          title={asset.canonicalKey ?? undefined}
                        >
                          {asset.atlasId} · {asset.canonicalKey ?? 'sem chave canônica'}
                        </span>
                      </td>
                      <td>
                        <span className="type-chip">{getAssetTypeLabel(asset.type)}</span>
                      </td>
                      <td>
                        <StatusBadge status={asset.operationalStatus} />
                      </td>
                      <td>
                        <StatusBadge status={asset.administrativeStatus} />
                      </td>
                      <td>
                        <time dateTime={asset.lastSeenAt ?? undefined}>
                          {formatDateTime(asset.lastSeenAt)}
                        </time>
                        <RelativeTime className="cell-subtitle" value={asset.lastSeenAt} />
                      </td>
                      <td className="number-column score-number">
                        {asset.confidenceScore === null ? '—' : Math.round(asset.confidenceScore)}
                      </td>
                      <td className="number-column score-number">
                        {asset.dataQualityScore === null ? '—' : Math.round(asset.dataQualityScore)}
                      </td>
                      <td className="number-column">{asset.evidenceCount}</td>
                      <td className="number-column">{asset.eventCount}</td>
                      <td className="row-action-cell">
                        <Link
                          className="row-action"
                          href={`/assets/${asset.id}`}
                          aria-label={`Abrir ${asset.name}`}
                        >
                          <span>Detalhes</span>
                          <span aria-hidden="true">→</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <Pagination
            page={result.page}
            total={result.total}
            totalPages={result.totalPages}
            onPageChange={(page) => loadQuery({ ...query, page })}
          />
        </>
      ) : null}
    </main>
  );
}
