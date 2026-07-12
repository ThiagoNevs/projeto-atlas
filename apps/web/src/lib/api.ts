const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const API_URL = configuredApiUrl.replace(/\/$/, '');

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

export type ConflictStatus =
  'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'IGNORED' | 'EXCEPTION' | 'DISMISSED';

export interface AssetSummary {
  id: string;
  atlasId: string;
  canonicalKey: string | null;
  name: string;
  type: string;
  operationalStatus: OperationalStatus;
  administrativeStatus: AdministrativeStatus;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  primaryIp: string | null;
  primaryMac: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
  eventCount: number;
}

export interface AssetAttribute {
  id: string;
  key: string;
  value: unknown;
  valueText: string | null;
  valueType: string;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  observedAt: string;
  lastConfirmedAt: string;
  confirmationCount: number;
}

export interface NetworkInterface {
  id: string;
  name: string;
  macAddress: string | null;
  ipAddresses: string[];
  interfaceIndex: number | null;
  isPrimary: boolean;
  isCurrent: boolean;
  observedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AssetConflict {
  id: string;
  conflictType: string;
  attributeKey: string;
  status: ConflictStatus;
  severity: number;
  impact: string | null;
  suggestedValue: string | null;
  suggestionReason: string | null;
  detectedAt: string;
  lastDetectedAt: string | null;
  occurrenceCount: number;
}

export interface ConflictSummary {
  id: string;
  type: string;
  field: string;
  status: ConflictStatus;
  impact: string | null;
  assetId: string;
  assetName: string;
  administrativeStatus: AdministrativeStatus;
  occurrenceCount: number;
  suggestionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AssetQueryParams {
  search?: string;
  operationalStatus?: OperationalStatus;
  administrativeStatus?: AdministrativeStatus;
  type?: string;
  minConfidenceScore?: number;
  maxConfidenceScore?: number;
  minDataQualityScore?: number;
  maxDataQualityScore?: number;
  page?: number;
  pageSize?: number;
  sortBy?:
    | 'name'
    | 'lastSeenAt'
    | 'confidenceScore'
    | 'dataQualityScore'
    | 'evidenceCount'
    | 'eventCount'
    | 'createdAt'
    | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
}

export interface ConflictQueryParams {
  search?: string;
  status?: ConflictStatus;
  impact?: string;
  type?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'updatedAt' | 'createdAt' | 'occurrenceCount' | 'impact' | 'status';
  sortDirection?: 'asc' | 'desc';
}

export type NetworkDiscoveryMode = 'PASSIVE' | 'LIGHT' | 'CONTROLLED';
export type NetworkDiscoveryMethod = 'ICMP_SIMULATED' | 'DNS_REVERSE_SIMULATED' | 'ARP_SIMULATED';
export type NetworkDiscoveryRunStatus =
  'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type NetworkDiscoveryResultStatus = 'DISCOVERED' | 'UPDATED' | 'SKIPPED' | 'ERROR';

export type DataSourceStatus = 'AVAILABLE' | 'PLANNED' | 'FUTURE';

export interface DataSourceItem {
  id: string;
  name: string;
  category: string;
  status: DataSourceStatus;
  description: string;
  evidenceType: string | null;
  current: boolean;
}

export interface DataSourcesResponse {
  items: DataSourceItem[];
  summary: {
    available: number;
    planned: number;
    future: number;
    total: number;
  };
}

export interface NetworkDiscoveryProfile {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  mode: NetworkDiscoveryMode;
  allowedCidrs: string[];
  deniedCidrs: string[];
  rateLimitPerMinute: number;
  scheduleEnabled: boolean;
  scheduleExpression: string | null;
  methods: NetworkDiscoveryMethod[];
  createdAt: string;
  updatedAt: string;
  _count?: { runs: number };
}

export interface CreateNetworkDiscoveryProfilePayload {
  name: string;
  description?: string;
  enabled: boolean;
  mode: NetworkDiscoveryMode;
  allowedCidrs: string[];
  deniedCidrs?: string[];
  rateLimitPerMinute: number;
  methods: NetworkDiscoveryMethod[];
  scheduleEnabled?: boolean;
}

export interface NetworkDiscoveryRun {
  id: string;
  profileId: string;
  status: NetworkDiscoveryRunStatus;
  startedAt: string;
  finishedAt: string | null;
  totalTargets: number;
  discoveredCount: number;
  updatedAssetCount: number;
  createdAssetCount: number;
  skippedCount: number;
  errorCount: number;
  summary: unknown;
  createdAt: string;
  updatedAt: string;
  profile: Pick<NetworkDiscoveryProfile, 'id' | 'name' | 'mode'>;
}

export interface NetworkDiscoveryResult {
  id: string;
  assetId: string | null;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  source: string;
  method: NetworkDiscoveryMethod;
  confidenceScore: number | null;
  status: NetworkDiscoveryResultStatus;
  raw: unknown;
  createdAt: string;
  asset: { id: string; name: string; canonicalKey: string | null } | null;
}

export interface NetworkDiscoveryRunDetail extends NetworkDiscoveryRun {
  profile: NetworkDiscoveryProfile;
  results: NetworkDiscoveryResult[];
}

export interface DashboardSummary {
  assets: {
    total: number;
    seenRecently: number;
    lowDataQuality: number;
    lowConfidence: number;
    administrativelyClosed: number;
    byAdministrativeStatus: Record<string, number>;
    byOperationalStatus: Record<string, number>;
    byType: Record<string, number>;
    byOperatingSystem: Record<string, number>;
    byOperatingSystemVersion: Record<string, number>;
  };
  inventoryHealth: {
    attentionSignals: {
      obsoleteOperatingSystems: number;
      staleAssets45Days: number;
      lowConfidence: number;
      incompleteData: number;
      reappearedClosedAssets: number;
      items: Array<{
        type:
          | 'OBSOLETE_OPERATING_SYSTEM'
          | 'STALE_ASSET_45_DAYS'
          | 'LOW_CONFIDENCE'
          | 'INCOMPLETE_DATA'
          | 'REAPPEARED_CLOSED_ASSET';
        label: string;
        description: string;
        count: number;
        severity: 'medium' | 'high';
        href: string;
      }>;
    };
  };
  conflicts: {
    totalOpen: number;
    inReview: number;
    highImpact: number;
    criticalImpact: number;
    lifecycleConflicts: number;
  };
  networkDiscovery: {
    totalRuns: number;
    lastRunStatus: NetworkDiscoveryRunStatus | null;
    lastRunAt: string | null;
    lastRunDiscoveredCount: number;
    lastRunCreatedAssetCount: number;
    lastRunUpdatedAssetCount: number;
  };
  recentActivity: Array<{
    id: string;
    assetId: string;
    assetName: string;
    eventType: string;
    title: string;
    occurredAt: string;
  }>;
  recommendedActions: Array<{
    id: string;
    title: string;
    description: string;
    href: string;
    count: number | null;
  }>;
}

export interface AuditLogRecord {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  occurredAt: string;
}

export interface AuditLogQueryParams {
  search?: string;
  action?: string;
  actorType?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'occurredAt' | 'action' | 'entityType' | 'actorType';
  sortDirection?: 'asc' | 'desc';
}

export interface AuditLogResponse extends PaginatedResponse<AuditLogRecord> {
  summary: {
    total: number;
    administrativeChanges: number;
    conflictTreatments: number;
    discoveryExecutions: number;
    failuresOrRejections: number;
  };
}

export type DataQualityIssue =
  | 'LOW_DATA_QUALITY'
  | 'LOW_CONFIDENCE'
  | 'MISSING_SERIAL_NUMBER'
  | 'MISSING_MANUFACTURER'
  | 'MISSING_MODEL'
  | 'MISSING_OPERATING_SYSTEM'
  | 'MISSING_NETWORK_INFO'
  | 'MISSING_ADMINISTRATIVE_STATUS'
  | 'WITHOUT_RECENT_EVIDENCE';

export interface DataQualitySummary {
  totalAssets: number;
  lowDataQuality: number;
  lowConfidence: number;
  missingSerialNumber: number;
  missingManufacturer: number;
  missingModel: number;
  missingOperatingSystem: number;
  missingNetworkInfo: number;
  missingAdministrativeStatus: number;
  assetsWithoutRecentEvidence: number;
  averageDataQualityScore: number;
  averageConfidenceScore: number;
}

export interface DataQualityAsset {
  atlasId: string;
  id: string;
  name: string;
  hostname: string;
  type: string;
  administrativeStatus: AdministrativeStatus;
  operationalStatus: OperationalStatus;
  dataQualityScore: number | null;
  confidenceScore: number | null;
  lastSeenAt: string | null;
  issues: DataQualityIssue[];
  missingFields: string[];
  primaryIp: string | null;
  primaryMac: string | null;
  operatingSystem: string | null;
  operatingSystemVersion: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  scoreAnalysis: {
    quality: ScoreAnalysis;
    confidence: ScoreAnalysis;
  };
}

export interface ScoreFactor {
  code: string;
  label: string;
  description: string;
  impact: 'positive' | 'negative';
  evidenceIds: string[];
}

export interface ScoreRelatedEvidence {
  id: string;
  source: string;
  evidenceType: string;
  observedAt: string;
  confidenceScore: number | null;
  dataQualityScore: number | null;
}

export interface ScoreAnalysis {
  metric: string;
  score: number | null;
  note: string;
  positiveFactors: ScoreFactor[];
  negativeFactors: ScoreFactor[];
  relatedEvidence: ScoreRelatedEvidence[];
}

export interface DataQualityQueryParams {
  search?: string;
  issue?: DataQualityIssue;
  type?: string;
  administrativeStatus?: AdministrativeStatus;
  operationalStatus?: OperationalStatus;
  minDataQualityScore?: number;
  maxDataQualityScore?: number;
  minConfidenceScore?: number;
  maxConfidenceScore?: number;
  page?: number;
  pageSize?: number;
  sortBy?: 'dataQualityScore' | 'confidenceScore' | 'lastSeenAt' | 'name' | 'type';
  sortDirection?: 'asc' | 'desc';
}

export interface ConflictDetail {
  conflict: {
    id: string;
    type: string;
    field: string;
    status: ConflictStatus;
    impact: string | null;
    severity: number;
    occurrenceCount: number;
    suggestedValue: string | null;
    suggestionReason: string | null;
    detectedAt: string;
    lastDetectedAt: string | null;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  asset: {
    id: string;
    canonicalKey: string | null;
    name: string;
    type: string;
    operationalStatus: OperationalStatus;
    administrativeStatus: AdministrativeStatus;
    lastSeenAt: string | null;
    updatedAt: string;
  };
  values: Array<{
    id: string;
    evidenceId: string | null;
    value: unknown;
    normalizedValue: string | null;
    source: string;
    observedAt: string | null;
    createdAt: string;
  }>;
  metadata: Record<string, unknown>;
  timeline: AssetTimelineEvent[];
}

export interface UpdateConflictStatusPayload {
  status: ConflictStatus;
  reason: string;
  comment: string;
}

export interface UpdateConflictStatusResponse {
  conflict: ConflictSummary;
  previousStatus: ConflictStatus;
  status: ConflictStatus;
  eventId: string;
  auditLogId: string;
}

export interface AssetDetail extends AssetSummary {
  description: string | null;
  attributes: AssetAttribute[];
  networkInterfaces: NetworkInterface[];
  conflicts: AssetConflict[];
}

export interface AssetEvidence {
  id: string;
  source: string;
  sourceRecordId: string | null;
  evidenceType: string;
  payload: unknown;
  fingerprint: string | null;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  observedAt: string;
  ingestedAt: string;
}

export interface AssetTimelineEvent {
  id: string;
  evidenceId: string | null;
  eventType: string;
  title: string;
  description: string | null;
  data: unknown;
  occurredAt: string;
  recordedAt: string;
}

export interface UpdateAdministrativeStatusPayload {
  administrativeStatus: AdministrativeStatus;
  reason: string;
  comment: string;
}

export interface UpdateAdministrativeStatusResponse {
  asset: AssetDetail;
  previousStatus: AdministrativeStatus;
  administrativeStatus: AdministrativeStatus;
  eventId: string;
  auditLogId: string;
}

export type ManualIdentifierType =
  'HOSTNAME' | 'SERIAL_NUMBER' | 'ASSET_TAG' | 'MAC_ADDRESS' | 'INTERNAL_NAME';

export interface CreateManualAssetPayload {
  identifier: string;
  identifierType: ManualIdentifierType;
  type: string;
  administrativeStatus: AdministrativeStatus;
  reason: string;
  hostname?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  operatingSystem?: string;
  osVersion?: string;
  location?: string;
  owner?: string;
  department?: string;
  environment?: string;
  criticality?: string;
  comment?: string;
}

export interface CreateManualAssetResponse {
  asset: AssetDetail;
  evidenceId: string;
  eventId: string;
  auditLogId: string;
}

export interface ImportAssetsCsvPayload {
  csv: string;
}

export interface ImportAssetsCsvWarning {
  line: number;
  rowNumber?: number;
  field: string;
  code?: string;
  message: string;
  relatedAssets?: ImportAssetReference[];
}

export interface ImportAssetReference {
  id: string;
  hostname: string;
  primaryIp: string | null;
}

export type ImportPreviewRowStatus =
  | 'VALID'
  | 'INVALID'
  | 'DUPLICATE'
  | 'VALID_WITH_WARNINGS';

export interface ImportPreviewRow {
  rowNumber: number;
  hostname: string;
  ipAddress: string;
  status: ImportPreviewRowStatus;
  errors: ImportAssetsCsvWarning[];
  warnings: ImportAssetsCsvWarning[];
  existingAsset?: ImportAssetReference;
}

export interface ImportAssetsPreviewResponse {
  format: 'CSV' | 'PASTED' | 'XLSX' | 'XLSM';
  fileName?: string;
  summary: {
    total: number;
    valid: number;
    duplicates: number;
    invalid: number;
    warnings: number;
  };
  rows: ImportPreviewRow[];
}

export interface ImportAssetsCsvResponse {
  processedCount: number;
  importedCount: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errors: ImportAssetsCsvWarning[];
  format: 'CSV' | 'PASTED' | 'XLSX' | 'XLSM';
  warningCount: number;
  warnings: ImportAssetsCsvWarning[];
  assets: AssetDetail[];
  summary: {
    total: number;
    created: number;
    skipped: number;
    invalid: number;
    failed: number;
    warnings: number;
  };
  createdAssets: AssetDetail[];
  skippedRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    reason: string;
    existingAssetId: string | null;
  }>;
  invalidRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    errors: ImportAssetsCsvWarning[];
  }>;
  failedRows: Array<{
    rowNumber: number;
    hostname: string;
    ipAddress: string;
    reason: string;
  }>;
}

export interface ManualEnrichmentAttributes {
  operatingSystem?: string;
  osVersion?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  location?: string;
  owner?: string;
  department?: string;
  environment?: string;
  criticality?: string;
  comment?: string;
}

export interface ManualEnrichmentPayload {
  reason: string;
  comment?: string;
  attributes: ManualEnrichmentAttributes;
}

export interface ManualEnrichmentResponse {
  asset: AssetDetail;
  createdAttributes: string[];
  confirmedAttributes: string[];
  evidenceId: string;
  eventId: string;
  auditLogId: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  let message =
    response.status === 404
      ? 'O recurso solicitado não foi encontrado.'
      : 'Não foi possível concluir a solicitação.';

  try {
    const errorBody = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(errorBody.message)) message = errorBody.message.join(' ');
    else if (errorBody.message) message = errorBody.message;
  } catch {
    // Keep the controlled fallback when the API does not return JSON.
  }

  return message;
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Accept: 'application/json', ...init.headers },
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  const body: unknown = await response.json();
  return body as T;
}

function queryString(params: object): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') searchParams.set(key, String(value));
  });

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : '';
}

export function getAssets(params: AssetQueryParams = {}): Promise<PaginatedResponse<AssetSummary>> {
  return fetchJson(`/assets${queryString(params)}`);
}

export function getAsset(id: string): Promise<AssetDetail> {
  return fetchJson(`/assets/${encodeURIComponent(id)}`);
}

export function getAssetEvidences(id: string): Promise<AssetEvidence[]> {
  return fetchJson(`/assets/${encodeURIComponent(id)}/evidences`);
}

export function getAssetTimeline(id: string): Promise<AssetTimelineEvent[]> {
  return fetchJson(`/assets/${encodeURIComponent(id)}/timeline`);
}

export function updateAdministrativeStatus(
  id: string,
  payload: UpdateAdministrativeStatusPayload,
): Promise<UpdateAdministrativeStatusResponse> {
  return fetchJson(`/assets/${encodeURIComponent(id)}/administrative-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function createManualAsset(
  payload: CreateManualAssetPayload,
): Promise<CreateManualAssetResponse> {
  return fetchJson('/assets/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function importAssetsCsv(payload: ImportAssetsCsvPayload): Promise<ImportAssetsCsvResponse> {
  return fetchJson('/assets/import/csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function importAssetsSpreadsheet(file: File): Promise<ImportAssetsCsvResponse> {
  const form = new FormData();
  form.append('file', file);
  return fetchJson('/assets/import/spreadsheet', {
    method: 'POST',
    body: form,
  });
}

export function previewAssetsCsv(payload: ImportAssetsCsvPayload): Promise<ImportAssetsPreviewResponse> {
  return fetchJson('/assets/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function previewAssetsSpreadsheet(file: File): Promise<ImportAssetsPreviewResponse> {
  const form = new FormData();
  form.append('file', file);
  return fetchJson('/assets/import/preview/spreadsheet', {
    method: 'POST',
    body: form,
  });
}

export function commitAssetsCsv(payload: ImportAssetsCsvPayload): Promise<ImportAssetsCsvResponse> {
  return fetchJson('/assets/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function commitAssetsSpreadsheet(file: File): Promise<ImportAssetsCsvResponse> {
  const form = new FormData();
  form.append('file', file);
  return fetchJson('/assets/import/commit/spreadsheet', {
    method: 'POST',
    body: form,
  });
}

export function enrichAssetManually(
  id: string,
  payload: ManualEnrichmentPayload,
): Promise<ManualEnrichmentResponse> {
  return fetchJson(`/assets/${encodeURIComponent(id)}/manual-enrichment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getConflicts(
  params: ConflictQueryParams = {},
): Promise<PaginatedResponse<ConflictSummary>> {
  return fetchJson(`/conflicts${queryString(params)}`);
}

export function getConflict(id: string): Promise<ConflictDetail> {
  return fetchJson(`/conflicts/${encodeURIComponent(id)}`);
}

export function updateConflictStatus(
  id: string,
  payload: UpdateConflictStatusPayload,
): Promise<UpdateConflictStatusResponse> {
  return fetchJson(`/conflicts/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getNetworkDiscoveryProfiles(): Promise<NetworkDiscoveryProfile[]> {
  return fetchJson('/network-discovery/profiles');
}

export function createNetworkDiscoveryProfile(
  payload: CreateNetworkDiscoveryProfilePayload,
): Promise<NetworkDiscoveryProfile> {
  return fetchJson('/network-discovery/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getNetworkDiscoveryRuns(): Promise<NetworkDiscoveryRun[]> {
  return fetchJson('/network-discovery/runs');
}

export function getNetworkDiscoveryRun(id: string): Promise<NetworkDiscoveryRunDetail> {
  return fetchJson(`/network-discovery/runs/${encodeURIComponent(id)}`);
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return fetchJson('/dashboard/summary');
}

export function getAuditLogs(params: AuditLogQueryParams = {}): Promise<AuditLogResponse> {
  return fetchJson(`/audit-logs${queryString(params)}`);
}

export function getAuditLog(id: string): Promise<AuditLogRecord> {
  return fetchJson(`/audit-logs/${encodeURIComponent(id)}`);
}

export function getDataQualitySummary(): Promise<DataQualitySummary> {
  return fetchJson('/data-quality/summary');
}

export function getDataQualityAssets(
  params: DataQualityQueryParams = {},
): Promise<PaginatedResponse<DataQualityAsset>> {
  return fetchJson(`/data-quality/assets${queryString(params)}`);
}

export async function exportDataQualityAssetsCsv(
  params: DataQualityQueryParams = {},
): Promise<void> {
  const exportParams = { ...params };
  delete exportParams.page;
  delete exportParams.pageSize;
  const response = await fetch(
    `${API_URL}/data-quality/assets/export${queryString(exportParams)}`,
    {
      cache: 'no-store',
      headers: { Accept: 'text/csv' },
    },
  );

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'atlas-qualidade-dos-dados.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function getDataSources(): Promise<DataSourcesResponse> {
  return fetchJson('/data-sources');
}

export function runNetworkDiscoveryProfile(id: string): Promise<NetworkDiscoveryRunDetail> {
  return fetchJson(`/network-discovery/profiles/${encodeURIComponent(id)}/run`, {
    method: 'POST',
  });
}
