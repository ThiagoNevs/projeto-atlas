'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { ConflictStatusForm } from '@/components/conflict-status-form';
import { Pagination } from '@/components/pagination';
import { ErrorState, LoadingState } from '@/components/page-state';
import { RelativeTime } from '@/components/relative-time';
import {
  ConflictQueryParams,
  ConflictStatus,
  ConflictSummary,
  getConflicts,
  PaginatedResponse,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  getAttributeLabel,
  getConflictStatusLabel,
  getConflictTypeLabel,
  getImpactLabel,
} from '@/lib/labels';

const conflictStatuses: ConflictStatus[] = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED',
  'IGNORED',
  'EXCEPTION',
];
const impacts = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const conflictTypes = ['LIFECYCLE_CONFLICT', 'ATTRIBUTE_CONFLICT', 'NETWORK_IDENTITY_CONFLICT'];

type FilterForm = {
  search: string;
  status: string;
  impact: string;
  type: string;
  sortBy: NonNullable<ConflictQueryParams['sortBy']>;
  sortDirection: NonNullable<ConflictQueryParams['sortDirection']>;
};

const initialForm: FilterForm = {
  search: '',
  status: '',
  impact: '',
  type: '',
  sortBy: 'updatedAt',
  sortDirection: 'desc',
};
const initialQuery: ConflictQueryParams = {
  page: 1,
  pageSize: 10,
  sortBy: 'updatedAt',
  sortDirection: 'desc',
};

export default function ConflictsPage() {
  const [form, setForm] = useState<FilterForm>(initialForm);
  const [query, setQuery] = useState<ConflictQueryParams>(initialQuery);
  const [result, setResult] = useState<PaginatedResponse<ConflictSummary>>({
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

  function loadQuery(nextQuery: ConflictQueryParams): void {
    setLoading(true);
    setError(null);
    setQuery(nextQuery);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    loadQuery({
      search: form.search.trim() || undefined,
      status: (form.status || undefined) as ConflictStatus | undefined,
      impact: form.impact || undefined,
      type: form.type || undefined,
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

  async function refreshConflicts(): Promise<void> {
    const loadedResult = await getConflicts(query);
    setResult(loadedResult);
  }

  useEffect(() => {
    let active = true;

    void getConflicts(query)
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
          <p className="eyebrow">Resolution Center</p>
          <h1>Conflitos</h1>
          <p className="page-description">
            Central de análise e tratamento das divergências identificadas pelo Atlas.
          </p>
        </div>
        {!loading && !error ? (
          <div className="summary-pill">
            <strong>{result.total}</strong>
            <span>{result.total === 1 ? 'conflito encontrado' : 'conflitos encontrados'}</span>
          </div>
        ) : null}
      </header>

      <section className="filter-card" aria-labelledby="conflicts-filter-title">
        <div className="filter-card-heading">
          <div>
            <p className="section-kicker">Priorize a análise</p>
            <h2 id="conflicts-filter-title">Filtros e busca</h2>
          </div>
          <p>Encontre conflitos por ativo, criticidade, estado ou tipo.</p>
        </div>
        <form className="filter-grid conflicts-filter-grid" onSubmit={applyFilters}>
          <label className="filter-search filter-field-wide">
            Buscar
            <input
              value={form.search}
              onChange={(event) => setForm({ ...form, search: event.target.value })}
              placeholder="Ativo, tipo, campo ou sugestão"
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="">Todos</option>
              {conflictStatuses.map((status) => (
                <option key={status} value={status}>
                  {getConflictStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Impacto
            <select
              value={form.impact}
              onChange={(event) => setForm({ ...form, impact: event.target.value })}
            >
              <option value="">Todos</option>
              {impacts.map((impact) => (
                <option key={impact} value={impact}>
                  {getImpactLabel(impact)}
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
              {conflictTypes.map((type) => (
                <option key={type} value={type}>
                  {getConflictTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ordenar por
            <select
              value={form.sortBy}
              onChange={(event) =>
                setForm({ ...form, sortBy: event.target.value as FilterForm['sortBy'] })
              }
            >
              <option value="updatedAt">Última atualização</option>
              <option value="createdAt">Criação</option>
              <option value="occurrenceCount">Ocorrências</option>
              <option value="impact">Impacto</option>
              <option value="status">Status</option>
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

      {loading ? <LoadingState label="Carregando conflitos…" /> : null}
      {!loading && error ? <ErrorState message={error} retry={retry} /> : null}

      {!loading && !error && result.items.length === 0 ? (
        <section className="empty-state">
          <span className="empty-mark">C</span>
          <h2>Nenhum conflito encontrado</h2>
          <p>Ajuste os filtros ou aguarde uma nova detecção automática.</p>
        </section>
      ) : null}

      {!loading && !error && result.items.length > 0 ? (
        <>
          <section className="table-panel refined-table-panel" aria-label="Lista de conflitos">
            <div className="table-scroll">
              <table className="assets-table conflicts-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Impacto</th>
                    <th>Status</th>
                    <th>Ativo</th>
                    <th className="number-column">Ocorrências</th>
                    <th>Sugestão</th>
                    <th>Última atualização</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((conflict) => (
                    <tr id={`conflict-${conflict.id}`} key={conflict.id}>
                      <td>
                        <strong>{getConflictTypeLabel(conflict.type)}</strong>
                        <span className="cell-subtitle">
                          Campo: {getAttributeLabel(conflict.field)}
                        </span>
                      </td>
                      <td>
                        <span className="conflict-chip impact-chip">
                          {getImpactLabel(conflict.impact)}
                        </span>
                      </td>
                      <td>
                        <span className="conflict-chip">
                          {getConflictStatusLabel(conflict.status)}
                        </span>
                      </td>
                      <td>
                        <Link className="asset-name" href={`/assets/${conflict.assetId}`}>
                          {conflict.assetName}
                        </Link>
                      </td>
                      <td className="number-column">{conflict.occurrenceCount}</td>
                      <td className="suggestion-cell">
                        {conflict.suggestionReason ?? 'Sem sugestão disponível'}
                      </td>
                      <td>
                        <time dateTime={conflict.updatedAt}>
                          {formatDateTime(conflict.updatedAt)}
                        </time>
                        <RelativeTime className="cell-subtitle" value={conflict.updatedAt} />
                      </td>
                      <td>
                        <details className="conflict-treatment">
                          <summary>Tratar</summary>
                          <div className="conflict-treatment-body">
                            <ConflictStatusForm
                              administrativeStatus={conflict.administrativeStatus}
                              conflictId={conflict.id}
                              conflictType={conflict.type}
                              currentStatus={conflict.status}
                              onChanged={refreshConflicts}
                            />
                          </div>
                        </details>
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
