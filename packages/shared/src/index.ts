export type ProductCapability =
  | 'assets'
  | 'evidence'
  | 'timeline'
  | 'operational-status'
  | 'administrative-status'
  | 'conflicts'
  | 'confidence'
  | 'data-quality';

export type OperationalStatus =
  'UNKNOWN' | 'SEEN_RECENTLY' | 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE';

export type AdministrativeStatus =
  | 'UNKNOWN'
  | 'IN_USE'
  | 'IN_STOCK'
  | 'PLANNED'
  | 'ACTIVE'
  | 'MAINTENANCE'
  | 'DEACTIVATED'
  | 'DISCARDED'
  | 'LOST'
  | 'STOLEN'
  | 'ARCHIVED'
  | 'RETIRED';

export interface HealthStatus {
  service: string;
  status: 'ok';
  timestamp: string;
}

export interface EvidenceReference {
  id: string;
  source: string;
  observedAt: string;
}

export interface AssetSummary {
  id: string;
  name: string;
  operationalStatus: OperationalStatus;
  administrativeStatus: AdministrativeStatus;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  evidence: EvidenceReference[];
}
