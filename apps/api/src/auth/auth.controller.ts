import { Controller, Get } from '@nestjs/common';

import { CurrentActor as Actor } from './current-actor.decorator';
import type { CurrentActor } from './auth.types';

@Controller('auth')
export class AuthController {
  @Get('me')
  me(@Actor() actor: CurrentActor) {
    return {
      id: actor.id,
      kind: actor.kind,
      ...(actor.displayName ? { displayName: actor.displayName } : {}),
      permissions: [...actor.permissions].sort(),
    };
  }
}
