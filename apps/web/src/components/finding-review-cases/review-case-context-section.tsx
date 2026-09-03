'use client';

import Link from 'next/link.js';

import type { FindingReviewCaseDetail } from '../../lib/api';
import {
  CONTEXT_COMPARISON_PRESENTATION,
  getFindingReviewContextReasonLabel,
  parseFindingReviewSnapshot,
  type FindingReviewContextDiff,
  type FindingReviewMaterialObservation,
  type FindingReviewSetDiff,
  type FindingReviewSnapshot,
} from '../../lib/finding-review-case-context-comparison';
import {
  getConflictFindingTypeLabel,
  getConflictReviewOptionLabel,
  getConflictSourceTypeLabel,
  getConflictTemporalRelationshipLabel,
} from '../../lib/conflict-findings';
import { formatDateTime } from '../../lib/format';
import {
  useReviewCaseContextComparison,
  type BoundContextComparisonResult,
  type ReviewCaseContextComparisonLoader,
} from './use-review-case-context-comparison';

interface Props {
  detail: FindingReviewCaseDetail;
  loadComparison: ReviewCaseContextComparisonLoader;
  mutationBlocked: boolean;
  reloadDetail: () => void;
}

const REDUNDANT_REASONS = new Set([
  'POLICY_VERSION_CHANGED',
  'FINDING_NO_LONGER_DETECTED',
  'ASSET_UNAVAILABLE',
  'COMPARISON_AMBIGUOUS',
  'SNAPSHOT_VERSION_UNSUPPORTED',
]);

export function ReviewCaseContextSection({
  detail,
  loadComparison,
  mutationBlocked,
  reloadDetail,
}: Props) {
  return (
    <BoundReviewCaseContextSection
      key={`${detail.id}:${detail.version}:${mutationBlocked ? 'blocked' : 'ready'}`}
      detail={detail}
      loadComparison={loadComparison}
      mutationBlocked={mutationBlocked}
      reloadDetail={reloadDetail}
    />
  );
}

function BoundReviewCaseContextSection({
  detail,
  loadComparison,
  mutationBlocked,
  reloadDetail,
}: Props) {
  const originalSnapshot = parseFindingReviewSnapshot(detail.originalSnapshot);
  const controller = useReviewCaseContextComparison({
    caseId: detail.id,
    caseVersion: detail.version,
    findingId: detail.findingId,
    policyVersion: detail.policyVersion,
    snapshotHash: detail.originalSnapshotHash,
    mutationBlocked,
    loadComparison,
  });
  const { state, result, loading } = controller;
  const comparison = result?.response ?? null;
  const buttonLabel = loading
    ? 'Verificando...'
    : comparison
      ? 'Verificar novamente'
      : state.phase === 'error'
        ? 'Tentar novamente'
        : 'Verificar contexto atual';

  return (
    <section
      className="review-context-section"
      aria-labelledby="review-case-context-title"
      aria-busy={loading}
    >
      <div className="review-context-heading">
        <div>
          <p className="section-kicker">Base para a análise humana</p>
          <h3 id="review-case-context-title">Contexto da investigação</h3>
          <p>
            O contexto original permanece preservado. A verificação atual é temporária e não
            atualiza este caso.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={loading || mutationBlocked}
          onClick={() => void controller.verify()}
        >
          {buttonLabel}
        </button>
      </div>

      <article className="review-context-card">
        <h4>Contexto no início da investigação</h4>
        {originalSnapshot ? (
          <SnapshotContent snapshot={originalSnapshot} />
        ) : (
          <p>O contexto histórico está disponível apenas nos detalhes técnicos ao final do caso.</p>
        )}
      </article>

      <HistoricalAssets detail={detail} />

      {mutationBlocked ? (
        <p className="review-context-note">
          Conclua ou recarregue a operação em andamento antes de verificar o contexto.
        </p>
      ) : null}

      {state.phase === 'loading' && state.previous ? (
        <p className="review-context-note" role="status">
          Nova verificação em andamento. O resultado abaixo foi obtido em{' '}
          {formatDateTime(state.previous.response.comparedAt)}.
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <div className="form-message form-message-error review-context-error" role="alert">
          <span>{state.message}</span>
          {state.previous ? (
            <small>
              A nova verificação falhou. O resultado abaixo continua sendo o obtido em{' '}
              {formatDateTime(state.previous.response.comparedAt)}.
            </small>
          ) : null}
          {state.category === 'not-found' || state.category === 'stale' ? (
            <button className="button button-secondary" type="button" onClick={reloadDetail}>
              Recarregar detalhe
            </button>
          ) : null}
        </div>
      ) : null}

      {comparison ? <ComparisonResult result={result!} /> : null}
    </section>
  );
}

function HistoricalAssets({ detail }: { detail: FindingReviewCaseDetail }) {
  return (
    <article className="review-context-card">
      <h4>Ativos históricos e vínculos atuais</h4>
      <div className="review-context-assets">
        {detail.assets.map((asset) => (
          <div className="review-asset-record" key={asset.assetIdAtCreation}>
            <strong>{asset.assetNameAtCreation}</strong>
            <small>Na criação: {asset.assetIdAtCreation}</small>
            <span>{asset.role}</span>
            {asset.currentAssetAvailable && asset.currentAssetId ? (
              <Link href={`/assets/${encodeURIComponent(asset.currentAssetId)}`}>
                Ver vínculo atual: {asset.currentAssetName}
              </Link>
            ) : (
              <em>Ativo atual não disponível. O vínculo histórico foi preservado.</em>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function ComparisonResult({ result }: { result: BoundContextComparisonResult }) {
  const response = result.response;
  const presentation = CONTEXT_COMPARISON_PRESENTATION[response.result.staleness];
  const visibleReasons = response.result.reasons.filter((reason) => !REDUNDANT_REASONS.has(reason));
  const hasDiff = Object.keys(response.result.diff).length > 0;

  return (
    <div className={`review-context-result review-context-result-${presentation.priority}`}>
      <div
        className="review-context-result-heading"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <h4>{presentation.headline}</h4>
        <p>{presentation.supportingCopy}</p>
        <small>Comparado em {formatDateTime(response.comparedAt)}</small>
      </div>

      {visibleReasons.length > 0 ? (
        <ul className="review-context-reasons">
          {visibleReasons.map((reason) => (
            <li key={reason}>{getFindingReviewContextReasonLabel(reason)}</li>
          ))}
        </ul>
      ) : null}

      {hasDiff ? (
        <details className="review-context-details">
          <summary>Ver alterações</summary>
          <ContextDiff diff={response.result.diff} />
        </details>
      ) : null}

      {response.current ? (
        <details className="review-context-details">
          <summary>Contexto atual</summary>
          <p className="review-context-note">
            Esta visualização é temporária e não substitui o contexto original.
          </p>
          <SnapshotContent snapshot={response.current.snapshot} />
        </details>
      ) : null}

      <details className="review-context-details">
        <summary>Detalhes técnicos da comparação</summary>
        <dl className="review-context-technical">
          <div>
            <dt>Estado técnico</dt>
            <dd>{response.result.staleness}</dd>
          </div>
          <div>
            <dt>Versão do caso</dt>
            <dd>{response.caseVersion}</dd>
          </div>
          <div>
            <dt>Finding original</dt>
            <dd>{response.baseline.findingId}</dd>
          </div>
          <div>
            <dt>Política original</dt>
            <dd>{response.baseline.policyVersion}</dd>
          </div>
          <div>
            <dt>Hash original</dt>
            <dd>
              <code>{response.baseline.snapshotHash}</code>
            </dd>
          </div>
          {response.current ? (
            <>
              <div>
                <dt>Finding atual</dt>
                <dd>{response.current.findingId}</dd>
              </div>
              <div>
                <dt>Política atual</dt>
                <dd>{response.current.policyVersion}</dd>
              </div>
              <div>
                <dt>Hash atual</dt>
                <dd>
                  <code>{response.current.snapshotHash}</code>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        <p className="review-context-technical-reasons">
          Razões técnicas:{' '}
          {response.result.reasons.length > 0 ? response.result.reasons.join(', ') : 'nenhuma'}
        </p>
      </details>
    </div>
  );
}

function SnapshotContent({ snapshot }: { snapshot: FindingReviewSnapshot }) {
  const evidenceCount = new Set(
    snapshot.observations.flatMap((observation) =>
      observation.evidenceId ? [observation.evidenceId] : [],
    ),
  ).size;
  return (
    <div className="review-context-snapshot">
      <dl className="review-context-summary">
        <div>
          <dt>Tipo</dt>
          <dd>{getConflictFindingTypeLabel(snapshot.findingType)}</dd>
        </div>
        <div>
          <dt>Gerado em</dt>
          <dd>{formatDateTime(snapshot.generatedAt)}</dd>
        </div>
        <div>
          <dt>Ativos envolvidos</dt>
          <dd>{snapshot.affectedAssets.length}</dd>
        </div>
        <div>
          <dt>Observações</dt>
          <dd>{snapshot.observations.length}</dd>
        </div>
        <div>
          <dt>Evidências</dt>
          <dd>{evidenceCount}</dd>
        </div>
        <div>
          <dt>Fontes</dt>
          <dd>{snapshot.sources.length}</dd>
        </div>
        {snapshot.normalizedHostname !== null ? (
          <div>
            <dt>Hostname normalizado</dt>
            <dd>{snapshot.normalizedHostname}</dd>
          </div>
        ) : null}
        {snapshot.normalizedIp !== null ? (
          <div>
            <dt>IP normalizado</dt>
            <dd>{snapshot.normalizedIp}</dd>
          </div>
        ) : null}
      </dl>

      <details className="review-context-details">
        <summary>Ver ativos do snapshot</summary>
        {snapshot.affectedAssets.length > 0 ? (
          <ul className="review-context-observations">
            {snapshot.affectedAssets.map((asset) => (
              <li key={asset.assetId}>
                <strong>{asset.name ?? 'Nome não disponível'}</strong>
                <span>{asset.assetId}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nenhum ativo foi registrado neste snapshot.</p>
        )}
      </details>

      <details className="review-context-details">
        <summary>Ver observações e proveniência</summary>
        {snapshot.observations.length > 0 ? (
          <ol className="review-context-observations">
            {snapshot.observations.map((observation, index) => (
              <li
                key={`${observation.assetId}:${observation.attribute}:${observation.source}:${index}`}
              >
                <strong>
                  {observation.attribute === 'HOSTNAME' ? 'Hostname' : 'Endereço IP'}:{' '}
                  {observation.normalizedValue}
                </strong>
                <span>Ativo: {observation.assetId}</span>
                <span>
                  Fonte: {observation.source} · {getConflictSourceTypeLabel(observation.sourceType)}
                </span>
                <span>Evidência: {observation.evidenceId ?? 'Não informada'}</span>
                <span>Observado em: {formatDateTime(observation.observedAt)}</span>
                <span>Ingerido em: {formatDateTime(observation.ingestedAt)}</span>
                <span>{observation.current ? 'Observação atual' : 'Observação histórica'}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>Nenhuma observação foi registrada neste snapshot.</p>
        )}
      </details>

      <details className="review-context-details">
        <summary>Ver contexto complementar</summary>
        <dl className="review-context-technical">
          <div>
            <dt>Período observado</dt>
            <dd>{formatTemporalContext(snapshot.temporalContext)}</dd>
          </div>
          <div>
            <dt>Fontes</dt>
            <dd>
              {snapshot.sources.length > 0
                ? snapshot.sources
                    .map(
                      (source) =>
                        `${source.identifier} (${getConflictSourceTypeLabel(source.type)})`,
                    )
                    .join(', ')
                : 'Nenhuma'}
            </dd>
          </div>
          <div>
            <dt>Limitações</dt>
            <dd>
              {snapshot.limitations.length > 0 ? snapshot.limitations.join(' · ') : 'Nenhuma'}
            </dd>
          </div>
          <div>
            <dt>Opções de revisão</dt>
            <dd>
              {snapshot.reviewOptions.length > 0
                ? snapshot.reviewOptions.map(getConflictReviewOptionLabel).join(' · ')
                : 'Nenhuma'}
            </dd>
          </div>
          <div>
            <dt>Política</dt>
            <dd>{snapshot.policyVersion}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

function ContextDiff({ diff }: { diff: FindingReviewContextDiff }) {
  return (
    <div className="review-context-diff">
      {diff.affectedAssets ? (
        <SetDiffGroup title="Ativos envolvidos" diff={diff.affectedAssets} render={String} />
      ) : null}
      {diff.normalizedHostname ? (
        <ValueDiffGroup
          title="Hostname normalizado"
          before={diff.normalizedHostname.before}
          after={diff.normalizedHostname.after}
        />
      ) : null}
      {diff.normalizedIp ? (
        <ValueDiffGroup
          title="IP normalizado"
          before={diff.normalizedIp.before}
          after={diff.normalizedIp.after}
        />
      ) : null}
      {diff.observations ? <ObservationDiffGroup diff={diff.observations} /> : null}
      {diff.evidenceIds ? (
        <SetDiffGroup title="Evidências" diff={diff.evidenceIds} render={String} />
      ) : null}
      {diff.sources ? (
        <SetDiffGroup
          title="Fontes"
          diff={diff.sources}
          render={(source) => `${source.identifier} (${getConflictSourceTypeLabel(source.type)})`}
        />
      ) : null}
      {diff.temporalContext ? (
        <ValueDiffGroup
          title="Período observado"
          before={formatTemporalContext(diff.temporalContext.before)}
          after={formatTemporalContext(diff.temporalContext.after)}
        />
      ) : null}
      {diff.limitations ? (
        <SetDiffGroup title="Limitações" diff={diff.limitations} render={String} />
      ) : null}
      {diff.reviewOptions ? (
        <SetDiffGroup
          title="Opções de revisão"
          diff={diff.reviewOptions}
          render={getConflictReviewOptionLabel}
        />
      ) : null}
    </div>
  );
}

function SetDiffGroup<T>({
  title,
  diff,
  render,
}: {
  title: string;
  diff: FindingReviewSetDiff<T>;
  render: (value: T) => string;
}) {
  return (
    <section className="review-context-diff-group">
      <h5>{title}</h5>
      {diff.added.length > 0 ? (
        <div>
          <strong>Adicionado</strong>
          <ul>
            {diff.added.map((item, index) => (
              <li key={`added:${index}`}>{render(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {diff.removed.length > 0 ? (
        <div>
          <strong>Removido</strong>
          <ul>
            {diff.removed.map((item, index) => (
              <li key={`removed:${index}`}>{render(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ObservationDiffGroup({
  diff,
}: {
  diff: FindingReviewSetDiff<FindingReviewMaterialObservation>;
}) {
  return (
    <SetDiffGroup
      title="Observações e proveniência"
      diff={diff}
      render={(observation) =>
        [
          observation.attribute === 'HOSTNAME' ? 'Hostname' : 'Endereço IP',
          observation.normalizedValue,
          `ativo ${observation.assetId}`,
          `fonte ${observation.source} (${getConflictSourceTypeLabel(observation.sourceType)})`,
          `evidência ${observation.evidenceId ?? 'não informada'}`,
          `observado ${formatDateTime(observation.observedAt)}`,
          `ingerido ${formatDateTime(observation.ingestedAt)}`,
          observation.current ? 'atual' : 'histórica',
        ].join(' · ')
      }
    />
  );
}

function ValueDiffGroup({
  title,
  before,
  after,
}: {
  title: string;
  before: string | null;
  after: string | null;
}) {
  return (
    <section className="review-context-diff-group">
      <h5>{title}</h5>
      <dl>
        <div>
          <dt>Antes</dt>
          <dd>{before ?? 'Não informado'}</dd>
        </div>
        <div>
          <dt>Agora</dt>
          <dd>{after ?? 'Não informado'}</dd>
        </div>
      </dl>
    </section>
  );
}

function formatTemporalContext(value: FindingReviewSnapshot['temporalContext']): string {
  return [
    getConflictTemporalRelationshipLabel(value.relationship),
    `início ${formatDateTime(value.firstObservedAt)}`,
    `fim ${formatDateTime(value.lastObservedAt)}`,
  ].join(' · ');
}
