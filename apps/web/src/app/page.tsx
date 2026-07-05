'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ErrorState, LoadingState } from '../components/page-state';
import { RelativeTime } from '../components/relative-time';
import { formatDateTime } from '../lib/format';
import { getAssetTypeLabel, getDiscoveryRunStatusLabel, getEventLabel } from '../lib/labels';
import { getDashboardSummary, type DashboardSummary } from '../lib/api';
import { getStatusLabel } from '../lib/status';

type DistributionProps = {
  title: string;
  entries: Record<string, number>;
  labelFor: (value: string) => string;
  total: number;
  emptyMessage?: string;
};

function Distribution({
  title,
  entries,
  labelFor,
  total,
  emptyMessage = 'Nenhum dado disponível.',
}: DistributionProps) {
  const rows = Object.entries(entries).sort((left, right) => right[1] - left[1]);

  return (
    <article className="dashboard-panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="dashboard-empty-copy">{emptyMessage}</p>
      ) : (
        <ul className="distribution-list">
          {rows.map(([key, count]) => (
            <li key={key}>
              <div className="distribution-label">
                <span>{labelFor(key)}</span>
                <strong>{count}</strong>
              </div>
              <span className="distribution-track" aria-hidden="true">
                <span style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function Home() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSummary(await getDashboardSummary());
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Falha inesperada ao carregar.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    getDashboardSummary()
      .then((result) => {
        if (active) setSummary(result);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error ? requestError.message : 'Falha inesperada ao carregar.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading)
    return (
      <main className="page-shell">
        <LoadingState label="Carregando visão geral…" />
      </main>
    );
  if (error)
    return (
      <main className="page-shell">
        <ErrorState message={error} retry={loadSummary} />
      </main>
    );
  if (!summary) return null;

  const lastDiscovery = summary.networkDiscovery;
  const metrics = [
    { label: 'Total de ativos', value: summary.assets.total, tone: 'accent' },
    { label: 'Vistos recentemente', value: summary.assets.seenRecently, tone: 'positive' },
    {
      label: 'Baixa qualidade',
      value: summary.assets.lowDataQuality,
      tone: 'warning',
      href: '/data-quality',
    },
    {
      label: 'Baixa confiança',
      value: summary.assets.lowConfidence,
      tone: 'warning',
      href: '/data-quality',
    },
    {
      label: 'Administrativamente encerrados',
      value: summary.assets.administrativelyClosed,
      tone: 'neutral',
    },
    { label: 'Conflitos abertos', value: summary.conflicts.totalOpen, tone: 'negative' },
    { label: 'Conflitos de alto impacto', value: summary.conflicts.highImpact, tone: 'negative' },
  ];

  return (
    <main className="page-shell dashboard-shell">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Visão operacional</p>
          <h1>Inteligência de ativos em um só lugar.</h1>
          <p>
            Indicadores do inventário, riscos que pedem atenção e atividade recente baseada em
            evidências.
          </p>
        </div>
        <nav className="dashboard-shortcuts" aria-label="Atalhos do dashboard">
          <Link className="button button-primary" href="/assets">
            Ver ativos
          </Link>
          <Link className="button button-secondary" href="/conflicts">
            Tratar conflitos
          </Link>
          <Link className="button button-secondary" href="/network-discovery">
            Descoberta simulada
          </Link>
        </nav>
      </section>

      {summary.assets.total === 0 && (
        <div className="dashboard-notice">
          O inventário ainda está vazio. Execute o seed demo ou faça a primeira ingestão para
          preencher os indicadores.
        </div>
      )}

      <section className="metric-grid" aria-label="Indicadores principais">
        {metrics.map((metric) =>
          metric.href ? (
            <Link
              className={`metric-card metric-${metric.tone} metric-card-link`}
              href={metric.href}
              key={metric.label}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </Link>
          ) : (
            <article className={`metric-card metric-${metric.tone}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ),
        )}
        <article className="metric-card metric-accent">
          <span>Última descoberta</span>
          <strong className="metric-status">
            {lastDiscovery.lastRunStatus
              ? getDiscoveryRunStatusLabel(lastDiscovery.lastRunStatus)
              : 'Ainda não executada'}
          </strong>
          <small>
            {lastDiscovery.lastRunAt
              ? formatDateTime(lastDiscovery.lastRunAt)
              : `${lastDiscovery.totalRuns} execução(ões)`}
          </small>
        </article>
      </section>

      <section className="dashboard-section" aria-labelledby="inventory-health-title">
        <div className="dashboard-section-heading">
          <div>
            <p className="section-kicker">Panorama</p>
            <h2 id="inventory-health-title">Saúde do inventário</h2>
          </div>
          <Link href="/assets">Explorar inventário →</Link>
        </div>
        <div className="inventory-health-grid">
          <Distribution
            title="Estado administrativo"
            entries={summary.assets.byAdministrativeStatus}
            labelFor={getStatusLabel}
            total={summary.assets.total}
          />
          <Distribution
            title="Estado operacional"
            entries={summary.assets.byOperationalStatus}
            labelFor={getStatusLabel}
            total={summary.assets.total}
          />
          <Distribution
            title="Tipos de ativo"
            entries={summary.assets.byType}
            labelFor={getAssetTypeLabel}
            total={summary.assets.total}
          />
          <Distribution
            title="Sistemas operacionais"
            entries={summary.assets.byOperatingSystem}
            labelFor={(value) => value}
            total={summary.assets.total}
            emptyMessage="Nenhum sistema operacional identificado."
          />
          <Distribution
            title="Versões de sistema operacional"
            entries={summary.assets.byOperatingSystemVersion}
            labelFor={(value) => value}
            total={summary.assets.total}
            emptyMessage="Nenhum sistema operacional identificado."
          />
        </div>
      </section>

      <div className="dashboard-lower-grid">
        <section className="dashboard-section" aria-labelledby="activity-title">
          <div className="dashboard-section-heading">
            <div>
              <p className="section-kicker">Rastreabilidade</p>
              <h2 id="activity-title">Atividade recente</h2>
            </div>
          </div>
          <div className="dashboard-panel">
            {summary.recentActivity.length === 0 ? (
              <p className="dashboard-empty-copy">Nenhum evento registrado até o momento.</p>
            ) : (
              <ul className="activity-list">
                {summary.recentActivity.map((event) => (
                  <li key={event.id}>
                    <Link href={`/assets/${event.assetId}`}>
                      <span className="activity-marker" aria-hidden="true" />
                      <span>
                        <strong>{getEventLabel(event.eventType)}</strong>
                        <small>
                          {event.assetName} · {event.title}
                        </small>
                      </span>
                      <time dateTime={event.occurredAt}>
                        {formatDateTime(event.occurredAt)}
                        <RelativeTime value={event.occurredAt} />
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="dashboard-section" aria-labelledby="actions-title">
          <div className="dashboard-section-heading">
            <div>
              <p className="section-kicker">Próximos passos</p>
              <h2 id="actions-title">Ações recomendadas</h2>
            </div>
          </div>
          <div className="recommended-list">
            {summary.recommendedActions.map((action) => (
              <Link className="recommended-card" href={action.href} key={action.id}>
                <span>{action.count !== null ? action.count : '→'}</span>
                <div>
                  <strong>{action.title}</strong>
                  <p>{action.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
