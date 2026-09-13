import { Controller, Get } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from './permissions';

import { CurrentActor as Actor } from './current-actor.decorator';
import type { CurrentActor } from './auth.types';
import { RequirePermissions } from './require-permissions.decorator';

@Controller('auth')
export class AuthController {
  @Get('me')
  @RequirePermissions(ATLAS_PERMISSIONS.access)
  me(@Actor() actor: CurrentActor) {
    return {
      id: actor.id,
      kind: actor.kind,
      ...(actor.displayName ? { displayName: actor.displayName } : {}),
      permissions: [...actor.permissions].sort(),
    };
  }
}
