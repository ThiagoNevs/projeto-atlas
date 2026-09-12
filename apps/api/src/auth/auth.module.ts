import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthTokenVerifier } from './auth-token-verifier.service';
import { PermissionGuard } from './permission.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthConfig,
    AuthTokenVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthConfig, AuthTokenVerifier],
})
export class AuthModule {}
