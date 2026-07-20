import type { ConflictFindingType } from './conflict-findings.ts';

export const FINDING_REVIEW_CASE_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_FOR_EVIDENCE',
  'RESOLVED',
  'DISMISSED',
  'CANCELLED',
] as const;

export const FINDING_REVIEW_STALENESSES = [
  'CURRENT',
  'CHANGED',
  'NO_LONGER_DETECTED',
  'POLICY_VERSION_CHANGED',
  'ASSET_UNAVAILABLE',
  'REQUIRES_REFRESH',
] as const;

export const FINDING_REVIEW_SORT_FIELDS = ['createdAt', 'updatedAt', 'status', 'staleness'] as const;

export type FindingReviewCaseStatus = (typeof FINDING_REVIEW_CASE_STATUSES)[number];
export type FindingReviewStaleness = (typeof FINDING_REVIEW_STALENESSES)[number];
export type FindingReviewCaseSortField = (typeof FINDING_REVIEW_SORT_FIELDS)[number];
export type FindingReviewSortDirection = 'asc' | 'desc';

export interface FindingReviewCaseQuery {
  status?: FindingReviewCaseStatus;
  staleness?: FindingReviewStaleness;
  findingType?: ConflictFindingType;
  createdBy?: string;
  assetId?: string;
  findingId?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: FindingReviewCaseSortField;
  sortDirection?: FindingReviewSortDirection;
}

export interface FindingReviewCaseListItem {
  id: string;
  findingId: string;
  findingType: ConflictFindingType;
  policyVersion: string;
  status: FindingReviewCaseStatus;
  staleness: FindingReviewStaleness;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  eventCount: number;
}

export interface FindingReviewCaseListResponse {
  items: FindingReviewCaseListItem[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface FindingReviewCaseAsset {
  assetIdAtCreation: string;
  assetNameAtCreation: string;
  role: string;
  currentAssetId: string | null;
  currentAssetName: string | null;
  currentAssetAvailable: boolean;
}

export interface FindingReviewCaseEvent {
  id: string;
  eventType: string;
  versionBefore: number | null;
  versionAfter: number;
  actor: string;
  metadata: Record<string, string> | null;
  createdAt: string;
}

export interface FindingReviewCaseDetail extends Omit<FindingReviewCaseListItem, 'assetCount' | 'eventCount'> {
  originalSnapshot: unknown;
  originalSnapshotHash: string;
  assets: FindingReviewCaseAsset[];
  events: FindingReviewCaseEvent[];
}

export interface CreateFindingReviewCaseResponse {
  id: string;
  findingId: string;
  findingType: ConflictFindingType;
  policyVersion: string;
  reviewSubjectKey: string;
  status: FindingReviewCaseStatus;
  staleness: FindingReviewStaleness;
  version: number;
  affectedAssets: Array<{ assetId: string; assetName: string; role: string }>;
  createdBy: string;
  findingGeneratedAt: string;
  createdAt: string;
  idempotentReplay: boolean;
}

export const DEFAULT_FINDING_REVIEW_CASE_QUERY: Required<
  Pick<FindingReviewCaseQuery, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>
> = { page: 1, pageSize: 25, sortBy: 'createdAt', sortDirection: 'desc' };

const statusLabels: Record<FindingReviewCaseStatus, string> = {
  OPEN: 'Aberto',
  IN_REVIEW: 'Em análise',
  WAITING_FOR_EVIDENCE: 'Aguardando evidências',
  RESOLVED: 'Resolvido',
  DISMISSED: 'Descartado',
  CANCELLED: 'Cancelado',
};

const stalenessLabels: Record<FindingReviewStaleness, string> = {
  CURRENT: 'Atual',
  CHANGED: 'Achado alterado',
  NO_LONGER_DETECTED: 'Não detectado atualmente',
  POLICY_VERSION_CHANGED: 'Política alterada',
  ASSET_UNAVAILABLE: 'Ativo indisponível',
  REQUIRES_REFRESH: 'Requer atualização',
};

export function getFindingReviewCaseStatusLabel(value: FindingReviewCaseStatus): string {
  return statusLabels[value];
}

export function getFindingReviewStalenessLabel(value: FindingReviewStaleness): string {
  return stalenessLabels[value];
}

export function getFindingReviewEventLabel(value: string): string {
  return value === 'CASE_CREATED' ? 'Caso criado' : 'Evento do caso';
}

export function serializeFindingReviewCaseQuery(query: FindingReviewCaseQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function createFindingReviewIdempotencyKey(randomUuid: () => string): string {
  return `atlas-ui-${randomUuid()}`;
}
