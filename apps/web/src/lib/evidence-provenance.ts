export type EvidenceSourceKind = 'MANUAL' | 'SIMULATED' | 'TECHNICAL' | 'UNKNOWN';

export type EvidenceExplanationStatus =
  | 'NO_CURRENT_VALUE'
  | 'CURRENT_VALUE_WITH_PROVENANCE'
  | 'CURRENT_VALUE_WITHOUT_PROVENANCE'
  | 'CURRENT_VALUE_CANDIDATE_MISMATCH'
  | 'AMBIGUOUS_CURRENT_CANDIDATES'
  | 'MULTIPLE_OBSERVED_VALUES';

export interface EvidenceAnalysisSource {
  identifier: string;
  kind: EvidenceSourceKind;
  evidenceType: string | null;
  trustScore: number | null;
}

export interface EvidenceAnalysisCandidate {
  attributeId: string;
  value: unknown;
  valueText: string | null;
  normalizedValue: string | null;
  source: EvidenceAnalysisSource;
  attributeObservedAt: string | null;
  evidenceObservedAt: string | null;
  evidenceIngestedAt: string | null;
  persistedConfidenceScore: number | null;
  dataQuality: number | null;
  isManual: boolean;
  evidenceId: string | null;
  evidenceAvailable: boolean;
  isCurrent: boolean;
  confirmationCount: number;
}

export interface EvidenceAnalysisExplanation {
  status: EvidenceExplanationStatus;
  summary: string;
  decisionApplied: false;
  selectionBasis: 'CURRENT_PERSISTED_VALUE' | 'NONE';
  observedValueCount: number;
  supportingEvidenceCount: number;
  limitations: string[];
}

export type ShadowDecisionStatus =
  | 'RECOMMENDED'
  | 'CURRENT_VALUE_CONFIRMED'
  | 'TIED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_CURRENT_VALUE'
  | 'NO_CANDIDATES';

export type ShadowCriterion =
  | 'SOURCE_TYPE'
  | 'EVIDENCE_LINK'
  | 'RECENCY'
  | 'CURRENT_OR_HISTORICAL'
  | 'LEGACY_SCORE';

export type ShadowCriterionResultKind =
  | 'POSITIVE'
  | 'NEUTRAL'
  | 'NEGATIVE'
  | 'NOT_APPLICABLE';

export interface ShadowCriterionResult {
  criterion: ShadowCriterion;
  result: ShadowCriterionResultKind;
  points: number;
  explanation: string;
}

export interface ShadowCandidateAssessment {
  candidateId: string;
  value: unknown;
  normalizedValue: string | null;
  evidenceId: string | null;
  sourceType: EvidenceSourceKind;
  eligible: boolean;
  policyScore: number | null;
  criteria: ShadowCriterionResult[];
  limitations: string[];
}

export interface ShadowRecommendedCandidate {
  value: unknown;
  normalizedValue: string;
  policyScore: number;
  supportingCandidateIds: string[];
  supportingEvidenceIds: string[];
}

export interface ShadowTiedValue {
  value: unknown;
  normalizedValue: string;
  policyScore: number;
  supportingCandidateIds: string[];
}

export interface ShadowDecision {
  mode: 'SHADOW';
  status: ShadowDecisionStatus;
  currentValue: unknown;
  recommendedCandidate: ShadowRecommendedCandidate | null;
  divergesFromCurrentValue: boolean | null;
  assessments: ShadowCandidateAssessment[];
  tiedValues: ShadowTiedValue[];
  explanation: string[];
  limitations: string[];
  policyVersion: string;
  scoreMeaning: string;
}

export interface AttributeEvidenceAnalysis {
  attribute: string;
  currentValue: unknown;
  candidates: EvidenceAnalysisCandidate[];
  selectedCandidate: EvidenceAnalysisCandidate | null;
  persistedConfidenceScore: number | null;
  explanation: EvidenceAnalysisExplanation;
  shadowDecision?: ShadowDecision;
}

export interface AssetEvidenceAnalysisResponse {
  asset: { id: string; name: string };
  mode: 'SHADOW';
  decisionsChanged: false;
  analyses: AttributeEvidenceAnalysis[];
}

export type ProvenanceTone = 'positive' | 'warning' | 'neutral' | 'attention';

export interface ProvenancePresentation {
  label: string;
  description: string;
  tone: ProvenanceTone;
}

export const SHADOW_MODE_DESCRIPTION =
  'O Evidence Engine está em modo sombra. Esta análise não altera os dados nem escolhe automaticamente entre as fontes disponíveis.';

export const PERSISTED_SCORE_EXPLANATION =
  'Valor legado registrado pelo fluxo de origem. Não representa confiança calculada pelo Evidence Engine.';

const explanationStatuses = new Set<EvidenceExplanationStatus>([
  'NO_CURRENT_VALUE',
  'CURRENT_VALUE_WITH_PROVENANCE',
  'CURRENT_VALUE_WITHOUT_PROVENANCE',
  'CURRENT_VALUE_CANDIDATE_MISMATCH',
  'AMBIGUOUS_CURRENT_CANDIDATES',
  'MULTIPLE_OBSERVED_VALUES',
]);

const sourceKinds = new Set<EvidenceSourceKind>([
  'MANUAL',
  'SIMULATED',
  'TECHNICAL',
  'UNKNOWN',
]);

const shadowDecisionStatuses = new Set<ShadowDecisionStatus>([
  'RECOMMENDED',
  'CURRENT_VALUE_CONFIRMED',
  'TIED',
  'INSUFFICIENT_EVIDENCE',
  'NO_CURRENT_VALUE',
  'NO_CANDIDATES',
]);

const shadowCriteria = new Set<ShadowCriterion>([
  'SOURCE_TYPE',
  'EVIDENCE_LINK',
  'RECENCY',
  'CURRENT_OR_HISTORICAL',
  'LEGACY_SCORE',
]);

const shadowCriterionResults = new Set<ShadowCriterionResultKind>([
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE',
  'NOT_APPLICABLE',
]);

const shadowDecisionPresentations: Record<
  ShadowDecisionStatus,
  ProvenancePresentation
> = {
  CURRENT_VALUE_CONFIRMED: {
    label: 'A política recomendaria manter o valor atual',
    description: 'A recomendação é equivalente ao valor persistido, sem afirmar que ele está correto.',
    tone: 'positive',
  },
  RECOMMENDED: {
    label: 'A política recomendaria outro valor',
    description: 'Existe uma recomendação diferente, mas nenhuma alteração foi aplicada.',
    tone: 'attention',
  },
  TIED: {
    label: 'Empate entre valores',
    description: 'Dois ou mais valores empataram e a política não produziu recomendação.',
    tone: 'warning',
  },
  INSUFFICIENT_EVIDENCE: {
    label: 'Evidência insuficiente para recomendar',
    description: 'Os candidatos permanecem visíveis, mas não sustentam uma recomendação.',
    tone: 'warning',
  },
  NO_CURRENT_VALUE: {
    label: 'Sem valor atual para comparação',
    description: 'Não existe valor atual nem candidato elegível para produzir uma recomendação.',
    tone: 'neutral',
  },
  NO_CANDIDATES: {
    label: 'Nenhum candidato disponível',
    description: 'Nenhum candidato foi encontrado para este atributo.',
    tone: 'neutral',
  },
};

const shadowCriterionLabels: Record<ShadowCriterion, string> = {
  SOURCE_TYPE: 'Tipo da fonte',
  EVIDENCE_LINK: 'Vínculo com evidência',
  RECENCY: 'Recência da evidência',
  CURRENT_OR_HISTORICAL: 'Estado atual ou histórico',
  LEGACY_SCORE: 'Score legado',
};

const shadowCriterionResultLabels: Record<ShadowCriterionResultKind, string> = {
  POSITIVE: 'Contribuiu',
  NEUTRAL: 'Neutro',
  NEGATIVE: 'Não contribuiu',
  NOT_APPLICABLE: 'Não aplicável',
};

const provenancePresentations: Record<EvidenceExplanationStatus, ProvenancePresentation> = {
  CURRENT_VALUE_WITH_PROVENANCE: {
    label: 'Proveniência vinculada',
    description: 'O valor atual possui vínculo direto com a evidência apresentada.',
    tone: 'positive',
  },
  CURRENT_VALUE_WITHOUT_PROVENANCE: {
    label: 'Proveniência não comprovada',
    description: 'O valor atual não possui evidência disponível suficiente para comprovar sua origem.',
    tone: 'warning',
  },
  CURRENT_VALUE_CANDIDATE_MISMATCH: {
    label: 'Proveniência não comprovada',
    description: 'O registro atual não corresponde de forma inequívoca ao valor persistido.',
    tone: 'warning',
  },
  AMBIGUOUS_CURRENT_CANDIDATES: {
    label: 'Proveniência ambígua',
    description: 'Existem múltiplos registros atuais e nenhuma origem única pode ser apresentada.',
    tone: 'attention',
  },
  NO_CURRENT_VALUE: {
    label: 'Sem valor atual',
    description: 'Não existe valor atual persistido inequívoco para este atributo.',
    tone: 'neutral',
  },
  MULTIPLE_OBSERVED_VALUES: {
    label: 'Histórico divergente',
    description: 'O valor atual possui evidência vinculada, mas há valores diferentes no histórico.',
    tone: 'attention',
  },
};

const sourcePresentations: Record<EvidenceSourceKind, { label: string; description: string }> = {
  MANUAL: {
    label: 'Manual',
    description: 'Informação declarada ou enriquecida manualmente.',
  },
  SIMULATED: {
    label: 'Simulada',
    description: 'Informação produzida por uma fonte simulada ou controlada do MVP.',
  },
  TECHNICAL: {
    label: 'Técnica',
    description: 'Informação identificada explicitamente como proveniente de uma fonte técnica.',
  },
  UNKNOWN: {
    label: 'Desconhecida',
    description: 'A autoridade técnica desta fonte não pôde ser classificada.',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isEvidenceSource(value: unknown): value is EvidenceAnalysisSource {
  if (!isRecord(value)) return false;

  return (
    typeof value.identifier === 'string' &&
    typeof value.kind === 'string' &&
    sourceKinds.has(value.kind as EvidenceSourceKind) &&
    isNullableString(value.evidenceType) &&
    isNullableNumber(value.trustScore)
  );
}

function isEvidenceCandidate(value: unknown): value is EvidenceAnalysisCandidate {
  if (!isRecord(value)) return false;

  return (
    typeof value.attributeId === 'string' &&
    Object.hasOwn(value, 'value') &&
    isNullableString(value.valueText) &&
    isNullableString(value.normalizedValue) &&
    isEvidenceSource(value.source) &&
    isNullableString(value.attributeObservedAt) &&
    isNullableString(value.evidenceObservedAt) &&
    isNullableString(value.evidenceIngestedAt) &&
    isNullableNumber(value.persistedConfidenceScore) &&
    isNullableNumber(value.dataQuality) &&
    typeof value.isManual === 'boolean' &&
    isNullableString(value.evidenceId) &&
    typeof value.evidenceAvailable === 'boolean' &&
    typeof value.isCurrent === 'boolean' &&
    isNonNegativeInteger(value.confirmationCount)
  );
}

function isEvidenceExplanation(value: unknown): value is EvidenceAnalysisExplanation {
  if (!isRecord(value)) return false;

  return (
    typeof value.status === 'string' &&
    explanationStatuses.has(value.status as EvidenceExplanationStatus) &&
    typeof value.summary === 'string' &&
    value.decisionApplied === false &&
    (value.selectionBasis === 'CURRENT_PERSISTED_VALUE' || value.selectionBasis === 'NONE') &&
    isNonNegativeInteger(value.observedValueCount) &&
    isNonNegativeInteger(value.supportingEvidenceCount) &&
    Array.isArray(value.limitations) &&
    value.limitations.every((limitation) => typeof limitation === 'string')
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isShadowCriterionResult(value: unknown): value is ShadowCriterionResult {
  if (!isRecord(value)) return false;

  return (
    typeof value.criterion === 'string' &&
    shadowCriteria.has(value.criterion as ShadowCriterion) &&
    typeof value.result === 'string' &&
    shadowCriterionResults.has(value.result as ShadowCriterionResultKind) &&
    typeof value.points === 'number' &&
    Number.isFinite(value.points) &&
    typeof value.explanation === 'string'
  );
}

function isShadowAssessment(value: unknown): value is ShadowCandidateAssessment {
  if (!isRecord(value)) return false;

  const sourceType = value.sourceType as EvidenceSourceKind;
  const hasValidSource = typeof value.sourceType === 'string' && sourceKinds.has(sourceType);
  const eligibilityIsConsistent =
    typeof value.eligible === 'boolean' &&
    !((sourceType === 'SIMULATED' || sourceType === 'UNKNOWN') && value.eligible) &&
    !(value.normalizedValue === null && value.eligible) &&
    !(value.eligible && value.policyScore === null) &&
    !(!value.eligible && value.policyScore !== null);

  return (
    typeof value.candidateId === 'string' &&
    Object.hasOwn(value, 'value') &&
    isNullableString(value.normalizedValue) &&
    isNullableString(value.evidenceId) &&
    hasValidSource &&
    eligibilityIsConsistent &&
    isNullableNumber(value.policyScore) &&
    Array.isArray(value.criteria) &&
    value.criteria.every(isShadowCriterionResult) &&
    isStringArray(value.limitations)
  );
}

function isRecommendedCandidate(value: unknown): value is ShadowRecommendedCandidate {
  if (!isRecord(value)) return false;

  return (
    Object.hasOwn(value, 'value') &&
    typeof value.normalizedValue === 'string' &&
    typeof value.policyScore === 'number' &&
    Number.isFinite(value.policyScore) &&
    isStringArray(value.supportingCandidateIds) &&
    isStringArray(value.supportingEvidenceIds)
  );
}

function isTiedValue(value: unknown): value is ShadowTiedValue {
  if (!isRecord(value)) return false;

  return (
    Object.hasOwn(value, 'value') &&
    typeof value.normalizedValue === 'string' &&
    typeof value.policyScore === 'number' &&
    Number.isFinite(value.policyScore) &&
    isStringArray(value.supportingCandidateIds)
  );
}

function isShadowDecision(value: unknown): value is ShadowDecision {
  if (!isRecord(value)) return false;

  return (
    value.mode === 'SHADOW' &&
    typeof value.status === 'string' &&
    shadowDecisionStatuses.has(value.status as ShadowDecisionStatus) &&
    Object.hasOwn(value, 'currentValue') &&
    (value.recommendedCandidate === null || isRecommendedCandidate(value.recommendedCandidate)) &&
    (value.divergesFromCurrentValue === null ||
      typeof value.divergesFromCurrentValue === 'boolean') &&
    Array.isArray(value.assessments) &&
    value.assessments.every(isShadowAssessment) &&
    Array.isArray(value.tiedValues) &&
    value.tiedValues.every(isTiedValue) &&
    isStringArray(value.explanation) &&
    isStringArray(value.limitations) &&
    typeof value.policyVersion === 'string' &&
    typeof value.scoreMeaning === 'string'
  );
}

function isAttributeAnalysis(value: unknown): value is AttributeEvidenceAnalysis {
  if (!isRecord(value)) return false;

  return (
    typeof value.attribute === 'string' &&
    Object.hasOwn(value, 'currentValue') &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isEvidenceCandidate) &&
    (value.selectedCandidate === null || isEvidenceCandidate(value.selectedCandidate)) &&
    isNullableNumber(value.persistedConfidenceScore) &&
    isEvidenceExplanation(value.explanation) &&
    (!Object.hasOwn(value, 'shadowDecision') || isShadowDecision(value.shadowDecision))
  );
}

export function parseEvidenceAnalysisResponse(value: unknown): AssetEvidenceAnalysisResponse | null {
  if (!isRecord(value) || !isRecord(value.asset)) return null;

  if (
    typeof value.asset.id !== 'string' ||
    typeof value.asset.name !== 'string' ||
    value.mode !== 'SHADOW' ||
    value.decisionsChanged !== false ||
    !Array.isArray(value.analyses) ||
    !value.analyses.every(isAttributeAnalysis)
  ) {
    return null;
  }

  const analyses = value.analyses as AttributeEvidenceAnalysis[];

  return {
    asset: { id: value.asset.id, name: value.asset.name },
    mode: 'SHADOW',
    decisionsChanged: false,
    analyses: analyses.map((analysis) => ({
      attribute: analysis.attribute,
      currentValue: analysis.currentValue,
      candidates: analysis.candidates.map(sanitizeCandidate),
      selectedCandidate: analysis.selectedCandidate
        ? sanitizeCandidate(analysis.selectedCandidate)
        : null,
      persistedConfidenceScore: analysis.persistedConfidenceScore,
      explanation: {
        status: analysis.explanation.status,
        summary: analysis.explanation.summary,
        decisionApplied: false,
        selectionBasis: analysis.explanation.selectionBasis,
        observedValueCount: analysis.explanation.observedValueCount,
        supportingEvidenceCount: analysis.explanation.supportingEvidenceCount,
        limitations: [...analysis.explanation.limitations],
      },
      ...(analysis.shadowDecision
        ? { shadowDecision: sanitizeShadowDecision(analysis.shadowDecision) }
        : {}),
    })),
  };
}

function sanitizeShadowDecision(decision: ShadowDecision): ShadowDecision {
  return {
    mode: 'SHADOW',
    status: decision.status,
    currentValue: decision.currentValue,
    recommendedCandidate: decision.recommendedCandidate
      ? {
          value: decision.recommendedCandidate.value,
          normalizedValue: decision.recommendedCandidate.normalizedValue,
          policyScore: decision.recommendedCandidate.policyScore,
          supportingCandidateIds: [...decision.recommendedCandidate.supportingCandidateIds],
          supportingEvidenceIds: [...decision.recommendedCandidate.supportingEvidenceIds],
        }
      : null,
    divergesFromCurrentValue: decision.divergesFromCurrentValue,
    assessments: decision.assessments.map((assessment) => ({
      candidateId: assessment.candidateId,
      value: assessment.value,
      normalizedValue: assessment.normalizedValue,
      evidenceId: assessment.evidenceId,
      sourceType: assessment.sourceType,
      eligible: assessment.eligible,
      policyScore: assessment.policyScore,
      criteria: assessment.criteria.map((criterion) => ({
        criterion: criterion.criterion,
        result: criterion.result,
        points: criterion.points,
        explanation: criterion.explanation,
      })),
      limitations: [...assessment.limitations],
    })),
    tiedValues: decision.tiedValues.map((item) => ({
      value: item.value,
      normalizedValue: item.normalizedValue,
      policyScore: item.policyScore,
      supportingCandidateIds: [...item.supportingCandidateIds],
    })),
    explanation: [...decision.explanation],
    limitations: [...decision.limitations],
    policyVersion: decision.policyVersion,
    scoreMeaning: decision.scoreMeaning,
  };
}

function sanitizeCandidate(candidate: EvidenceAnalysisCandidate): EvidenceAnalysisCandidate {
  return {
    attributeId: candidate.attributeId,
    value: candidate.value,
    valueText: candidate.valueText,
    normalizedValue: candidate.normalizedValue,
    source: {
      identifier: candidate.source.identifier,
      kind: candidate.source.kind,
      evidenceType: candidate.source.evidenceType,
      trustScore: candidate.source.trustScore,
    },
    attributeObservedAt: candidate.attributeObservedAt,
    evidenceObservedAt: candidate.evidenceObservedAt,
    evidenceIngestedAt: candidate.evidenceIngestedAt,
    persistedConfidenceScore: candidate.persistedConfidenceScore,
    dataQuality: candidate.dataQuality,
    isManual: candidate.isManual,
    evidenceId: candidate.evidenceId,
    evidenceAvailable: candidate.evidenceAvailable,
    isCurrent: candidate.isCurrent,
    confirmationCount: candidate.confirmationCount,
  };
}

export function getProvenancePresentation(
  status: EvidenceExplanationStatus,
): ProvenancePresentation {
  return provenancePresentations[status];
}

export function getSourcePresentation(
  kind: EvidenceSourceKind,
): { label: string; description: string } {
  return sourcePresentations[kind];
}

export function formatProvenanceValue(value: unknown): string {
  if (value === null || value === undefined) return 'Sem valor atual';
  if (typeof value === 'string') return value || 'Valor vazio';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value) ?? 'Valor estruturado não disponível';
  } catch {
    return 'Valor estruturado não disponível';
  }
}

export function formatShadowValue(value: unknown, emptyLabel = 'Sem valor válido'): string {
  if (value === null || value === undefined) return emptyLabel;
  if (typeof value === 'string') return value.trim().length > 0 ? value : emptyLabel;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value) ?? emptyLabel;
  } catch {
    return emptyLabel;
  }
}

export function getShadowDecisionPresentation(
  status: ShadowDecisionStatus,
): ProvenancePresentation {
  return shadowDecisionPresentations[status];
}

export function getShadowCriterionLabel(criterion: ShadowCriterion): string {
  return shadowCriterionLabels[criterion];
}

export function getShadowCriterionResultLabel(result: ShadowCriterionResultKind): string {
  return shadowCriterionResultLabels[result];
}

export function getShadowDivergenceLabel(value: boolean | null): string {
  if (value === true) return 'Diverge do valor persistido';
  if (value === false) return 'Equivalente ao valor persistido';
  return 'Comparação não disponível';
}

export function formatPolicyScore(value: number | null): string {
  return value === null ? 'Não aplicável' : String(value);
}

export function formatSupportingEvidence(count: number): string {
  if (count === 0) return 'Nenhuma evidência disponível sustenta diretamente o valor atual.';
  if (count === 1) return '1 evidência sustenta diretamente o valor atual.';
  return `${count} evidências sustentam diretamente o valor atual.`;
}

export function formatTrustScore(score: number | null): string {
  return score === null ? 'Trust Score ainda não definido' : `Trust Score da fonte: ${score}`;
}

export function abbreviateEvidenceId(value: string | null): string {
  if (!value) return 'Não disponível';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export type ProvenanceSectionState = 'LOADING' | 'ERROR' | 'EMPTY' | 'READY';

export function resolveProvenanceSectionState(input: {
  loading: boolean;
  error: string | null;
  response: AssetEvidenceAnalysisResponse | null;
}): ProvenanceSectionState {
  if (input.loading) return 'LOADING';
  if (input.error) return 'ERROR';
  if (!input.response || input.response.analyses.length === 0) return 'EMPTY';
  return 'READY';
}

export function shouldShowShadowModeSummary(
  state: ProvenanceSectionState,
  response: AssetEvidenceAnalysisResponse | null,
): boolean {
  return (state === 'READY' || state === 'EMPTY') && response?.mode === 'SHADOW';
}

export function canApplyProvenanceResult(input: {
  active: boolean;
  completedRequestKey: string;
  currentRequestKey: string;
}): boolean {
  return input.active && input.completedRequestKey === input.currentRequestKey;
}

export function getProvenanceErrorMessage(status: number | null): string {
  if (status === 404) {
    return 'A análise de proveniência deste ativo não foi encontrada.';
  }

  return 'Não foi possível carregar a proveniência dos dados. Tente novamente.';
}
