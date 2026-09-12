import { SetMetadata } from '@nestjs/common';
import type { AtlasPermission } from '@atlas/shared';

export const REQUIRED_PERMISSIONS = Symbol('atlas.required-permissions');

export function RequirePermissions(...permissions: readonly AtlasPermission[]): MethodDecorator {
  if (permissions.length === 0) {
    throw new Error('RequirePermissions exige pelo menos uma permission explícita.');
  }
  return SetMetadata(REQUIRED_PERMISSIONS, Object.freeze([...permissions]));
}
