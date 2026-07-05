'use client';

import { FormEvent, useEffect, useState } from 'react';

import { Pagination } from '@/components/pagination';
import { ErrorState, LoadingState } from '@/components/page-state';
import { AuditLogQueryParams, AuditLogRecord, AuditLogResponse, getAuditLogs } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  getAttributeLabel,
  getAuditActionLabel,
  getAuditActorTypeLabel,
  getAuditEntityTypeLabel,
  getAuditValueLabel,
} from '@/lib/labels';

const actions = [
  'ADMIN_STATUS_CHANGED',
  'CONFLICT_STATUS_CHANGED',
  'NETWORK_DISCOVERY_RUN_EXECUTED',
  'NETWORK_DISCOVERY_RUN_REJECTED',
  'NETWORK_DISCOVERY_RUN_FAILED',
];
const entityTypes = ['Asset', 'Conflict', 'NetworkDiscoveryRun', 'NetworkDiscoveryProfile'];
const actorTypes = ['USER', 'SYSTEM', 'SERVICE'];

type FilterForm = {
  search: string;
  action: string;
  entityType: string;
  actorType: string;
  dateFrom: string;
  dateTo: string;
  sortBy: NonNullable<AuditLogQueryParams['sortBy']>;
  sortDirection: NonNullable<AuditLogQueryParams['sortDirection']>;
};

const initialForm: FilterForm = {
  search: '',
  action: '',
  entityType: '',
  actorType: '',
  dateFrom: '',
  dateTo: '',
  sortBy: 'occurredAt',
  sortDirection: 'desc',
};
const initialQuery: AuditLogQueryParams = {
  page: 1,
  pageSize: 20,
  sortBy: 'occurredAt',
  sortDirection: 'desc',
};
const initialResult: AuditLogResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 0,
  summary: {
    total: 0,
    administrativeChanges: 0,
    conflictTreatments: 0,
    discoveryExecutions: 0,
    failuresOrRejections: 0,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactValue(value: unknown): string {
  if (!isRecord(value)) return 'Não informado';
  const entries = Object.entries(value);
  if (entries.length === 0) return 'Não informado';

  return entries
    .slice(0, 2)
    .map(([key, entry]) => {
      const shownValue = typeof entry === 'string' ? getAuditValueLabel(entry) : String(entry);
      return `${getAttributeLabel(key)}: ${shownValue}`;
    })
    .join(' · ');
}

function metadataText(metadata: unknown): string {
  if (!isRecord(metadata)) return 'Não informado';
  const reason = typeof metadata.reason === 'string' ? metadata.reason : null;
  const comment = typeof metadata.comment === 'string' ? metadata.comment : null;
  return [reason, comment].filter(Boolean).join(' · ') || 'Não informado';
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <strong>{label}</strong>
      <pre>{value === null ? 'Não informado' : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default function AuditPage() {
  const [form, setForm] = useState<FilterForm>(initialForm);
  const [query, setQuery] = useState<AuditLogQueryParams>(initialQuery);
  const [result, setResult] = useState<AuditLogResponse>(initialResult);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  function loadQuery(nextQuery: AuditLogQueryParams): void {
    setLoading(true);
    setError(null);
    setQuery(nextQuery);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    loadQuery({
      search: form.search.trim() || undefined,
      action: form.action || undefined,
      entityType: form.entityType || undefined,
      actorType: form.actorType || undefined,
      dateFrom: form.dateFrom ? `${form.dateFrom}T00:00:00.000-03:00` : undefined,
      dateTo: form.dateTo ? `${form.dateTo}T23:59:59.999-03:00` : undefined,
      page: 1,
      pageSize: 20,
      sortBy: form.sortBy,
      sortDirection: form.sortDirection,
    });
  }

  function clearFilters(): void {
    setForm(initialForm);
    loadQuery(initialQuery);
  }

  function retry(): void {
    setLoading(true);
    setError(null);
    setRequestVersion((version) => version + 1);
  }

  useEffect(() => {
    let active = true;
    getAuditLogs(query)
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

  const cards = [
    ['Total de eventos', result.summary.total],
    ['Alterações administrativas', result.summary.administrativeChanges],
    ['Tratamentos de conflito', result.summary.conflictTreatments],
    ['Execuções de descoberta', result.summary.discoveryExecutions],
    ['Falhas ou rejeições', result.summary.failuresOrRejections],
  ] as const;

  return (
    <main className="page-shell audit-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Governança e rastreabilidade</p>
          <h1>Auditoria</h1>
          <p className="page-description">
            Ações administrativas e operacionais registradas no Atlas.
          </p>
        </div>
      </header>

      <section className="audit-summary-grid" aria-label="Resumo da auditoria">
        {cards.map(([label, value]) => (
          <article className="metric-card metric-accent" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="filter-card" aria-labelledby="audit-filter-title">
        <div className="filter-card-heading">
          <div>
            <p className="section-kicker">Rastreie decisões</p>
            <h2 id="audit-filter-title">Filtros e busca</h2>
          </div>
          <p>Consulte registros por ação, origem, entidade ou período.</p>
        </div>
        <form className="filter-grid audit-filter-grid" onSubmit={applyFilters}>
          <label className="filter-search filter-field-wide">
            Buscar
            <input
              value={form.search}
              onChange={(event) => setForm({ ...form, search: event.target.value })}
              placeholder="Ação, ator, entidade, motivo ou comentário"
            />
          </label>
          <label>
            Ação
            <select
              value={form.action}
              onChange={(event) => setForm({ ...form, action: event.target.value })}
            >
              <option value="">Todas</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {getAuditActionLabel(action)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de entidade
            <select
              value={form.entityType}
              onChange={(event) => setForm({ ...form, entityType: event.target.value })}
            >
              <option value="">Todos</option>
              {entityTypes.map((type) => (
                <option key={type} value={type}>
                  {getAuditEntityTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de ator
            <select
              value={form.actorType}
              onChange={(event) => setForm({ ...form, actorType: event.target.value })}
            >
              <option value="">Todos</option>
              {actorTypes.map((type) => (
                <option key={type} value={type}>
                  {getAuditActorTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data inicial
            <input
              type="date"
              value={form.dateFrom}
              onChange={(event) => setForm({ ...form, dateFrom: event.target.value })}
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              value={form.dateTo}
              onChange={(event) => setForm({ ...form, dateTo: event.target.value })}
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
              <option value="occurredAt">Data/hora</option>
              <option value="action">Ação</option>
              <option value="entityType">Entidade</option>
              <option value="actorType">Ator</option>
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
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
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

      {loading ? <LoadingState label="Carregando auditoria…" /> : null}
      {!loading && error ? <ErrorState message={error} retry={retry} /> : null}
      {!loading && !error && result.items.length === 0 ? (
        <section className="empty-state">
          <span className="empty-mark">A</span>
          <h2>Nenhum registro de auditoria encontrado</h2>
          <p>Ajuste os filtros ou execute uma ação auditável no Atlas.</p>
        </section>
      ) : null}

      {!loading && !error && result.items.length > 0 ? (
        <>
          <section className="table-panel refined-table-panel" aria-label="Registros de auditoria">
            <div className="table-scroll">
              <table className="assets-table audit-table">
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Ação</th>
                    <th>Ator</th>
                    <th>Entidade</th>
                    <th>Valor anterior</th>
                    <th>Valor novo</th>
                    <th>Motivo/comentário</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((log: AuditLogRecord) => (
                    <tr key={log.id}>
                      <td>
                        <time dateTime={log.occurredAt}>{formatDateTime(log.occurredAt)}</time>
                      </td>
                      <td>
                        <strong>{getAuditActionLabel(log.action)}</strong>
                      </td>
                      <td>
                        {getAuditActorTypeLabel(log.actorType)}
                        <span className="cell-subtitle">
                          {log.actorId ?? 'Origem não informada'}
                        </span>
                      </td>
                      <td>
                        {getAuditEntityTypeLabel(log.entityType)}
                        <span className="cell-subtitle audit-entity-id">{log.entityId}</span>
                      </td>
                      <td className="audit-value-cell">{compactValue(log.before)}</td>
                      <td className="audit-value-cell">{compactValue(log.after)}</td>
                      <td className="audit-metadata-cell">{metadataText(log.metadata)}</td>
                      <td>
                        <details className="audit-details">
                          <summary>Ver detalhes</summary>
                          <div className="audit-details-panel">
                            <p>
                              <strong>Identificador:</strong> {log.id}
                            </p>
                            <p>
                              <strong>Data:</strong> {formatDateTime(log.occurredAt)}
                            </p>
                            <div className="audit-json-grid">
                              <JsonDetails label="Valor anterior" value={log.before} />
                              <JsonDetails label="Valor novo" value={log.after} />
                              <JsonDetails label="Metadados" value={log.metadata} />
                            </div>
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
