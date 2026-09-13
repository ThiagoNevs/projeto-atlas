import type { AtlasPermission } from '@atlas/shared';

import { ATLAS_PERMISSIONS } from './permissions';

export const ATLAS_ACCESS_PERMISSION = ATLAS_PERMISSIONS.access;
export type { AtlasPermission } from '@atlas/shared';
export type ActorKind = 'HUMAN' | 'SERVICE' | 'SYSTEM';

export interface CurrentActor {
  id: string;
  kind: ActorKind;
  permissions: ReadonlySet<AtlasPermission>;
  displayName?: string;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  currentActor?: CurrentActor;
}

export function auditActorType(actor: CurrentActor): 'USER' | 'SERVICE' | 'SYSTEM' {
  if (actor.kind === 'HUMAN') return 'USER';
  return actor.kind;
}

export function createSystemActor(component: string): CurrentActor {
  if (!/^[a-z0-9-]+$/.test(component)) {
    throw new Error('O componente do ator sistêmico é inválido.');
  }
  return {
    id: `system:atlas:${component}`,
    kind: 'SYSTEM',
    permissions: new Set<AtlasPermission>(),
  };
}
