'use client';

import { ATLAS_PERMISSIONS } from '@atlas/shared';
import { useCallback, useEffect, useState } from 'react';

import { ErrorState, LoadingState } from '@/components/page-state';
import { PermissionBoundary } from '@/components/permission-boundary';
import { DataSourceItem, DataSourceStatus, getDataSources } from '@/lib/api';

const statusLabels: Record<DataSourceStatus, string> = {
  AVAILABLE: 'Disponível',
  PLANNED: 'Planejado',
  FUTURE: 'Futuro',
};

const statusDescriptions: Record<DataSourceStatus, string> = {
  AVAILABLE: 'Já pode gerar evidências no MVP.',
  PLANNED: 'Planejado para evolução controlada do produto.',
  FUTURE: 'Possibilidade futura, ainda fora do escopo atual.',
};

function statusClass(status: DataSourceStatus): string {
  if (status === 'AVAILABLE') return 'available';
  if (status === 'PLANNED') return 'planned';
  return 'future';
}

function DataSourceCard({ source }: { source: DataSourceItem }) {
  return (
    <article className="data-source-card">
      <div className="data-source-card-heading">
        <div>
          <span className="data-source-category">{source.category}</span>
          <h2>{source.name}</h2>
        </div>
        <span className={`data-source-status status-${statusClass(source.status)}`}>
          {statusLabels[source.status]}
        </span>
      </div>
      <p>{source.description}</p>
      <div className="data-source-meta">
        <span>{statusDescriptions[source.status]}</span>
        {source.current ? (
          <strong>Fonte ativa no MVP</strong>
        ) : (
          <strong>Sem integração real</strong>
        )}
      </div>
    </article>
  );
}

function DataSourcesPageContent() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getDataSources>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDataSources = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setData(await getDataSources());
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

    getDataSources()
      .then((result) => {
        if (active) setData(result);
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

  if (loading) {
    return (
      <main className="page-shell">
        <LoadingState label="Carregando fontes de dados…" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-shell">
        <ErrorState message={error} retry={loadDataSources} />
      </main>
    );
  }

  if (!data) return null;

  const summaryCards = [
    { label: 'Fontes disponíveis', value: data.summary.available, tone: 'positive' },
    { label: 'Fontes planejadas', value: data.summary.planned, tone: 'warning' },
    { label: 'Fontes futuras', value: data.summary.future, tone: 'neutral' },
    { label: 'Total de fontes', value: data.summary.total, tone: 'accent' },
  ];

  return (
    <main className="page-shell data-sources-shell">
      <section className="page-heading data-sources-hero">
        <p className="eyebrow">Conectores e origens</p>
        <h1>Fontes de Dados</h1>
        <p className="page-description">
          Acompanhe as origens que alimentam o Atlas com evidências sobre os ativos.
        </p>
        <p className="data-sources-lede">
          O Atlas pode começar com cadastro manual e descoberta controlada, e evoluir com conectores
          para ferramentas já utilizadas pela empresa.
        </p>
      </section>

      <section className="metric-grid data-sources-summary" aria-label="Resumo das fontes de dados">
        {summaryCards.map((card) => (
          <article className={`metric-card metric-${card.tone}`} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="data-sources-grid" aria-label="Catálogo de fontes de dados">
        {data.items.map((source) => (
          <DataSourceCard key={source.id} source={source} />
        ))}
      </section>

      <section className="dashboard-panel data-sources-explainer">
        <p className="section-kicker">Modelo evidence-first</p>
        <h2>Como o Atlas usa fontes de dados</h2>
        <p>
          Cada fonte gera evidências. O Atlas consolida essas evidências, preserva histórico,
          calcula qualidade e confiança, identifica conflitos e apoia decisões.
        </p>
        <p>
          Nesta etapa, conectores planejados são apenas catálogo de produto: nenhuma API externa é
          chamada, nenhum token é armazenado e nenhuma autenticação de conector foi implementada.
        </p>
      </section>
    </main>
  );
}

export default function DataSourcesPage() {
  return (
    <PermissionBoundary permission={ATLAS_PERMISSIONS.inventoryRead}>
      <DataSourcesPageContent />
    </PermissionBoundary>
  );
}
