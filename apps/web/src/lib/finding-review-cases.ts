import { CONFLICT_FINDING_TYPES, type ConflictFindingType } from './conflict-findings.ts';

export const FINDING_REVIEW_CASE_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_FOR_EVIDENCE',
  'RESOLVED',
  'DISMISSED',
  'CANCELLED',
] as const;

export const ACTIVE_FINDING_REVIEW_CASE_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_FOR_EVIDENCE',
] as const;
export const MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH = 500;

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
export type ActiveFindingReviewCaseStatus = (typeof ACTIVE_FINDING_REVIEW_CASE_STATUSES)[number];
export type FindingReviewStaleness = (typeof FINDING_REVIEW_STALENESSES)[number];
export type FindingReviewCaseSortField = (typeof FINDING_REVIEW_SORT_FIELDS)[number];
export type FindingReviewSortDirection = 'asc' | 'desc';
export const FINDING_REVIEW_IDENTITY_CONCLUSIONS = ['SAME_ASSET', 'DIFFERENT_ASSETS'] as const;
export type FindingReviewIdentityConclusion =
  (typeof FINDING_REVIEW_IDENTITY_CONCLUSIONS)[number];

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

export interface FindingReviewDecision {
  id: string;
  caseId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  caseVersion: number;
  createdBy: string;
  createdAt: string;
}

export interface FindingReviewCaseDetail extends Omit<FindingReviewCaseListItem, 'assetCount' | 'eventCount'> {
  originalSnapshot: unknown;
  originalSnapshotHash: string;
  currentDecision: FindingReviewDecision | null;
  decisionHistory: FindingReviewDecision[];
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

export interface UpdateFindingReviewCaseStatusResponse {
  id: string;
  status: ActiveFindingReviewCaseStatus;
  version: number;
  updatedAt: string;
}

export interface CreateFindingReviewDecisionResponse {
  decision: FindingReviewDecision;
  idempotentReplay: boolean;
}

export interface FindingReviewCaseResolutionResult {
  eventId: string;
  caseId: string;
  decisionId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
  versionBefore: number;
  versionAfter: number;
  previousStatus: 'IN_REVIEW';
  status: 'RESOLVED';
  resolvedBy: string;
  resolvedAt: string;
}

export interface CreateFindingReviewCaseResolutionResponse {
  idempotentReplay: boolean;
  resolution: FindingReviewCaseResolutionResult;
}

export const DEFAULT_FINDING_REVIEW_CASE_QUERY: Required<
  Pick<FindingReviewCaseQuery, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>
> = { page: 1, pageSize: 25, sortBy: 'createdAt', sortDirection: 'desc' };

export const FINDING_REVIEW_CASE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FINDING_REVIEW_FINDING_ID_PATTERN = /^finding_[0-9a-f]{24}$/;
export const FINDING_REVIEW_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

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
  return statusLabels[value] ?? 'Status indisponível';
}

export function isFindingReviewCaseStatus(value: unknown): value is FindingReviewCaseStatus {
  return typeof value === 'string'
    && FINDING_REVIEW_CASE_STATUSES.some((status) => status === value);
}

export function getFindingReviewStalenessLabel(value: FindingReviewStaleness): string {
  return stalenessLabels[value] ?? 'Atualidade indisponível';
}

export function getFindingReviewEventLabel(value: string): string {
  if (value === 'CASE_CREATED') return 'Caso criado';
  if (value === 'CASE_STATUS_CHANGED') return 'Status do caso alterado';
  if (value === 'CASE_DECISION_RECORDED') return 'Decisão de identidade registrada';
  if (value === 'CASE_RESOLVED') return 'Investigação concluída';
  return 'Evento do caso';
}

export function getFindingReviewIdentityConclusionLabel(
  value: FindingReviewIdentityConclusion,
): string {
  return value === 'SAME_ASSET' ? 'Mesmo ativo' : 'Ativos diferentes';
}

export function getAllowedFindingReviewCaseStatusDestinations(
  current: FindingReviewCaseStatus,
): ActiveFindingReviewCaseStatus[] {
  if (!ACTIVE_FINDING_REVIEW_CASE_STATUSES.includes(current as ActiveFindingReviewCaseStatus)) {
    return [];
  }
  return ACTIVE_FINDING_REVIEW_CASE_STATUSES.filter((status) => status !== current);
}

export function requiresFindingReviewCaseWaitingJustification(
  current: FindingReviewCaseStatus,
  next: ActiveFindingReviewCaseStatus,
): boolean {
  return current === 'WAITING_FOR_EVIDENCE' || next === 'WAITING_FOR_EVIDENCE';
}

export function serializeFindingReviewCaseQuery(query: FindingReviewCaseQuery): string {
  const search = new URLSearchParams();
  const entries: Array<[keyof FindingReviewCaseQuery, FindingReviewCaseQuery[keyof FindingReviewCaseQuery]]> = [
    ['status', query.status],
    ['staleness', query.staleness],
    ['findingType', query.findingType],
    ['createdBy', query.createdBy],
    ['assetId', query.assetId],
    ['findingId', query.findingId],
    ['createdFrom', query.createdFrom],
    ['createdTo', query.createdTo],
    ['page', query.page],
    ['pageSize', query.pageSize],
    ['sortBy', query.sortBy],
    ['sortDirection', query.sortDirection],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function createFindingReviewIdempotencyKey(randomUuid: () => string): string {
  return `atlas-ui-${randomUuid()}`;
}

export function isFindingReviewCaseId(value: unknown): value is string {
  return typeof value === 'string' && FINDING_REVIEW_CASE_ID_PATTERN.test(value);
}

export function isFindingReviewFindingId(value: unknown): value is string {
  return typeof value === 'string' && FINDING_REVIEW_FINDING_ID_PATTERN.test(value);
}

export function isFindingReviewTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = FINDING_REVIEW_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function parseFindingReviewCaseListResponse(
  value: unknown,
): FindingReviewCaseListResponse | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseListItem);
  if (items.some((item) => item === null)) return null;
  const pagination = parsePagination(value.pagination);
  if (!pagination) return null;
  return { items: items as FindingReviewCaseListItem[], pagination };
}

export function parseFindingReviewCaseDetail(value: unknown): FindingReviewCaseDetail | null {
  const base = parseCaseBase(value);
  if (!base || !isRecord(value)) return null;
  if (
    !Object.prototype.hasOwnProperty.call(value, 'originalSnapshot') ||
    !isSha256(value.originalSnapshotHash) ||
    !Object.prototype.hasOwnProperty.call(value, 'currentDecision') ||
    !Array.isArray(value.decisionHistory) ||
    !Array.isArray(value.assets) ||
    !Array.isArray(value.events)
  ) {
    return null;
  }
  const assets = value.assets.map(parseAsset);
  const events = value.events.map(parseEvent);
  const decisionHistory = value.decisionHistory.map(parseDecision);
  const currentDecision = value.currentDecision === null ? null : parseDecision(value.currentDecision);
  if (
    assets.some((asset) => asset === null)
    || events.some((event) => event === null)
    || decisionHistory.some((decision) => decision === null)
    || (value.currentDecision !== null && currentDecision === null)
  ) return null;
  const safeHistory = decisionHistory as FindingReviewDecision[];
  if (
    safeHistory.some((decision) => decision.caseId !== base.id)
    || (currentDecision !== null && currentDecision.caseId !== base.id)
  ) return null;
  const expectedCurrent = safeHistory.reduce<FindingReviewDecision | null>((latest, decision) => (
    latest === null || compareDecisions(latest, decision) < 0 ? decision : latest
  ), null);
  if ((currentDecision === null) !== (expectedCurrent === null)) return null;
  if (currentDecision && expectedCurrent && !sameDecision(currentDecision, expectedCurrent)) return null;
  return {
    ...base,
    originalSnapshot: cloneJsonValue(value.originalSnapshot),
    originalSnapshotHash: value.originalSnapshotHash,
    currentDecision,
    decisionHistory: safeHistory,
    assets: assets as FindingReviewCaseAsset[],
    events: events as FindingReviewCaseEvent[],
  };
}

export function parseCreateFindingReviewDecisionResponse(
  value: unknown,
): CreateFindingReviewDecisionResponse | null {
  if (!isRecord(value) || typeof value.idempotentReplay !== 'boolean') return null;
  const decision = parseDecision(value.decision);
  return decision ? { decision, idempotentReplay: value.idempotentReplay } : null;
}

export function parseCreateFindingReviewCaseResolutionResponse(
  value: unknown,
): CreateFindingReviewCaseResolutionResponse | null {
  if (!isRecord(value) || typeof value.idempotentReplay !== 'boolean') return null;
  const resolution = value.resolution;
  if (
    !isRecord(resolution)
    || !isFindingReviewCaseId(resolution.eventId)
    || !isFindingReviewCaseId(resolution.caseId)
    || !isFindingReviewCaseId(resolution.decisionId)
    || !FINDING_REVIEW_IDENTITY_CONCLUSIONS.includes(
      resolution.identityConclusion as FindingReviewIdentityConclusion,
    )
    || typeof resolution.justification !== 'string'
    || resolution.justification.length < 1
    || !isPositiveInteger(resolution.versionBefore)
    || !isPositiveInteger(resolution.versionAfter)
    || resolution.versionAfter !== resolution.versionBefore + 1
    || resolution.previousStatus !== 'IN_REVIEW'
    || resolution.status !== 'RESOLVED'
    || typeof resolution.resolvedBy !== 'string'
    || resolution.resolvedBy.length < 1
    || !isFindingReviewTimestamp(resolution.resolvedAt)
  ) return null;
  return {
    idempotentReplay: value.idempotentReplay,
    resolution: {
      eventId: resolution.eventId,
      caseId: resolution.caseId,
      decisionId: resolution.decisionId,
      identityConclusion: resolution.identityConclusion as FindingReviewIdentityConclusion,
      justification: resolution.justification,
      versionBefore: resolution.versionBefore,
      versionAfter: resolution.versionAfter,
      previousStatus: 'IN_REVIEW',
      status: 'RESOLVED',
      resolvedBy: resolution.resolvedBy,
      resolvedAt: resolution.resolvedAt,
    },
  };
}

export function parseCreateFindingReviewCaseResponse(
  value: unknown,
): CreateFindingReviewCaseResponse | null {
  if (!isRecord(value)) return null;
  if (
    !isFindingReviewCaseId(value.id) ||
    !isFindingReviewFindingId(value.findingId) ||
    !CONFLICT_FINDING_TYPES.includes(value.findingType as ConflictFindingType) ||
    typeof value.policyVersion !== 'string' ||
    typeof value.reviewSubjectKey !== 'string' ||
    !FINDING_REVIEW_CASE_STATUSES.includes(value.status as FindingReviewCaseStatus) ||
    !FINDING_REVIEW_STALENESSES.includes(value.staleness as FindingReviewStaleness) ||
    !isPositiveInteger(value.version) ||
    !Array.isArray(value.affectedAssets) ||
    typeof value.createdBy !== 'string' ||
    !isFindingReviewTimestamp(value.findingGeneratedAt) ||
    !isFindingReviewTimestamp(value.createdAt) ||
    typeof value.idempotentReplay !== 'boolean'
  ) return null;
  const affectedAssets = value.affectedAssets.map((asset) => {
    if (!isRecord(asset) || !isFindingReviewCaseId(asset.assetId)) return null;
    if (typeof asset.assetName !== 'string' || typeof asset.role !== 'string') return null;
    return { assetId: asset.assetId, assetName: asset.assetName, role: asset.role };
  });
  if (affectedAssets.some((asset) => asset === null)) return null;
  return {
    id: value.id,
    findingId: value.findingId,
    findingType: value.findingType as ConflictFindingType,
    policyVersion: value.policyVersion,
    reviewSubjectKey: value.reviewSubjectKey,
    status: value.status as FindingReviewCaseStatus,
    staleness: value.staleness as FindingReviewStaleness,
    version: value.version,
    affectedAssets: affectedAssets as CreateFindingReviewCaseResponse['affectedAssets'],
    createdBy: value.createdBy,
    findingGeneratedAt: value.findingGeneratedAt,
    createdAt: value.createdAt,
    idempotentReplay: value.idempotentReplay,
  };
}

export function parseUpdateFindingReviewCaseStatusResponse(
  value: unknown,
): UpdateFindingReviewCaseStatusResponse | null {
  if (
    !isRecord(value)
    || !isFindingReviewCaseId(value.id)
    || !ACTIVE_FINDING_REVIEW_CASE_STATUSES.includes(
      value.status as ActiveFindingReviewCaseStatus,
    )
    || !isPositiveInteger(value.version)
    || !isFindingReviewTimestamp(value.updatedAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    status: value.status as ActiveFindingReviewCaseStatus,
    version: value.version,
    updatedAt: value.updatedAt,
  };
}

function parseListItem(value: unknown): FindingReviewCaseListItem | null {
  const base = parseCaseBase(value);
  if (!base || !isRecord(value)) return null;
  if (!isNonNegativeInteger(value.assetCount) || !isNonNegativeInteger(value.eventCount)) return null;
  return { ...base, assetCount: value.assetCount, eventCount: value.eventCount };
}

function parseCaseBase(
  value: unknown,
): Omit<FindingReviewCaseListItem, 'assetCount' | 'eventCount'> | null {
  if (!isRecord(value)) return null;
  if (
    !isFindingReviewCaseId(value.id) ||
    !isFindingReviewFindingId(value.findingId) ||
    !CONFLICT_FINDING_TYPES.includes(value.findingType as ConflictFindingType) ||
    typeof value.policyVersion !== 'string' ||
    !FINDING_REVIEW_CASE_STATUSES.includes(value.status as FindingReviewCaseStatus) ||
    !FINDING_REVIEW_STALENESSES.includes(value.staleness as FindingReviewStaleness) ||
    !isPositiveInteger(value.version) ||
    typeof value.createdBy !== 'string' ||
    !isFindingReviewTimestamp(value.createdAt) ||
    !isFindingReviewTimestamp(value.updatedAt)
  ) return null;
  return {
    id: value.id,
    findingId: value.findingId,
    findingType: value.findingType as ConflictFindingType,
    policyVersion: value.policyVersion,
    status: value.status as FindingReviewCaseStatus,
    staleness: value.staleness as FindingReviewStaleness,
    version: value.version,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parsePagination(value: unknown): FindingReviewCaseListResponse['pagination'] | null {
  if (!isRecord(value)) return null;
  if (
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.pageSize) ||
    value.pageSize > 100 ||
    !isNonNegativeInteger(value.totalItems) ||
    !isNonNegativeInteger(value.totalPages)
  ) return null;
  const expectedPages = value.totalItems === 0 ? 0 : Math.ceil(value.totalItems / value.pageSize);
  if (value.totalPages !== expectedPages) return null;
  return {
    page: value.page,
    pageSize: value.pageSize,
    totalItems: value.totalItems,
    totalPages: value.totalPages,
  };
}

function parseAsset(value: unknown): FindingReviewCaseAsset | null {
  if (!isRecord(value) || !isFindingReviewCaseId(value.assetIdAtCreation)) return null;
  if (
    typeof value.assetNameAtCreation !== 'string' ||
    typeof value.role !== 'string' ||
    typeof value.currentAssetAvailable !== 'boolean'
  ) return null;
  const currentAssetId = value.currentAssetId === null ? null : value.currentAssetId;
  const currentAssetName = value.currentAssetName === null ? null : value.currentAssetName;
  if (currentAssetId !== null && !isFindingReviewCaseId(currentAssetId)) return null;
  if (currentAssetName !== null && typeof currentAssetName !== 'string') return null;
  if (value.currentAssetAvailable !== (currentAssetId !== null)) return null;
  return {
    assetIdAtCreation: value.assetIdAtCreation,
    assetNameAtCreation: value.assetNameAtCreation,
    role: value.role,
    currentAssetId,
    currentAssetName,
    currentAssetAvailable: value.currentAssetAvailable,
  };
}

function parseEvent(value: unknown): FindingReviewCaseEvent | null {
  if (!isRecord(value) || !isFindingReviewCaseId(value.id)) return null;
  if (
    typeof value.eventType !== 'string' ||
    (value.versionBefore !== null && !isNonNegativeInteger(value.versionBefore)) ||
    !isPositiveInteger(value.versionAfter) ||
    typeof value.actor !== 'string' ||
    !isFindingReviewTimestamp(value.createdAt)
  ) return null;
  const metadata = parseMetadata(value.metadata);
  if (value.metadata !== null && metadata === null) return null;
  return {
    id: value.id,
    eventType: value.eventType,
    versionBefore: value.versionBefore,
    versionAfter: value.versionAfter,
    actor: value.actor,
    metadata,
    createdAt: value.createdAt,
  };
}

function parseDecision(value: unknown): FindingReviewDecision | null {
  if (!isRecord(value)) return null;
  if (
    !isFindingReviewCaseId(value.id)
    || !isFindingReviewCaseId(value.caseId)
    || !FINDING_REVIEW_IDENTITY_CONCLUSIONS.includes(
      value.identityConclusion as FindingReviewIdentityConclusion,
    )
    || typeof value.justification !== 'string'
    || !isPositiveInteger(value.caseVersion)
    || typeof value.createdBy !== 'string'
    || value.createdBy.length === 0
    || !isFindingReviewTimestamp(value.createdAt)
  ) return null;
  return {
    id: value.id,
    caseId: value.caseId,
    identityConclusion: value.identityConclusion as FindingReviewIdentityConclusion,
    justification: value.justification,
    caseVersion: value.caseVersion,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
  };
}

function compareDecisions(left: FindingReviewDecision, right: FindingReviewDecision): number {
  if (left.caseVersion !== right.caseVersion) return left.caseVersion - right.caseVersion;
  if (left.createdAt < right.createdAt) return -1;
  if (left.createdAt > right.createdAt) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function sameDecision(left: FindingReviewDecision, right: FindingReviewDecision): boolean {
  return left.id === right.id
    && left.caseId === right.caseId
    && left.identityConclusion === right.identityConclusion
    && left.justification === right.justification
    && left.caseVersion === right.caseVersion
    && left.createdBy === right.createdBy
    && left.createdAt === right.createdAt;
}

function parseMetadata(value: unknown): Record<string, string> | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
