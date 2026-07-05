'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { Pagination } from '@/components/pagination';
import { ErrorState, LoadingState } from '@/components/page-state';
import { RelativeTime } from '@/components/relative-time';
import {
  AdministrativeStatus,
  DataQualityAsset,
  DataQualityIssue,
  DataQualityQueryParams,
  DataQualitySummary,
  getDataQualityAssets,
  getDataQualitySummary,
  OperationalStatus,
  PaginatedResponse,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { getAssetTypeLabel, getDataQualityIssueLabel } from '@/lib/labels';
import { getStatusLabel } from '@/lib/status';

const issues: DataQualityIssue[] = [
  'LOW_DATA_QUALITY',
  'LOW_CONFIDENCE',
  'MISSING_SERIAL_NUMBER',
  'MISSING_MANUFACTURER',
  'MISSING_MODEL',
  'MISSING_OPERATING_SYSTEM',
  'MISSING_NETWORK_INFO',
  'MISSING_ADMINISTRATIVE_STATUS',
  'WITHOUT_RECENT_EVIDENCE',
];
const assetTypes = [
  'SERVER',
  'NOTEBOOK',
  'DESKTOP',
  'WORKSTATION',
  'VM',
  'NETWORK_DEVICE',
  'STORAGE',
  'PRINTER',
  'UNKNOWN',
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
const operationalStatuses: OperationalStatus[] = [
  'UNKNOWN',
  'SEEN_RECENTLY',
  'OPERATIONAL',
  'DEGRADED',
  'UNAVAILABLE',
];

type FilterForm = {
  search: string;
  issue: string;
  type: string;
  administrativeStatus: string;
  operationalStatus: string;
  minDataQualityScore: string;
  maxDataQualityScore: string;
  minConfidenceScore: string;
  maxConfidenceScore: string;
  sortBy: NonNullable<DataQualityQueryParams['sortBy']>;
  sortDirection: NonNullable<DataQualityQueryParams['sortDirection']>;
};

const initialForm: FilterForm = {
  search: '',
  issue: '',
  type: '',
  administrativeStatus: '',
  operationalStatus: '',
  minDataQualityScore: '',
  maxDataQualityScore: '',
  minConfidenceScore: '',
  maxConfidenceScore: '',
  sortBy: 'dataQualityScore',
  sortDirection: 'asc',
};
const initialQuery: DataQualityQueryParams = {
  page: 1,
  pageSize: 20,
  sortBy: 'dataQualityScore',
  sortDirection: 'asc',
};
const emptySummary: DataQualitySummary = {
  totalAssets: 0,
  lowDataQuality: 0,
  lowConfidence: 0,
  missingSerialNumber: 0,
  missingManufacturer: 0,
  missingModel: 0,
  missingOperatingSystem: 0,
  missingNetworkInfo: 0,
  missingAdministrativeStatus: 0,
  assetsWithoutRecentEvidence: 0,
  averageDataQualityScore: 0,
  averageConfidenceScore: 0,
};
const emptyResult: PaginatedResponse<DataQualityAsset> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 0,
};

function optionalNumber(value: string): number | undefined {
  return value === '' ? undefined : Number(value);
}

function score(value: number | null): string {
  return value === null ? 'Não informado' : String(Math.round(value));
}

export default function DataQualityPage() {
  const [form, setForm] = useState<FilterForm>(initialForm);
  const [query, setQuery] = useState<DataQualityQueryParams>(initialQuery);
  const [summary, setSummary] = useState<DataQualitySummary>(emptySummary);
  const [result, setResult] = useState<PaginatedResponse<DataQualityAsset>>(emptyResult);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  function loadQuery(nextQuery: DataQualityQueryParams): void {
    setLoading(true);
    setError(null);
    setQuery(nextQuery);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    loadQuery({
      search: form.search.trim() || undefined,
      issue: (form.issue || undefined) as DataQualityIssue | undefined,
      type: form.type || undefined,
      administrativeStatus: (form.administrativeStatus || undefined) as
        AdministrativeStatus | undefined,
      operationalStatus: (form.operationalStatus || undefined) as OperationalStatus | undefined,
      minDataQualityScore: optionalNumber(form.minDataQualityScore),
      maxDataQualityScore: optionalNumber(form.maxDataQualityScore),
      minConfidenceScore: optionalNumber(form.minConfidenceScore),
      maxConfidenceScore: optionalNumber(form.maxConfidenceScore),
      page: 1,
      pageSize: 20,
      sortBy: form.sortBy,
      sortDirection: form.sortDirection,
    });
  }

  function chooseIssue(issue: DataQualityIssue): void {
    setForm({ ...initialForm, issue });
    loadQuery({ ...initialQuery, issue });
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
    Promise.all([getDataQualitySummary(), getDataQualityAssets(query)])
      .then(([loadedSummary, loadedResult]) => {
        if (active) {
          setSummary(loadedSummary);
          setResult(loadedResult);
        }
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
    ['Total de ativos', summary.totalAssets],
    ['Baixa qualidade', summary.lowDataQuality],
    ['Baixa confiabilidade', summary.lowConfidence],
    ['Sem número de série', summary.missingSerialNumber],
    ['Sem fabricante', summary.missingManufacturer],
    ['Sem modelo', summary.missingModel],
    ['Sem sistema operacional', summary.missingOperatingSystem],
    ['Sem rede identificada', summary.missingNetworkInfo],
    ['Sem evidência recente', summary.assetsWithoutRecentEvidence],
  ] as const;
  const priorities: Array<[DataQualityIssue, number]> = [
    ['MISSING_OPERATING_SYSTEM', summary.missingOperatingSystem],
    ['MISSING_SERIAL_NUMBER', summary.missingSerialNumber],
    ['LOW_CONFIDENCE', summary.lowConfidence],
    ['WITHOUT_RECENT_EVIDENCE', summary.assetsWithoutRecentEvidence],
  ];

  return (
    <main className="page-shell data-quality-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Governança do inventário</p>
          <h1>Qualidade dos dados</h1>
          <p className="page-description">
            Identifique ativos incompletos, inconsistentes ou com baixa confiabilidade.
          </p>
        </div>
        <div className="quality-averages">
          <span>
            Qualidade média <strong>{Math.round(summary.averageDataQualityScore)}</strong>
          </span>
          <span>
            Confiança média <strong>{Math.round(summary.averageConfidenceScore)}</strong>
          </span>
        </div>
      </header>

      <section className="quality-summary-grid" aria-label="Resumo de qualidade">
        {cards.map(([label, value]) => (
          <article className="metric-card metric-accent" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="quality-priorities" aria-labelledby="quality-priorities-title">
        <div>
          <p className="section-kicker">Correções prioritárias</p>
          <h2 id="quality-priorities-title">Por onde começar</h2>
        </div>
        <div className="quality-priority-list">
          {priorities.map(([issue, count]) => (
            <button type="button" key={issue} onClick={() => chooseIssue(issue)}>
              <strong>{count}</strong>
              <span>Revisar: {getDataQualityIssueLabel(issue).toLocaleLowerCase('pt-BR')}</span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <section className="filter-card" aria-labelledby="quality-filter-title">
        <div className="filter-card-heading">
          <div>
            <p className="section-kicker">Encontre lacunas</p>
            <h2 id="quality-filter-title">Filtros e busca</h2>
          </div>
          <p>Combine problemas, estados e scores para ordenar a correção do inventário.</p>
        </div>
        <form className="filter-grid quality-filter-grid" onSubmit={applyFilters}>
          <label className="filter-search filter-field-wide">
            Buscar
            <input
              value={form.search}
              onChange={(event) => setForm({ ...form, search: event.target.value })}
              placeholder="Ativo, fabricante, modelo, sistema, IP ou MAC"
            />
          </label>
          <label>
            Tipo de problema
            <select
              value={form.issue}
              onChange={(event) => setForm({ ...form, issue: event.target.value })}
            >
              <option value="">Todos</option>
              {issues.map((issue) => (
                <option key={issue} value={issue}>
                  {getDataQualityIssueLabel(issue)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de ativo
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
            Qualidade mínima
            <input
              type="number"
              min="0"
              max="100"
              value={form.minDataQualityScore}
              onChange={(event) => setForm({ ...form, minDataQualityScore: event.target.value })}
            />
          </label>
          <label>
            Qualidade máxima
            <input
              type="number"
              min="0"
              max="100"
              value={form.maxDataQualityScore}
              onChange={(event) => setForm({ ...form, maxDataQualityScore: event.target.value })}
            />
          </label>
          <label>
            Confiança mínima
            <input
              type="number"
              min="0"
              max="100"
              value={form.minConfidenceScore}
              onChange={(event) => setForm({ ...form, minConfidenceScore: event.target.value })}
            />
          </label>
          <label>
            Confiança máxima
            <input
              type="number"
              min="0"
              max="100"
              value={form.maxConfidenceScore}
              onChange={(event) => setForm({ ...form, maxConfidenceScore: event.target.value })}
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
              <option value="dataQualityScore">Qualidade</option>
              <option value="confidenceScore">Confiabilidade</option>
              <option value="lastSeenAt">Última evidência</option>
              <option value="name">Ativo</option>
              <option value="type">Tipo</option>
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

      {loading ? <LoadingState label="Carregando qualidade dos dados…" /> : null}
      {!loading && error ? <ErrorState message={error} retry={retry} /> : null}
      {!loading && !error && result.items.length === 0 ? (
        <section className="empty-state">
          <span className="empty-mark">Q</span>
          <h2>Nenhum problema de qualidade encontrado</h2>
          <p>Os ativos atendem aos critérios selecionados ou os filtros podem ser ampliados.</p>
        </section>
      ) : null}

      {!loading && !error && result.items.length > 0 ? (
        <>
          <section
            className="table-panel refined-table-panel"
            aria-label="Ativos com problemas de qualidade"
          >
            <div className="table-scroll">
              <table className="assets-table quality-table">
                <thead>
                  <tr>
                    <th>Ativo</th>
                    <th>Tipo</th>
                    <th>Sistema operacional</th>
                    <th>Qualidade</th>
                    <th>Confiabilidade</th>
                    <th>Última evidência</th>
                    <th>Problemas</th>
                    <th>Campos ausentes</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <Link className="asset-name" href={`/assets/${asset.id}`}>
                          {asset.hostname}
                        </Link>
                        <span className="cell-subtitle">
                          {asset.manufacturer ?? 'Fabricante não informado'} ·{' '}
                          {asset.model ?? 'Modelo não informado'}
                        </span>
                      </td>
                      <td>
                        <span className="type-chip">{getAssetTypeLabel(asset.type)}</span>
                      </td>
                      <td>{asset.operatingSystem ?? 'Não identificado'}</td>
                      <td className="number-column score-number">
                        {score(asset.dataQualityScore)}
                      </td>
                      <td className="number-column score-number">{score(asset.confidenceScore)}</td>
                      <td>
                        <time dateTime={asset.lastSeenAt ?? undefined}>
                          {formatDateTime(asset.lastSeenAt)}
                        </time>
                        <RelativeTime className="cell-subtitle" value={asset.lastSeenAt} />
                      </td>
                      <td>
                        <div className="quality-issue-list">
                          {asset.issues.map((issue) => (
                            <span key={issue}>{getDataQualityIssueLabel(issue)}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {asset.missingFields.length
                          ? asset.missingFields.join(', ')
                          : 'Nenhum campo essencial ausente'}
                      </td>
                      <td>
                        <Link className="row-action" href={`/assets/${asset.id}`}>
                          <span>Ver ativo</span>
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
