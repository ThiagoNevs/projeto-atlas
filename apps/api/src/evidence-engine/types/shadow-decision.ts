import { EvidenceSourceKind } from './evidence-source';

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

/**
 * A recommendation represents one consolidated logical value. It is deliberately
 * not an EvidenceCandidate and preserves every candidate/evidence that supports it.
 */
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
