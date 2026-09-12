import { createHash } from 'node:crypto';

import type { ActorKind } from './auth.types';

export function oidcActorId(
  kind: Extract<ActorKind, 'HUMAN' | 'SERVICE'>,
  issuer: string,
  subject: string,
): string {
  const canonicalPrincipal = JSON.stringify({ issuer, subject });
  const digest = createHash('sha256').update(canonicalPrincipal, 'utf8').digest('base64url');
  return `${kind.toLowerCase()}:oidc:v1:${digest}`;
}
