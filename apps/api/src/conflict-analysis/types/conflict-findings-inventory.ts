import type {
  ConflictFindingType,
  ConflictReviewOption,
  ConflictSourceType,
  ConflictTemporalContext,
  ConflictTemporalRelationship,
} from './conflict-analysis';

export interface ConflictFindingListItem {
  findingId: string;
  type: ConflictFindingType;
  requiresHumanReview: true;
  affectedAssetIds: string[];
  affectedAssets: Array<{
    assetId: string;
    persistedName: string;
  }>;
  normalizedHostname: string | null;
  normalizedIp: string | null;
  temporalContext: ConflictTemporalContext;
  sourceTypes: ConflictSourceType[];
  observationCount: number;
  currentObservationCount: number;
  historicalObservationCount: number;
  explanationSummary: string;
  limitationCount: number;
  reviewOptions: ConflictReviewOption[];
}

export interface ConflictFindingsPage {
  mode: 'SHADOW';
  policyVersion: string;
  generatedAt: string;
  decisionsChanged: false;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: {
    type: ConflictFindingType | null;
    assetId: string | null;
    hostname: string | null;
    ip: string | null;
    sourceType: ConflictSourceType | null;
    temporalRelationship: ConflictTemporalRelationship | null;
    hasLimitations: boolean | null;
  };
  summary: {
    totalFindings: number;
    byType: Record<ConflictFindingType, number>;
    affectedAssets: number;
    findingsWithLimitations: number;
  };
  items: ConflictFindingListItem[];
  limitations: string[];
}
