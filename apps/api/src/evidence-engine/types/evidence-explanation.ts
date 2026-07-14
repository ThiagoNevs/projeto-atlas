export type EvidenceExplanationStatus =
  | 'NO_CURRENT_VALUE'
  | 'CURRENT_VALUE_WITH_PROVENANCE'
  | 'CURRENT_VALUE_WITHOUT_PROVENANCE'
  | 'MULTIPLE_OBSERVED_VALUES';

export interface EvidenceExplanation {
  status: EvidenceExplanationStatus;
  summary: string;
  decisionApplied: false;
  selectionBasis: 'CURRENT_PERSISTED_VALUE' | 'NONE';
  observedValueCount: number;
  supportingEvidenceCount: number;
  limitations: string[];
}
