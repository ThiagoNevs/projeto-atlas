import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AtlasPermission } from '@atlas/shared';

import type { AuthenticatedRequest } from './auth.types';
import { PUBLIC_ROUTE } from './public.decorator';
import { REQUIRED_PERMISSIONS } from './require-permissions.decorator';
import { OperationalLogger } from '../operational-context/operational-logger.service';

interface AuthorizationRequest extends AuthenticatedRequest {
  method?: string;
  route?: { path?: string };
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: OperationalLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    if (this.reflector.get<boolean>(PUBLIC_ROUTE, handler)) return true;

    const request = context.switchToHttp().getRequest<AuthorizationRequest>();
    const required = this.reflector.get<readonly AtlasPermission[]>(REQUIRED_PERMISSIONS, handler);
    if (!required?.length) {
      this.logger.error({
        event: 'AUTHORIZATION_POLICY_MISSING',
        method: request.method ?? 'UNKNOWN',
        route: request.route?.path ?? 'UNMATCHED',
        actorKind: request.currentActor?.kind,
        actorId: request.currentActor?.id,
      });
      throw insufficientPermission();
    }

    const permissions = request.currentActor?.permissions;
    if (!permissions || required.some((permission) => !permissions.has(permission))) {
      this.logger.warn({
        event: 'AUTHORIZATION_DENIED',
        method: request.method ?? 'UNKNOWN',
        route: request.route?.path ?? 'UNMATCHED',
        actorKind: request.currentActor?.kind,
        actorId: request.currentActor?.id,
        requiredPermission: required.length === 1 ? required[0] : undefined,
      });
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
