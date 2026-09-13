import type { AtlasPermission } from '@atlas/shared';

import { ATLAS_PERMISSIONS } from './permissions';

export const ATLAS_ROLES = ['VIEWER', 'ANALYST', 'ADMIN'] as const;
export type AtlasRole = (typeof ATLAS_ROLES)[number];

const VIEWER_PERMISSIONS = [
  ATLAS_PERMISSIONS.inventoryRead,
  ATLAS_PERMISSIONS.analysisRead,
  ATLAS_PERMISSIONS.conflictRead,
  ATLAS_PERMISSIONS.reviewCaseRead,
  ATLAS_PERMISSIONS.discoveryRead,
] as const;

const ANALYST_PERMISSIONS = [
  ...VIEWER_PERMISSIONS,
  ATLAS_PERMISSIONS.inventoryMaintain,
  ATLAS_PERMISSIONS.inventoryExport,
  ATLAS_PERMISSIONS.conflictManage,
  ATLAS_PERMISSIONS.reviewCaseManage,
  ATLAS_PERMISSIONS.discoveryExecute,
  ATLAS_PERMISSIONS.auditRead,
] as const;

export const ROLE_PERMISSIONS: Readonly<Record<AtlasRole, readonly AtlasPermission[]>> = {
  VIEWER: VIEWER_PERMISSIONS,
  ANALYST: ANALYST_PERMISSIONS,
  ADMIN: [
    ...ANALYST_PERMISSIONS,
    ATLAS_PERMISSIONS.inventoryStatusUpdate,
    ATLAS_PERMISSIONS.inventoryImport,
    ATLAS_PERMISSIONS.discoveryConfigure,
    ATLAS_PERMISSIONS.ingestionExecute,
  ],
};

export function createExternalRoleMapping(
  valuesByRole: Readonly<Record<AtlasRole, readonly string[]>>,
  accessValues: readonly string[],
): ReadonlyMap<string, AtlasRole> {
  const owners = new Map<string, AtlasRole | 'ACCESS'>();
  const mapping = new Map<string, AtlasRole>();

  function register(value: string, owner: AtlasRole | 'ACCESS'): void {
    const existing = owners.get(value);
    if (existing) {
      throw new Error(
        `O valor externo de autorização ${JSON.stringify(value)} está configurado para ${existing} e ${owner}.`,
      );
    }
    owners.set(value, owner);
  }

  for (const value of accessValues) register(value, 'ACCESS');
  for (const role of ATLAS_ROLES) {
    for (const value of valuesByRole[role]) {
      register(value, role);
      mapping.set(value, role);
    }
  }
  return mapping;
}

export function permissionsForExternalRoles(
  values: readonly string[],
  mapping: ReadonlyMap<string, AtlasRole>,
): ReadonlySet<AtlasPermission> {
  const permissions = new Set<AtlasPermission>();
  for (const value of values) {
    const role = mapping.get(value);
    if (!role) continue;
    for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission);
  }
  return permissions;
}
