import { EvidenceSource } from './evidence-source';

export interface EvidenceCandidate {
  attributeId: string;
  value: unknown;
  valueText: string | null;
  normalizedValue: string | null;
  source: EvidenceSource;
  observedAt: Date;
  ingestedAt: Date | null;
  confidence: number | null;
  dataQuality: number | null;
  isManual: boolean;
  evidenceId: string | null;
  isCurrent: boolean;
  confirmationCount: number;
}
