'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  getAssetEvidenceAnalysis,
  type AssetEvidenceAnalysisResponse,
  type AttributeEvidenceAnalysis,
  type EvidenceAnalysisCandidate,
  type ShadowCandidateAssessment,
  type ShadowDecision,
} from '@/lib/api';
import {
  abbreviateEvidenceId,
  canApplyProvenanceResult,
  formatProvenanceValue,
  formatPolicyScore,
  formatShadowValue,
  formatSupportingEvidence,
  formatTrustScore,
  getProvenanceErrorMessage,
  getProvenancePresentation,
  getSourcePresentation,
  getShadowCriterionLabel,
  getShadowCriterionResultLabel,
  getShadowDecisionPresentation,
  getShadowDivergenceLabel,
  PERSISTED_SCORE_EXPLANATION,
  resolveProvenanceSectionState,
  SHADOW_MODE_DESCRIPTION,
  shouldShowShadowModeSummary,
} from '@/lib/evidence-provenance';
import { formatDateTime } from '@/lib/format';
import { getAttributeLabel, getEvidenceTypeLabel } from '@/lib/labels';

export type EvidenceProvenanceLoader = (
  assetId: string,
  options?: { signal?: AbortSignal },
) => Promise<AssetEvidenceAnalysisResponse>;

type EvidenceProvenanceSectionProps = {
  assetId: string;
  refreshKey?: number;
  loader?: EvidenceProvenanceLoader;
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

function ShadowModeSummary() {
  return (
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

function ShadowAssessmentDetails({
  assessment,
  attribute,
}: {
  assessment: ShadowCandidateAssessment;
  attribute: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const source = getSourcePresentation(assessment.sourceType);
  const contentId = `shadow-assessment-${attribute}-${assessment.candidateId}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '-',
  );

  return (
    <article className={`shadow-assessment ${assessment.eligible ? 'eligible' : 'ineligible'}`}>
      <div className="shadow-assessment-heading">
        <div>
          <strong>{formatShadowValue(assessment.normalizedValue === null ? null : assessment.value)}</strong>
          <span>{source.label}</span>
        </div>
        <span className={`shadow-eligibility ${assessment.eligible ? 'eligible' : 'ineligible'}`}>
          {assessment.eligible
            ? 'Elegível para recomendação'
            : 'Inelegível para recomendação'}
        </span>
      </div>

      <div className="shadow-assessment-summary">
        <span>Pontuação de prioridade da política</span>
        <strong>{formatPolicyScore(assessment.policyScore)}</strong>
      </div>

      <button
        type="button"
        className="shadow-assessment-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? 'Ocultar critérios' : 'Ver critérios e limitações'}
      </button>

      {expanded ? (
        <div className="shadow-assessment-content" id={contentId}>
          <div className="shadow-criteria-list" aria-label="Critérios aplicados pela política">
            {assessment.criteria.map((criterion, index) => (
              <article
                className={`shadow-criterion result-${criterion.result.toLowerCase().replace('_', '-')}`}
                key={`${assessment.candidateId}-${criterion.criterion}-${index}`}
              >
                <div>
                  <strong>{getShadowCriterionLabel(criterion.criterion)}</strong>
                  <span>{getShadowCriterionResultLabel(criterion.result)}</span>
                </div>
                <span className="shadow-criterion-points">{criterion.points} pontos</span>
                <p>{criterion.explanation}</p>
              </article>
            ))}
          </div>

          <div className="shadow-assessment-limitations">
            <strong>Limitações deste candidato</strong>
            {assessment.limitations.length ? (
              <ul>
                {assessment.limitations.map((limitation, index) => (
                  <li key={`${assessment.candidateId}-limitation-${index}`}>{limitation}</li>
                ))}
              </ul>
            ) : (
              <p>Nenhuma limitação adicional foi informada.</p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ShadowDecisionBlock({
  decision,
  attribute,
}: {
  decision: ShadowDecision;
  attribute: string;
}) {
  const presentation = getShadowDecisionPresentation(decision.status);
  const recommended = decision.recommendedCandidate;

  return (
    <section className="shadow-decision" aria-label="Recomendação em modo sombra">
      <div className="shadow-decision-heading">
        <div>
          <span className="shadow-decision-kicker">Política de decisão simulada</span>
          <h3>Recomendação em modo sombra</h3>
        </div>
        <span className={`provenance-state state-${presentation.tone}`}>{presentation.label}</span>
      </div>

      <p className="shadow-decision-warning">
        Esta recomendação foi calculada pela política {decision.policyVersion} e não alterou o valor
        persistido.
      </p>
      <p className="shadow-decision-description">{presentation.description}</p>

      <div className="shadow-value-comparison">
        <div>
          <span>Valor atual</span>
          <strong>{formatShadowValue(decision.currentValue, 'Não disponível')}</strong>
        </div>
        <div>
          <span>Valor recomendado pela política</span>
          <strong>
            {recommended
              ? formatShadowValue(recommended.value)
              : 'Nenhuma recomendação produzida'}
          </strong>
        </div>
        <div>
          <span>Comparação</span>
          <strong>{getShadowDivergenceLabel(decision.divergesFromCurrentValue)}</strong>
        </div>
      </div>

      <div className="shadow-policy-score">
        <div>
          <span>Pontuação de prioridade da política</span>
          <strong>{formatPolicyScore(recommended?.policyScore ?? null)}</strong>
        </div>
        <p>{decision.scoreMeaning}</p>
        <small>
          A pontuação representa a prioridade definida pela política e não uma probabilidade,
          confiança ou certeza sobre o valor.
        </small>
        {recommended && recommended.supportingCandidateIds.length > 1 ? (
          <small>
            Valor consolidado a partir de {recommended.supportingCandidateIds.length} candidatos de
            suporte.
          </small>
        ) : null}
      </div>

      {decision.status === 'TIED' ? (
        <div className="shadow-tie" role="status">
          <strong>Valores empatados</strong>
          <p>
            Dois ou mais valores obtiveram a mesma maior pontuação. A política não produziu
            recomendação e não desempata por ordem, ID ou posição.
          </p>
          <ul>
            {decision.tiedValues.map((item, index) => (
              <li key={`${item.normalizedValue}-${index}`}>
                <span>{formatShadowValue(item.value)}</span>
                <small>Pontuação de prioridade: {formatPolicyScore(item.policyScore)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="shadow-decision-notes">
        <div>
          <h4>Por que a política chegou a este resultado</h4>
          {decision.explanation.length ? (
            <ul>
              {decision.explanation.map((explanation, index) => (
                <li key={`${attribute}-shadow-explanation-${index}`}>{explanation}</li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma explicação adicional foi informada.</p>
          )}
        </div>
        <div>
          <h4>Limitações da análise</h4>
          {decision.limitations.length ? (
            <ul>
              {decision.limitations.map((limitation, index) => (
                <li key={`${attribute}-shadow-limitation-${index}`}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma limitação adicional foi informada.</p>
          )}
        </div>
      </div>

      <div className="shadow-assessments-section">
        <h4>Candidatos avaliados pela política</h4>
        {decision.assessments.length ? (
          <div className="shadow-assessments-list">
            {decision.assessments.map((assessment) => (
              <ShadowAssessmentDetails
                assessment={assessment}
                attribute={attribute}
                key={assessment.candidateId}
              />
            ))}
          </div>
        ) : (
          <p className="muted-copy">Nenhum candidato foi avaliado pela política.</p>
        )}
      </div>
    </section>
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

        {analysis.shadowDecision ? (
          <ShadowDecisionBlock decision={analysis.shadowDecision} attribute={analysis.attribute} />
        ) : (
          <p className="shadow-decision-unavailable">
            Decisão simulada ainda não disponível para este atributo.
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
  loader = getAssetEvidenceAnalysis,
}: EvidenceProvenanceSectionProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const requestKey = `${assetId}:${refreshKey}:${retryVersion}`;
  const currentRequestKey = useRef(requestKey);
  const [result, setResult] = useState<{
    requestKey: string;
    response: AssetEvidenceAnalysisResponse | null;
    error: string | null;
  }>({ requestKey: '', response: null, error: null });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    currentRequestKey.current = requestKey;

    void loader(assetId, { signal: controller.signal })
      .then((analysis) => {
        if (
          canApplyProvenanceResult({
            active,
            completedRequestKey: requestKey,
            currentRequestKey: currentRequestKey.current,
          })
        ) {
          setResult({ requestKey, response: analysis, error: null });
        }
      })
      .catch((loadError: unknown) => {
        if (
          !canApplyProvenanceResult({
            active,
            completedRequestKey: requestKey,
            currentRequestKey: currentRequestKey.current,
          })
        ) {
          return;
        }
        const status = loadError instanceof ApiError ? loadError.status : null;
        setResult({
          requestKey,
          response: null,
          error: getProvenanceErrorMessage(status),
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [assetId, loader, requestKey]);

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

      {shouldShowShadowModeSummary(state, response) ? <ShadowModeSummary /> : null}

      {state === 'EMPTY' ? (
        <p className="provenance-empty">
          Não há atributos disponíveis para análise de proveniência neste ativo.
        </p>
      ) : null}

      {state === 'READY' && response ? (
        <div className="provenance-attributes-list">
          {response.analyses.map((analysis) => (
            <AttributeAnalysis analysis={analysis} key={analysis.attribute} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
