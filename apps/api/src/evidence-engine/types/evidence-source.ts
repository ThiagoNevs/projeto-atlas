export type EvidenceSourceKind = 'MANUAL' | 'SIMULATED' | 'TECHNICAL' | 'UNKNOWN';

export interface EvidenceSource {
  identifier: string;
  kind: EvidenceSourceKind;
  evidenceType: string | null;
  trustScore: number | null;
}
