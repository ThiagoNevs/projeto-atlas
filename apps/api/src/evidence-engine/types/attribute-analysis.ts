import { EvidenceCandidate } from './evidence-candidate';
import { EvidenceExplanation } from './evidence-explanation';

export interface AttributeAnalysis {
  attribute: string;
  currentValue: unknown;
  candidates: EvidenceCandidate[];
  selectedCandidate: EvidenceCandidate | null;
  persistedConfidenceScore: number | null;
  explanation: EvidenceExplanation;
}
