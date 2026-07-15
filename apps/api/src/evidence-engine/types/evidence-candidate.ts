import { EvidenceSource } from './evidence-source';

export interface EvidenceCandidate {
  attributeId: string;
  value: unknown;
  valueText: string | null;
  normalizedValue: string | null;
  source: EvidenceSource;
  attributeObservedAt: Date | null;
  evidenceObservedAt: Date | null;
  evidenceIngestedAt: Date | null;
  persistedConfidenceScore: number | null;
  dataQuality: number | null;
  isManual: boolean;
  evidenceId: string | null;
  evidenceAvailable: boolean;
  isCurrent: boolean;
  confirmationCount: number;
}
