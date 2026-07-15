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

export interface AttributeEvidenceAnalysis {
  attribute: string;
  currentValue: unknown;
  candidates: EvidenceAnalysisCandidate[];
  selectedCandidate: EvidenceAnalysisCandidate | null;
  persistedConfidenceScore: number | null;
  explanation: EvidenceAnalysisExplanation;
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

function isAttributeAnalysis(value: unknown): value is AttributeEvidenceAnalysis {
  if (!isRecord(value)) return false;

  return (
    typeof value.attribute === 'string' &&
    Object.hasOwn(value, 'currentValue') &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isEvidenceCandidate) &&
    (value.selectedCandidate === null || isEvidenceCandidate(value.selectedCandidate)) &&
    isNullableNumber(value.persistedConfidenceScore) &&
    isEvidenceExplanation(value.explanation)
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
    })),
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

export function getProvenanceErrorMessage(status: number | null): string {
  if (status === 404) {
    return 'A análise de proveniência deste ativo não foi encontrada.';
  }

  return 'Não foi possível carregar a proveniência dos dados. Tente novamente.';
}
