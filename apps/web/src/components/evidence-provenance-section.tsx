'use client';

import { useEffect, useState } from 'react';

import {
  ApiError,
  getAssetEvidenceAnalysis,
  type AssetEvidenceAnalysisResponse,
  type AttributeEvidenceAnalysis,
  type EvidenceAnalysisCandidate,
} from '@/lib/api';
import {
  abbreviateEvidenceId,
  formatProvenanceValue,
  formatSupportingEvidence,
  formatTrustScore,
  getProvenanceErrorMessage,
  getProvenancePresentation,
  getSourcePresentation,
  PERSISTED_SCORE_EXPLANATION,
  resolveProvenanceSectionState,
  SHADOW_MODE_DESCRIPTION,
} from '@/lib/evidence-provenance';
import { formatDateTime } from '@/lib/format';
import { getAttributeLabel, getEvidenceTypeLabel } from '@/lib/labels';

type EvidenceProvenanceSectionProps = {
  assetId: string;
  refreshKey?: number;
};

function formatProvenanceDate(value: string | null): string {
  return value ? formatDateTime(value) : 'Não disponível';
}

function PersistedScore({ value }: { value: number | null }) {
  return (
    <div className="provenance-score">
      <span>Score persistido</span>
      <strong>{value ?? 'Não disponível'}</strong>
      <small>{PERSISTED_SCORE_EXPLANATION}</small>
    </div>
  );
}

function CandidateDetails({
  candidate,
  directlyLinked = false,
}: {
  candidate: EvidenceAnalysisCandidate;
  directlyLinked?: boolean;
}) {
  const source = getSourcePresentation(candidate.source.kind);

  return (
    <article className={`provenance-candidate ${directlyLinked ? 'candidate-linked' : ''}`}>
      <div className="provenance-candidate-heading">
        <div>
          <span className="provenance-candidate-kind">
            {directlyLinked ? 'Evidência diretamente vinculada' : candidate.isCurrent ? 'Atual' : 'Histórico'}
          </span>
          <strong title={formatProvenanceValue(candidate.value)}>
            {formatProvenanceValue(candidate.value)}
          </strong>
        </div>
        <span
          className={`source-kind-badge source-${candidate.source.kind.toLowerCase()}`}
          title={source.description}
        >
          {source.label}
        </span>
      </div>

      <dl className="provenance-candidate-grid">
        <div>
          <dt>Origem</dt>
          <dd className="breakable-value" title={candidate.source.identifier}>
            {candidate.source.identifier}
          </dd>
        </div>
        <div>
          <dt>Tipo da evidência</dt>
          <dd>
            {candidate.source.evidenceType
              ? getEvidenceTypeLabel(candidate.source.evidenceType)
              : 'Não disponível'}
          </dd>
        </div>
        <div>
          <dt>ID da evidência</dt>
          <dd className="mono-break" title={candidate.evidenceId ?? undefined}>
            {abbreviateEvidenceId(candidate.evidenceId)}
          </dd>
        </div>
        <div>
          <dt>Trust Score</dt>
          <dd>{formatTrustScore(candidate.source.trustScore)}</dd>
        </div>
        <div>
          <dt>Observado no atributo</dt>
          <dd>{formatProvenanceDate(candidate.attributeObservedAt)}</dd>
        </div>
        <div>
          <dt>Observado na evidência</dt>
          <dd>{formatProvenanceDate(candidate.evidenceObservedAt)}</dd>
        </div>
        <div>
          <dt>Ingerido pelo Atlas</dt>
          <dd>{formatProvenanceDate(candidate.evidenceIngestedAt)}</dd>
        </div>
        <div>
          <dt>Score persistido</dt>
          <dd>{candidate.persistedConfidenceScore ?? 'Não disponível'}</dd>
        </div>
      </dl>
    </article>
  );
}

function AttributeAnalysis({ analysis }: { analysis: AttributeEvidenceAnalysis }) {
  const attributeLabel = getAttributeLabel(analysis.attribute);
  const provenance = getProvenancePresentation(analysis.explanation.status);

  return (
    <details className="provenance-attribute">
      <summary aria-label={`Ver análise de proveniência de ${attributeLabel}`}>
        <div className="provenance-attribute-name">
          <span>{attributeLabel}</span>
          <strong title={formatProvenanceValue(analysis.currentValue)}>
            {formatProvenanceValue(analysis.currentValue)}
          </strong>
        </div>
        <span className={`provenance-state state-${provenance.tone}`}>{provenance.label}</span>
        <span className="provenance-expand-label" aria-hidden="true">
          Ver análise
        </span>
      </summary>

      <div className="provenance-attribute-body">
        <div className="provenance-explanation">
          <div>
            <h3>{provenance.label}</h3>
            <p>{analysis.explanation.summary || provenance.description}</p>
          </div>
          <PersistedScore value={analysis.persistedConfidenceScore} />
        </div>

        <div className="provenance-support" aria-label="Evidências relacionadas ao valor atual">
          <strong>
            Evidências que sustentam o valor atual:{' '}
            {analysis.explanation.supportingEvidenceCount}
          </strong>
          <span>{formatSupportingEvidence(analysis.explanation.supportingEvidenceCount)}</span>
        </div>

        {analysis.selectedCandidate ? (
          <div className="provenance-linked-block">
            <CandidateDetails candidate={analysis.selectedCandidate} directlyLinked />
          </div>
        ) : (
          <p className="provenance-no-selection">
            Nenhuma evidência diretamente vinculada pode ser apresentada para este valor atual.
          </p>
        )}

        <div className="provenance-candidates-section">
          <h3>Candidatos e histórico</h3>
          {analysis.candidates.length ? (
            <div className="provenance-candidates-list">
              {analysis.candidates.map((candidate) => (
                <CandidateDetails candidate={candidate} key={candidate.attributeId} />
              ))}
            </div>
          ) : (
            <p className="muted-copy">Nenhum candidato relacionado foi encontrado.</p>
          )}
        </div>

        <div className="provenance-limitations">
          <h3>Limitações da análise</h3>
          {analysis.explanation.limitations.length ? (
            <ul>
              {analysis.explanation.limitations.map((limitation, index) => (
                <li key={`${analysis.attribute}-limitation-${index}`}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma limitação adicional foi informada.</p>
          )}
        </div>
      </div>
    </details>
  );
}

export function EvidenceProvenanceSection({
  assetId,
  refreshKey = 0,
}: EvidenceProvenanceSectionProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const requestKey = `${assetId}:${refreshKey}:${retryVersion}`;
  const [result, setResult] = useState<{
    requestKey: string;
    response: AssetEvidenceAnalysisResponse | null;
    error: string | null;
  }>({ requestKey: '', response: null, error: null });

  useEffect(() => {
    let active = true;

    void getAssetEvidenceAnalysis(assetId)
      .then((analysis) => {
        if (active) setResult({ requestKey, response: analysis, error: null });
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        const status = loadError instanceof ApiError ? loadError.status : null;
        setResult({
          requestKey,
          response: null,
          error: getProvenanceErrorMessage(status),
        });
      });

    return () => {
      active = false;
    };
  }, [assetId, requestKey]);

  const loading = result.requestKey !== requestKey;
  const response = loading ? null : result.response;
  const error = loading ? null : result.error;
  const state = resolveProvenanceSectionState({ loading, error, response });

  return (
    <section
      className="panel full-panel provenance-panel"
      aria-labelledby="evidence-provenance-title"
    >
      <div className="panel-heading provenance-panel-heading">
        <div>
          <p className="section-kicker">Evidence Engine</p>
          <h2 id="evidence-provenance-title">Proveniência dos dados</h2>
          <p className="provenance-intro">
            Visualize quais registros e evidências estão relacionados aos valores atuais deste ativo.
          </p>
        </div>
        {response ? <span className="count-badge">{response.analyses.length}</span> : null}
      </div>

      {state === 'LOADING' ? (
        <div className="provenance-loading" role="status" aria-live="polite">
          <span className="provenance-loading-bar" />
          <span className="provenance-loading-bar short" />
          <p>Carregando proveniência dos dados...</p>
        </div>
      ) : null}

      {state === 'ERROR' ? (
        <div className="provenance-error" role="alert">
          <div>
            <strong>Proveniência temporariamente indisponível</strong>
            <p>{error}</p>
            <small>As demais informações deste ativo continuam disponíveis.</small>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setRetryVersion((version) => version + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {state === 'EMPTY' ? (
        <p className="provenance-empty">
          Não há atributos disponíveis para análise de proveniência neste ativo.
        </p>
      ) : null}

      {state === 'READY' && response ? (
        <>
          <aside className="shadow-mode-note" aria-label="Resumo do modo sombra">
            <span className="shadow-mode-badge">Modo sombra</span>
            <div>
              <strong>Análise somente leitura</strong>
              <p>{SHADOW_MODE_DESCRIPTION}</p>
            </div>
            <ul>
              <li>Nenhuma decisão foi alterada.</li>
              <li>Trust Score ainda não calculado.</li>
            </ul>
          </aside>

          <div className="provenance-attributes-list">
            {response.analyses.map((analysis) => (
              <AttributeAnalysis analysis={analysis} key={analysis.attribute} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
