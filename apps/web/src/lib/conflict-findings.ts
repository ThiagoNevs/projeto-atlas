export const CONFLICT_FINDING_TYPES = [
  'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  'SHARED_IP_DIFFERENT_HOSTNAMES',
  'HOSTNAME_DIVERGENCE_ON_ASSET',
] as const;

export const CONFLICT_SOURCE_TYPES = ['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN'] as const;

export const CONFLICT_TEMPORAL_RELATIONSHIPS = [
  'SAME_OBSERVATION_TIME',
  'DISTINCT_OBSERVATION_TIMES',
  'PARTIAL_TEMPORAL_CONTEXT',
  'NO_TEMPORAL_CONTEXT',
] as const;

export const CONFLICT_REVIEW_OPTIONS = [
  'SAME_ASSET',
  'DIFFERENT_ASSETS',
  'IP_REUSED',
  'HOSTNAME_CHANGED',
  'SOURCE_DATA_INCORRECT',
  'NEEDS_MORE_EVIDENCE',
] as const;

export const CONFLICT_FINDING_SORT_FIELDS = [
  'type',
  'findingId',
  'affectedAssets',
  'observationCount',
  'firstObservedAt',
  'lastObservedAt',
] as const;

export type ConflictFindingType = (typeof CONFLICT_FINDING_TYPES)[number];
export type ConflictSourceType = (typeof CONFLICT_SOURCE_TYPES)[number];
export type ConflictTemporalRelationship = (typeof CONFLICT_TEMPORAL_RELATIONSHIPS)[number];
export type ConflictReviewOption = (typeof CONFLICT_REVIEW_OPTIONS)[number];
export type ConflictFindingSortField = (typeof CONFLICT_FINDING_SORT_FIELDS)[number];
export type ConflictFindingSortDirection = 'asc' | 'desc';
export type ConflictObservationAttribute = 'HOSTNAME' | 'IP_ADDRESS';

export interface ConflictFindingQueryParams {
  page?: number;
  pageSize?: number;
  type?: ConflictFindingType;
  assetId?: string;
  hostname?: string;
  ip?: string;
  sourceType?: ConflictSourceType;
  temporalRelationship?: ConflictTemporalRelationship;
  hasLimitations?: boolean;
  sortBy?: ConflictFindingSortField;
  sortDirection?: ConflictFindingSortDirection;
}

export interface ConflictTemporalContext {
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  differenceMilliseconds: number | null;
  relationship: ConflictTemporalRelationship;
}

export interface ConflictFindingAsset {
  assetId: string;
  persistedName: string;
}

export interface ConflictFindingListItem {
  findingId: string;
  type: ConflictFindingType;
  requiresHumanReview: true;
  affectedAssetIds: string[];
  affectedAssets: ConflictFindingAsset[];
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

export interface ConflictFindingsResponse {
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

export interface ConflictFindingDetail {
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

export interface IdentityNetworkAnalysisResponse {
  assetId: string;
  mode: 'SHADOW';
  policyVersion: string;
  generatedAt: string;
  summary: {
    totalFindings: number;
    requiresHumanReview: number;
  };
  findings: ConflictFindingDetail[];
  limitations: string[];
  decisionsChanged: false;
}

export const DEFAULT_CONFLICT_FINDING_QUERY: Required<
  Pick<ConflictFindingQueryParams, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>
> = {
  page: 1,
  pageSize: 25,
  sortBy: 'type',
  sortDirection: 'asc',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINDING_ID_PATTERN = /^finding_[0-9a-f]{24}$/;

const findingTypeLabels: Record<ConflictFindingType, string> = {
  DUPLICATE_HOSTNAME_ACROSS_ASSETS: 'Hostname associado a ativos diferentes',
  SHARED_IP_DIFFERENT_HOSTNAMES: 'IP associado a hostnames diferentes',
  HOSTNAME_DIVERGENCE_ON_ASSET: 'Hostname divergente no mesmo ativo',
};

const sourceTypeLabels: Record<ConflictSourceType, string> = {
  MANUAL: 'Manual',
  TECHNICAL: 'Técnica',
  SIMULATED: 'Simulada',
  UNKNOWN: 'Desconhecida',
};

const temporalRelationshipLabels: Record<ConflictTemporalRelationship, string> = {
  SAME_OBSERVATION_TIME: 'Mesmo instante de observação',
  DISTINCT_OBSERVATION_TIMES: 'Instantes de observação diferentes',
  PARTIAL_TEMPORAL_CONTEXT: 'Contexto temporal parcial',
  NO_TEMPORAL_CONTEXT: 'Sem contexto temporal',
};

const reviewOptionLabels: Record<ConflictReviewOption, string> = {
  SAME_ASSET: 'Os registros podem representar o mesmo ativo',
  DIFFERENT_ASSETS: 'Os registros podem representar ativos diferentes',
  IP_REUSED: 'O endereço IP pode ter sido reutilizado',
  HOSTNAME_CHANGED: 'O hostname pode ter sido alterado',
  SOURCE_DATA_INCORRECT: 'Uma fonte pode conter dado incorreto',
  NEEDS_MORE_EVIDENCE: 'Podem ser necessárias mais evidências',
};

export function getConflictFindingTypeLabel(value: ConflictFindingType): string {
  return findingTypeLabels[value];
}

export function getConflictSourceTypeLabel(value: ConflictSourceType): string {
  return sourceTypeLabels[value];
}

export function getConflictTemporalRelationshipLabel(
  value: ConflictTemporalRelationship,
): string {
  return temporalRelationshipLabels[value];
}

export function getConflictReviewOptionLabel(value: ConflictReviewOption): string {
  return reviewOptionLabels[value];
}

export function formatTemporalDifference(value: number | null): string {
  if (value === null) return 'Não informado';
  if (value === 0) return '0 minutos';

  const totalMinutes = Math.floor(value / 60_000);
  if (totalMinutes < 1) return 'Menos de 1 minuto';

  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);
  return parts.join(', ');
}

export function serializeConflictFindingQuery(params: ConflictFindingQueryParams): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  return search.toString();
}

export function conflictFindingQueryFromSearchParams(
  input: Record<string, string | string[] | undefined>,
): ConflictFindingQueryParams {
  const value = (key: string): string | undefined => {
    const entry = input[key];
    return Array.isArray(entry) ? entry[0] : entry;
  };
  const positiveInteger = (key: string, maximum?: number): number | undefined => {
    const entry = value(key);
    if (!entry || !/^\d+$/.test(entry)) return undefined;
    const parsed = Number(entry);
    return parsed >= 1 && (!maximum || parsed <= maximum) ? parsed : undefined;
  };
  const type = enumValue(value('type'), CONFLICT_FINDING_TYPES);
  const sourceType = enumValue(value('sourceType'), CONFLICT_SOURCE_TYPES);
  const temporalRelationship = enumValue(
    value('temporalRelationship'),
    CONFLICT_TEMPORAL_RELATIONSHIPS,
  );
  const sortBy = enumValue(value('sortBy'), CONFLICT_FINDING_SORT_FIELDS);
  const sortDirection = enumValue(value('sortDirection'), ['asc', 'desc'] as const);
  const assetIdValue = value('assetId')?.trim();
  const hostname = value('hostname')?.trim();
  const ip = value('ip')?.trim();
  const limitations = value('hasLimitations');

  return {
    page: positiveInteger('page') ?? DEFAULT_CONFLICT_FINDING_QUERY.page,
    pageSize: positiveInteger('pageSize', 100) ?? DEFAULT_CONFLICT_FINDING_QUERY.pageSize,
    type,
    assetId: assetIdValue && UUID_PATTERN.test(assetIdValue) ? assetIdValue : undefined,
    hostname: hostname || undefined,
    ip: ip || undefined,
    sourceType,
    temporalRelationship,
    hasLimitations: limitations === 'true' ? true : limitations === 'false' ? false : undefined,
    sortBy: sortBy ?? DEFAULT_CONFLICT_FINDING_QUERY.sortBy,
    sortDirection: sortDirection ?? DEFAULT_CONFLICT_FINDING_QUERY.sortDirection,
  };
}

export function hasConflictFindingFilters(params: ConflictFindingQueryParams): boolean {
  return Boolean(
    params.type ||
      params.assetId ||
      params.hostname ||
      params.ip ||
      params.sourceType ||
      params.temporalRelationship ||
      params.hasLimitations !== undefined,
  );
}

export function parseConflictFindingsResponse(value: unknown): ConflictFindingsResponse | null {
  const input = record(value);
  if (!input || input.mode !== 'SHADOW' || input.decisionsChanged !== false) return null;

  const policyVersion = nonEmptyString(input.policyVersion);
  const generatedAt = dateString(input.generatedAt);
  const pagination = parsePagination(input.pagination);
  const filters = parseFilters(input.filters);
  const summary = parseSummary(input.summary);
  const items = parseArray(input.items, parseListItem);
  const limitations = stringArray(input.limitations);
  if (!policyVersion || !generatedAt || !pagination || !filters || !summary || !items || !limitations) {
    return null;
  }

  return {
    mode: 'SHADOW',
    policyVersion,
    generatedAt,
    decisionsChanged: false,
    pagination,
    filters,
    summary,
    items,
    limitations,
  };
}

export function parseIdentityNetworkAnalysisResponse(
  value: unknown,
): IdentityNetworkAnalysisResponse | null {
  const input = record(value);
  if (!input || input.mode !== 'SHADOW' || input.decisionsChanged !== false) return null;
  const assetId = uuid(input.assetId);
  const policyVersion = nonEmptyString(input.policyVersion);
  const generatedAt = dateString(input.generatedAt);
  const summaryInput = record(input.summary);
  const totalFindings = summaryInput ? nonNegativeInteger(summaryInput.totalFindings) : null;
  const requiresHumanReview = summaryInput
    ? nonNegativeInteger(summaryInput.requiresHumanReview)
    : null;
  const findings = parseArray(input.findings, parseDetailFinding);
  const limitations = stringArray(input.limitations);
  if (
    !assetId ||
    !policyVersion ||
    !generatedAt ||
    totalFindings === null ||
    requiresHumanReview === null ||
    !findings ||
    !limitations
  ) {
    return null;
  }

  return {
    assetId,
    mode: 'SHADOW',
    policyVersion,
    generatedAt,
    summary: { totalFindings, requiresHumanReview },
    findings,
    limitations,
    decisionsChanged: false,
  };
}

export function isMatchingDetailedFinding(
  item: ConflictFindingListItem,
  detail: ConflictFindingDetail,
): boolean {
  return (
    item.findingId === detail.findingId &&
    item.type === detail.type &&
    item.normalizedHostname === detail.normalizedHostname &&
    item.normalizedIp === detail.normalizedIp &&
    item.temporalContext.relationship === detail.temporalContext.relationship &&
    [...item.affectedAssetIds].sort().join('|') === [...detail.affectedAssetIds].sort().join('|')
  );
}

function parseListItem(value: unknown): ConflictFindingListItem | null {
  const input = record(value);
  if (!input || input.requiresHumanReview !== true) return null;
  const findingId = findingIdValue(input.findingId);
  const type = enumValue(input.type, CONFLICT_FINDING_TYPES);
  const affectedAssetIds = parseArray(input.affectedAssetIds, uuid);
  const affectedAssets = parseArray(input.affectedAssets, parseAffectedAsset);
  const normalizedHostname = nullableString(input.normalizedHostname);
  const normalizedIp = nullableString(input.normalizedIp);
  const temporalContext = parseTemporalContext(input.temporalContext);
  const sourceTypes = parseArray(input.sourceTypes, (entry) =>
    enumValue(entry, CONFLICT_SOURCE_TYPES) ?? null,
  );
  const observationCount = nonNegativeInteger(input.observationCount);
  const currentObservationCount = nonNegativeInteger(input.currentObservationCount);
  const historicalObservationCount = nonNegativeInteger(input.historicalObservationCount);
  const explanationSummary = nonEmptyString(input.explanationSummary);
  const limitationCount = nonNegativeInteger(input.limitationCount);
  const reviewOptions = parseArray(input.reviewOptions, (entry) =>
    enumValue(entry, CONFLICT_REVIEW_OPTIONS) ?? null,
  );
  if (
    !findingId ||
    !type ||
    !affectedAssetIds ||
    affectedAssetIds.length === 0 ||
    !affectedAssets ||
    affectedAssets.length !== affectedAssetIds.length ||
    normalizedHostname === undefined ||
    normalizedIp === undefined ||
    !temporalContext ||
    !sourceTypes ||
    observationCount === null ||
    currentObservationCount === null ||
    historicalObservationCount === null ||
    observationCount !== currentObservationCount + historicalObservationCount ||
    !explanationSummary ||
    limitationCount === null ||
    !reviewOptions
  ) {
    return null;
  }
  if (
    affectedAssets.some(
      (asset) => !affectedAssetIds.includes(asset.assetId),
    )
  ) {
    return null;
  }

  return {
    findingId,
    type,
    requiresHumanReview: true,
    affectedAssetIds,
    affectedAssets,
    normalizedHostname,
    normalizedIp,
    temporalContext,
    sourceTypes,
    observationCount,
    currentObservationCount,
    historicalObservationCount,
    explanationSummary,
    limitationCount,
    reviewOptions,
  };
}

function parseDetailFinding(value: unknown): ConflictFindingDetail | null {
  const input = record(value);
  if (!input || input.mode !== 'SHADOW' || input.requiresHumanReview !== true) return null;
  const findingId = findingIdValue(input.findingId);
  const type = enumValue(input.type, CONFLICT_FINDING_TYPES);
  const affectedAssetIds = parseArray(input.affectedAssetIds, uuid);
  const normalizedHostname = nullableString(input.normalizedHostname);
  const normalizedIp = nullableString(input.normalizedIp);
  const observations = parseArray(input.observations, parseObservation);
  const temporalContext = parseTemporalContext(input.temporalContext);
  const explanation = stringArray(input.explanation);
  const limitations = stringArray(input.limitations);
  const reviewOptions = parseArray(input.reviewOptions, (entry) =>
    enumValue(entry, CONFLICT_REVIEW_OPTIONS) ?? null,
  );
  if (
    !findingId ||
    !type ||
    !affectedAssetIds ||
    affectedAssetIds.length === 0 ||
    normalizedHostname === undefined ||
    normalizedIp === undefined ||
    !observations ||
    !temporalContext ||
    !explanation ||
    !limitations ||
    !reviewOptions
  ) {
    return null;
  }

  return {
    findingId,
    type,
    mode: 'SHADOW',
    requiresHumanReview: true,
    affectedAssetIds,
    normalizedHostname,
    normalizedIp,
    observations,
    temporalContext,
    explanation,
    limitations,
    reviewOptions,
  };
}

function parseObservation(value: unknown): ConflictObservation | null {
  const input = record(value);
  if (!input) return null;
  const assetId = uuid(input.assetId);
  const originalValue = typeof input.value === 'string' ? input.value : null;
  const normalizedValue = typeof input.normalizedValue === 'string' ? input.normalizedValue : null;
  const attribute = enumValue(input.attribute, ['HOSTNAME', 'IP_ADDRESS'] as const);
  const source = nonEmptyString(input.source);
  const sourceType = enumValue(input.sourceType, CONFLICT_SOURCE_TYPES);
  const evidenceId = nullableNonEmptyString(input.evidenceId);
  const observedAt = nullableDateString(input.observedAt);
  const ingestedAt = nullableDateString(input.ingestedAt);
  if (
    !assetId ||
    originalValue === null ||
    normalizedValue === null ||
    !attribute ||
    !source ||
    !sourceType ||
    evidenceId === undefined ||
    observedAt === undefined ||
    ingestedAt === undefined ||
    typeof input.current !== 'boolean'
  ) {
    return null;
  }

  return {
    assetId,
    value: originalValue,
    normalizedValue,
    attribute,
    source,
    sourceType,
    evidenceId,
    observedAt,
    ingestedAt,
    current: input.current,
  };
}

function parseAffectedAsset(value: unknown): ConflictFindingAsset | null {
  const input = record(value);
  if (!input) return null;
  const assetId = uuid(input.assetId);
  const persistedName = nonEmptyString(input.persistedName);
  return assetId && persistedName ? { assetId, persistedName } : null;
}

function parseTemporalContext(value: unknown): ConflictTemporalContext | null {
  const input = record(value);
  if (!input) return null;
  const firstObservedAt = nullableDateString(input.firstObservedAt);
  const lastObservedAt = nullableDateString(input.lastObservedAt);
  const differenceMilliseconds = nullableNonNegativeNumber(input.differenceMilliseconds);
  const relationship = enumValue(input.relationship, CONFLICT_TEMPORAL_RELATIONSHIPS);
  if (
    firstObservedAt === undefined ||
    lastObservedAt === undefined ||
    differenceMilliseconds === undefined ||
    !relationship
  ) {
    return null;
  }
  return { firstObservedAt, lastObservedAt, differenceMilliseconds, relationship };
}

function parsePagination(value: unknown): ConflictFindingsResponse['pagination'] | null {
  const input = record(value);
  if (!input) return null;
  const page = positiveInteger(input.page);
  const pageSize = positiveInteger(input.pageSize);
  const totalItems = nonNegativeInteger(input.totalItems);
  const totalPages = nonNegativeInteger(input.totalPages);
  if (
    page === null ||
    pageSize === null ||
    pageSize > 100 ||
    totalItems === null ||
    totalPages === null ||
    typeof input.hasNextPage !== 'boolean' ||
    typeof input.hasPreviousPage !== 'boolean'
  ) {
    return null;
  }
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: input.hasNextPage,
    hasPreviousPage: input.hasPreviousPage,
  };
}

function parseFilters(value: unknown): ConflictFindingsResponse['filters'] | null {
  const input = record(value);
  if (!input) return null;
  const type = nullableEnum(input.type, CONFLICT_FINDING_TYPES);
  const assetId = nullableUuid(input.assetId);
  const hostname = nullableString(input.hostname);
  const ip = nullableString(input.ip);
  const sourceType = nullableEnum(input.sourceType, CONFLICT_SOURCE_TYPES);
  const temporalRelationship = nullableEnum(
    input.temporalRelationship,
    CONFLICT_TEMPORAL_RELATIONSHIPS,
  );
  const hasLimitations = nullableBoolean(input.hasLimitations);
  if (
    type === undefined ||
    assetId === undefined ||
    hostname === undefined ||
    ip === undefined ||
    sourceType === undefined ||
    temporalRelationship === undefined ||
    hasLimitations === undefined
  ) {
    return null;
  }
  return { type, assetId, hostname, ip, sourceType, temporalRelationship, hasLimitations };
}

function parseSummary(value: unknown): ConflictFindingsResponse['summary'] | null {
  const input = record(value);
  const byTypeInput = input ? record(input.byType) : null;
  if (!input || !byTypeInput) return null;
  const totalFindings = nonNegativeInteger(input.totalFindings);
  const affectedAssets = nonNegativeInteger(input.affectedAssets);
  const findingsWithLimitations = nonNegativeInteger(input.findingsWithLimitations);
  const byType = {} as Record<ConflictFindingType, number>;
  for (const type of CONFLICT_FINDING_TYPES) {
    const count = nonNegativeInteger(byTypeInput[type]);
    if (count === null) return null;
    byType[type] = count;
  }
  if (totalFindings === null || affectedAssets === null || findingsWithLimitations === null) {
    return null;
  }
  return { totalFindings, byType, affectedAssets, findingsWithLimitations };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseArray<T>(value: unknown, parser: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const entry of value) {
    const parsed = parser(entry);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

function enumValue<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : undefined;
}

function nullableEnum<T extends string>(
  value: unknown,
  options: readonly T[],
): T | null | undefined {
  return value === null ? null : enumValue(value, options);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | null {
  return parseArray(value, (entry) => (typeof entry === 'string' ? entry : null));
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' ? value : undefined;
}

function nullableNonEmptyString(value: unknown): string | null | undefined {
  return value === null ? null : nonEmptyString(value) ?? undefined;
}

function dateString(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;
}

function nullableDateString(value: unknown): string | null | undefined {
  return value === null ? null : dateString(value) ?? undefined;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  return value === null
    ? null
    : typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  return value === null ? null : typeof value === 'boolean' ? value : undefined;
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function nullableUuid(value: unknown): string | null | undefined {
  return value === null ? null : uuid(value) ?? undefined;
}

function findingIdValue(value: unknown): string | null {
  return typeof value === 'string' && FINDING_ID_PATTERN.test(value) ? value : null;
}
