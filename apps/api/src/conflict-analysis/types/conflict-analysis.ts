export type ConflictFindingType =
  | 'DUPLICATE_HOSTNAME_ACROSS_ASSETS'
  | 'SHARED_IP_DIFFERENT_HOSTNAMES'
  | 'HOSTNAME_DIVERGENCE_ON_ASSET';

export type ConflictObservationAttribute = 'HOSTNAME' | 'IP_ADDRESS';
export type ConflictSourceType = 'MANUAL' | 'TECHNICAL' | 'SIMULATED' | 'UNKNOWN';
export type ConflictTemporalRelationship =
  | 'SAME_OBSERVATION_TIME'
  | 'DISTINCT_OBSERVATION_TIMES'
  | 'PARTIAL_TEMPORAL_CONTEXT'
  | 'NO_TEMPORAL_CONTEXT';
export type ConflictReviewOption =
  | 'SAME_ASSET'
  | 'DIFFERENT_ASSETS'
  | 'IP_REUSED'
  | 'HOSTNAME_CHANGED'
  | 'SOURCE_DATA_INCORRECT'
  | 'NEEDS_MORE_EVIDENCE';

export interface ConflictObservation {
  assetId: string;
  value: string;
  normalizedValue: string;
  attribute: ConflictObservationAttribute;
  source: string;
  sourceType: ConflictSourceType;
  evidenceId: string | null;
  observedAt: string | null;
  ingestedAt: string | null;
  current: boolean;
}

export interface ConflictTemporalContext {
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  differenceMilliseconds: number | null;
  relationship: ConflictTemporalRelationship;
}

export interface ConflictFinding {
  findingId: string;
  type: ConflictFindingType;
  mode: 'SHADOW';
  requiresHumanReview: true;
  affectedAssetIds: string[];
  normalizedHostname: string | null;
  normalizedIp: string | null;
  observations: ConflictObservation[];
  temporalContext: ConflictTemporalContext;
  explanation: string[];
  limitations: string[];
  reviewOptions: ConflictReviewOption[];
}

export interface IdentityNetworkAnalysis {
  assetId: string;
  mode: 'SHADOW';
  policyVersion: string;
  generatedAt: string;
  summary: {
    totalFindings: number;
    requiresHumanReview: number;
  };
  findings: ConflictFinding[];
  limitations: string[];
  decisionsChanged: false;
}

export interface AssetIdentitySnapshot {
  assetId: string;
  snapshotAt: string;
  hostnameObservations: ConflictObservation[];
  ipObservations: ConflictObservation[];
  limitations: string[];
}
