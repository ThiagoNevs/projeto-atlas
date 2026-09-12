import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  AuthenticationInfrastructureError,
  AuthTokenVerifier,
} from './auth-token-verifier.service';
import { ATLAS_ACCESS_PERMISSION, type AuthenticatedRequest } from './auth.types';
import { PUBLIC_ROUTE } from './public.decorator';

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AuthTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<HeaderResponse>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') {
      response.setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Autenticação necessária.',
      });
    }
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match?.[1]) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      throw authenticationInvalid();
    }

    try {
      request.currentActor = await this.verifier.verify(match[1]);
    } catch (error) {
      if (error instanceof AuthenticationInfrastructureError) {
        throw new ServiceUnavailableException({
          statusCode: 503,
          code: 'AUTHENTICATION_UNAVAILABLE',
          message: 'O serviço de autenticação está temporariamente indisponível.',
        });
      }
      response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw authenticationInvalid();
    }

    if (!request.currentActor.permissions.has(ATLAS_ACCESS_PERMISSION)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'INSUFFICIENT_PERMISSION',
        message: 'Você não tem permissão para realizar esta operação.',
      });
    }
    return true;
  }
}

function authenticationInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'AUTHENTICATION_INVALID',
    message: 'A credencial de acesso é inválida ou expirou.',
  });
}
