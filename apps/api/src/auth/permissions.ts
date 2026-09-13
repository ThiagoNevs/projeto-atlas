import permissionRegistry from '@atlas/shared/permissions.json';
import type { ATLAS_PERMISSIONS as AtlasPermissions } from '@atlas/shared';

export const ATLAS_PERMISSIONS = permissionRegistry as typeof AtlasPermissions;
