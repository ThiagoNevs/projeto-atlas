import { ATLAS_PERMISSIONS, isAtlasPermission, type AtlasPermission } from '@atlas/shared';

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated' | 'error';
export type ActorKind = 'HUMAN' | 'SERVICE' | 'SYSTEM';

export interface AuthenticatedActor {
  id: string;
  kind: ActorKind;
  displayName?: string;
  permissions: AtlasPermission[];
}

export function parseAuthenticatedActor(value: unknown): AuthenticatedActor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort().join(',');
  if (keys !== 'id,kind,permissions' && keys !== 'displayName,id,kind,permissions') return null;
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length < 1 ||
    candidate.id.length > 100 ||
    !['HUMAN', 'SERVICE', 'SYSTEM'].includes(String(candidate.kind)) ||
    !Array.isArray(candidate.permissions) ||
    !candidate.permissions.every((permission) => typeof permission === 'string') ||
    (candidate.displayName !== undefined && typeof candidate.displayName !== 'string')
  )
    return null;
  const permissions = candidate.permissions.filter(isAtlasPermission);
  if (
    new Set(permissions).size !== permissions.length ||
    !permissions.includes(ATLAS_PERMISSIONS.access)
  )
    return null;
  return {
    id: candidate.id,
    kind: candidate.kind as ActorKind,
    ...(candidate.displayName !== undefined ? { displayName: candidate.displayName } : {}),
    permissions,
  };
}

export function hasPermission(
  actor: AuthenticatedActor | null,
  permission: AtlasPermission,
): boolean {
  return actor?.permissions.includes(permission) ?? false;
}

export function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return fallback;
  try {
    const parsed = new URL(value, 'https://atlas.invalid');
    if (parsed.origin !== 'https://atlas.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
