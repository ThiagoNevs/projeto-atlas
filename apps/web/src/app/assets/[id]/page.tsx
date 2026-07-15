'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdministrativeStatusForm } from '@/components/administrative-status-form';
import { EvidenceProvenanceSection } from '@/components/evidence-provenance-section';
import { LifecycleConflictAlert } from '@/components/lifecycle-conflict-alert';
import { ManualEnrichmentForm } from '@/components/manual-enrichment-form';
import { ErrorState, LoadingState } from '@/components/page-state';
import { RelativeTime } from '@/components/relative-time';
import { Score } from '@/components/score';
import { StatusBadge } from '@/components/status-badge';
import {
  AssetDetail,
  AssetEvidence,
  AssetTimelineEvent,
  getAsset,
  getAssetEvidences,
  getAssetTimeline,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  getAssetTypeLabel,
  getAttributeLabel,
  getEventLabel,
  getEvidenceTypeLabel,
} from '@/lib/labels';
import { getStatusLabel } from '@/lib/status';

type AssetPageData = {
  asset: AssetDetail;
  evidences: AssetEvidence[];
  timeline: AssetTimelineEvent[];
};

type AdministrativeStatusChangeData = {
  previousStatus: string;
  newStatus: string;
  reason: string;
  comment: string;
};

type ManualDeclarationData = {
  reason: string;
  actorUserId?: string;
};

function getManualDeclarationData(value: unknown): ManualDeclarationData | null {
  if (!value || typeof value !== 'object') return null;
  const eventData = value as Record<string, unknown>;
  if (typeof eventData.reason !== 'string') return null;
  return {
    reason: eventData.reason,
    actorUserId: typeof eventData.actorUserId === 'string' ? eventData.actorUserId : undefined,
  };
}

function getAdministrativeStatusChangeData(value: unknown): AdministrativeStatusChangeData | null {
  if (!value || typeof value !== 'object') return null;

  const data = value as Record<string, unknown>;
  if (
    typeof data.previousStatus !== 'string' ||
    typeof data.newStatus !== 'string' ||
    typeof data.reason !== 'string' ||
    typeof data.comment !== 'string'
  ) {
    return null;
  }

  return {
    previousStatus: data.previousStatus,
    newStatus: data.newStatus,
    reason: data.reason,
    comment: data.comment,
  };
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AssetPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [provenanceVersion, setProvenanceVersion] = useState(0);

  function retry(): void {
    setLoading(true);
    setError(null);
    setRequestVersion((version) => version + 1);
  }

  async function refreshAssetData(): Promise<void> {
    const [asset, evidences, timeline] = await Promise.all([
      getAsset(id),
      getAssetEvidences(id),
      getAssetTimeline(id),
    ]);
    setData({ asset, evidences, timeline });
    setProvenanceVersion((version) => version + 1);
  }

  useEffect(() => {
    let active = true;

    void Promise.all([getAsset(id), getAssetEvidences(id), getAssetTimeline(id)])
      .then(([asset, evidences, timeline]) => {
        if (active) setData({ asset, evidences, timeline });
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
  }, [id, requestVersion]);

  if (loading) {
    return (
      <main className="page-shell">
        <LoadingState label="Montando visão do ativo…" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="page-shell">
        <Link className="back-link" href="/assets">
          ← Voltar para ativos
        </Link>
        <ErrorState message={error ?? 'O ativo não retornou dados.'} retry={retry} />
      </main>
    );
  }

  const { asset, evidences, timeline } = data;
  const lifecycleConflict = asset.conflicts.find(
    (conflict) => conflict.conflictType === 'LIFECYCLE_CONFLICT' && conflict.status === 'OPEN',
  );
  const manualDeclarationEvent = timeline.find(
    (event) => event.eventType === 'ASSET_MANUALLY_DECLARED',
  );
  const manualDeclaration = manualDeclarationEvent
    ? getManualDeclarationData(manualDeclarationEvent.data)
    : null;

  return (
    <main className="page-shell detail-page">
      <Link className="back-link" href="/assets">
        ← Voltar para ativos
      </Link>

      <header className="asset-hero">
        <div>
          <div className="hero-meta">
            <span className="type-chip">{getAssetTypeLabel(asset.type)}</span>
            <span>{asset.canonicalKey}</span>
          </div>
          <h1>{asset.name}</h1>
          <p>
            Última evidência em {formatDateTime(asset.lastSeenAt)} ·{' '}
            <RelativeTime value={asset.lastSeenAt} />
          </p>
        </div>
        <div className="hero-statuses">
          <StatusBadge status={asset.operationalStatus} />
          <StatusBadge status={asset.administrativeStatus} />
        </div>
      </header>

      {lifecycleConflict ? (
        <LifecycleConflictAlert
          administrativeStatus={asset.administrativeStatus}
          conflict={lifecycleConflict}
        />
      ) : null}

      {manualDeclarationEvent ? (
        <aside className="manual-declaration-alert">
          <div>
            <strong>Ativo declarado manualmente</strong>
            <p>
              Este ativo foi declarado manualmente e ainda pode não possuir confirmação por fonte
              técnica.
            </p>
          </div>
          <dl>
            <div>
              <dt>Motivo</dt>
              <dd>{manualDeclaration?.reason ?? 'Não informado'}</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>{formatDateTime(manualDeclarationEvent.occurredAt)}</dd>
            </div>
            <div>
              <dt>Declarado por</dt>
              <dd>{manualDeclaration?.actorUserId ?? 'Usuário do MVP'}</dd>
            </div>
          </dl>
        </aside>
      ) : null}

      <section className="detail-grid overview-grid" aria-label="Visão geral">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Identificação</h2>
            </div>
          </div>
          <dl className="definition-list">
            <div>
              <dt>ID Atlas</dt>
              <dd className="atlas-id-value">{asset.atlasId}</dd>
            </div>
            <div>
              <dt>Hostname atual</dt>
              <dd>{asset.name}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>{getAssetTypeLabel(asset.type)}</dd>
            </div>
            <div>
              <dt>Primeira observação</dt>
              <dd>{formatDateTime(asset.firstSeenAt)}</dd>
            </div>
            <div>
              <dt>UUID interno</dt>
              <dd className="mono-value">{asset.id}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Estado atual</h2>
            </div>
          </div>
          <div className="status-detail-list">
            <div>
              <span>Operacional</span>
              <StatusBadge status={asset.operationalStatus} showDescription />
            </div>
            <div>
              <span>Administrativo</span>
              <StatusBadge status={asset.administrativeStatus} showDescription />
            </div>
            <div>
              <span>Atualizado em</span>
              <strong>
                {formatDateTime(asset.updatedAt)} · <RelativeTime value={asset.updatedAt} />
              </strong>
            </div>
          </div>
        </article>

        <article className="panel scores-panel">
          <div className="panel-heading">
            <div>
              <h2>Avaliação</h2>
            </div>
          </div>
          <div className="scores-grid">
            <Score label="Confiança" value={asset.confidenceScore} />
            <Score label="Qualidade dos dados" value={asset.dataQualityScore} />
          </div>
        </article>
      </section>

      <AdministrativeStatusForm
        assetId={asset.id}
        currentStatus={asset.administrativeStatus}
        onChanged={refreshAssetData}
      />

      <ManualEnrichmentForm
        assetId={asset.id}
        existingAttributeKeys={asset.attributes.map((attribute) => attribute.key)}
        onChanged={refreshAssetData}
      />

      <section className="panel full-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Inventário normalizado</p>
            <h2>Atributos</h2>
          </div>
          <span className="count-badge">{asset.attributes.length}</span>
        </div>
        {asset.attributes.length ? (
          <div className="attributes-grid">
            {asset.attributes.map((attribute) => (
              <div className="attribute-card" key={attribute.id}>
                <span>{getAttributeLabel(attribute.key)}</span>
                <strong>{attribute.valueText ?? JSON.stringify(attribute.value)}</strong>
                <small>
                  Confirmado {attribute.confirmationCount}× ·{' '}
                  {formatDateTime(attribute.lastConfirmedAt)}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-copy">Nenhum atributo normalizado disponível.</p>
        )}
      </section>

      <EvidenceProvenanceSection assetId={asset.id} refreshKey={provenanceVersion} />

      <section className="panel full-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Conectividade observada</p>
            <h2>Interfaces de rede</h2>
          </div>
          <span className="count-badge">{asset.networkInterfaces.length}</span>
        </div>
        {asset.networkInterfaces.length ? (
          <div className="network-list">
            {asset.networkInterfaces.map((networkInterface) => (
              <div className="network-row" key={networkInterface.id}>
                <div>
                  <strong>{networkInterface.name}</strong>
                  <span>{networkInterface.macAddress ?? 'MAC não informado'}</span>
                </div>
                <div className="ip-list">
                  {networkInterface.ipAddresses.map((ipAddress) => (
                    <code key={ipAddress}>{ipAddress}</code>
                  ))}
                </div>
                <span className={networkInterface.isCurrent ? 'current-label' : 'historic-label'}>
                  {networkInterface.isCurrent ? 'Atual' : 'Histórica'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-copy">Nenhuma interface observada.</p>
        )}
      </section>

      <div className="detail-columns">
        <section className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Rastreabilidade</p>
              <h2>Evidências</h2>
            </div>
            <span className="count-badge">{evidences.length}</span>
          </div>
          <div className="evidence-list">
            {evidences.map((evidence) => (
              <details className="evidence-item" key={evidence.id}>
                <summary>
                  <span className="evidence-source">{evidence.source}</span>
                  <span>{getEvidenceTypeLabel(evidence.evidenceType)}</span>
                  <time>{formatDateTime(evidence.observedAt)}</time>
                </summary>
                <div className="evidence-body">
                  <div className="mini-scores">
                    <span>Confiança: {evidence.confidenceScore ?? '—'}</span>
                    <span>Qualidade: {evidence.dataQualityScore ?? '—'}</span>
                  </div>
                  <pre>{JSON.stringify(evidence.payload, null, 2)}</pre>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Histórico</p>
              <h2>Timeline</h2>
            </div>
            <span className="count-badge">{timeline.length}</span>
          </div>
          <ol className="timeline-list">
            {timeline.map((event) => {
              const statusChange =
                event.eventType === 'ADMIN_STATUS_CHANGED'
                  ? getAdministrativeStatusChangeData(event.data)
                  : null;

              return (
                <li key={event.id}>
                  <span className={`timeline-dot event-${event.eventType.toLowerCase()}`} />
                  <div>
                    <div className="timeline-title">
                      <strong>{getEventLabel(event.eventType)}</strong>
                      <time>{formatDateTime(event.occurredAt)}</time>
                    </div>
                    {statusChange ? (
                      <dl className="timeline-change-details">
                        <div>
                          <dt>Status anterior</dt>
                          <dd>{getStatusLabel(statusChange.previousStatus)}</dd>
                        </div>
                        <div>
                          <dt>Novo status</dt>
                          <dd>{getStatusLabel(statusChange.newStatus)}</dd>
                        </div>
                        <div>
                          <dt>Motivo</dt>
                          <dd>{statusChange.reason}</dd>
                        </div>
                        <div>
                          <dt>Comentário</dt>
                          <dd>{statusChange.comment}</dd>
                        </div>
                      </dl>
                    ) : event.description ? (
                      <p>{event.description}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </main>
  );
}
