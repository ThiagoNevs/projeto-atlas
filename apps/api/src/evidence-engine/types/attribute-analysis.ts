import { EvidenceCandidate } from './evidence-candidate';
import { EvidenceExplanation } from './evidence-explanation';
import { ShadowDecision } from './shadow-decision';

export interface AttributeAnalysis {
  attribute: string;
  currentValue: unknown;
  candidates: EvidenceCandidate[];
  selectedCandidate: EvidenceCandidate | null;
  persistedConfidenceScore: number | null;
  explanation: EvidenceExplanation;
  shadowDecision: ShadowDecision;
}
