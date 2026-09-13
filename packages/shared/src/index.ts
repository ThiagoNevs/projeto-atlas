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

import permissionRegistry from '../permissions.json' with { type: 'json' };

export const ATLAS_PERMISSIONS = permissionRegistry as {
  readonly access: 'atlas:access';
  readonly inventoryRead: 'inventory:read';
  readonly inventoryMaintain: 'inventory:maintain';
  readonly inventoryStatusUpdate: 'inventory:status:update';
  readonly inventoryImport: 'inventory:import';
  readonly inventoryExport: 'inventory:export';
  readonly analysisRead: 'analysis:read';
  readonly conflictRead: 'conflict:read';
  readonly conflictManage: 'conflict:manage';
  readonly reviewCaseRead: 'review-case:read';
  readonly reviewCaseManage: 'review-case:manage';
  readonly discoveryRead: 'discovery:read';
  readonly discoveryConfigure: 'discovery:configure';
  readonly discoveryExecute: 'discovery:execute';
  readonly ingestionExecute: 'ingestion:execute';
  readonly auditRead: 'audit:read';
};

export type AtlasPermission = (typeof ATLAS_PERMISSIONS)[keyof typeof ATLAS_PERMISSIONS];

export const ATLAS_PERMISSION_VALUES = Object.freeze(
  Object.values(ATLAS_PERMISSIONS) as AtlasPermission[],
);

const ATLAS_PERMISSION_SET: ReadonlySet<string> = new Set(ATLAS_PERMISSION_VALUES);

export function isAtlasPermission(value: unknown): value is AtlasPermission {
  return typeof value === 'string' && ATLAS_PERMISSION_SET.has(value);
}
