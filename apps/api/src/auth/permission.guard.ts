import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AtlasPermission } from '@atlas/shared';

import type { AuthenticatedRequest } from './auth.types';
import { PUBLIC_ROUTE } from './public.decorator';
import { REQUIRED_PERMISSIONS } from './require-permissions.decorator';

interface AuthorizationRequest extends AuthenticatedRequest {
  method?: string;
  route?: { path?: string };
}

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    if (this.reflector.get<boolean>(PUBLIC_ROUTE, handler)) return true;

    const request = context.switchToHttp().getRequest<AuthorizationRequest>();
    const required = this.reflector.get<readonly AtlasPermission[]>(REQUIRED_PERMISSIONS, handler);
    if (!required?.length) {
      this.logger.error(
        JSON.stringify({
          event: 'AUTHORIZATION_POLICY_MISSING',
          method: request.method ?? 'UNKNOWN',
          route: request.route?.path ?? 'unknown',
          actorId: request.currentActor?.id,
        }),
      );
      throw insufficientPermission();
    }

    const permissions = request.currentActor?.permissions;
    if (!permissions || required.some((permission) => !permissions.has(permission))) {
      this.logger.warn(
        JSON.stringify({
          event: 'AUTHORIZATION_DENIED',
          method: request.method ?? 'UNKNOWN',
          route: request.route?.path ?? 'unknown',
          actorId: request.currentActor?.id,
        }),
      );
      throw insufficientPermission();
    }
    return true;
  }
}

function insufficientPermission(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'INSUFFICIENT_PERMISSION',
    message: 'Você não tem permissão para realizar esta operação.',
  });
}
