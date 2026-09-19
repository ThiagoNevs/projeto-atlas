import { Injectable } from '@nestjs/common';

import { oidcActorId } from './actor-id';
import { AuthConfig } from './auth.config';
import { ATLAS_ACCESS_PERMISSION, type AtlasPermission, type CurrentActor } from './auth.types';
import { permissionsForExternalRoles } from './role-mapping';
import type { JWTPayload } from 'jose';

export class AuthenticationInvalidError extends Error {}
export class AuthenticationInfrastructureError extends Error {}

interface OidcMetadata {
  issuer?: unknown;
  jwks_uri?: unknown;
}

function claimValues(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  return null;
}

@Injectable()
export class AuthTokenVerifier {
  private keySetPromise?: Promise<unknown>;

  constructor(private readonly config: AuthConfig) {}

  async verify(accessToken: string): Promise<CurrentActor> {
    try {
      const jose = await import('jose');
      const keySet = await this.getKeySet(jose.createRemoteJWKSet);
      const result = await jose.jwtVerify(
        accessToken,
        keySet as Parameters<typeof jose.jwtVerify>[1],
        {
          issuer: this.config.issuer,
          audience: this.config.audience,
          algorithms: this.config.algorithms,
          clockTolerance: this.config.clockToleranceSeconds,
          requiredClaims: ['iss', 'sub', 'aud', 'exp'],
        },
      );
      rejectCallerProvidedActorClassification(result.payload);
      const subject = result.payload.sub;
      if (!subject) throw new AuthenticationInvalidError();
      const roles = claimValues(result.payload[this.config.roleClaim]);
      const hasAccess = roles?.some((role) => this.config.accessValues.has(role)) ?? false;
      const permissions = new Set<AtlasPermission>();
      if (hasAccess) permissions.add(ATLAS_ACCESS_PERMISSION);

      const clientId = exactClientId(result.payload);
      if (clientId === this.config.humanClientId) {
        if (hasAccess) {
          for (const permission of permissionsForExternalRoles(
            roles ?? [],
            this.config.externalRoleMapping,
          )) {
            permissions.add(permission);
          }
        }
        const displayName = safeDisplayName(result.payload.name);
        return {
          id: oidcActorId('HUMAN', this.config.issuer, subject),
          kind: 'HUMAN',
          permissions,
          ...(displayName ? { displayName } : {}),
        };
      }

      const registration = this.config.serviceActors.findByClientId(clientId);
      if (!registration || registration.subject !== subject) {
        throw new AuthenticationInvalidError();
      }
      validateServiceTemporalClaims(result.payload, this.config);
      for (const permission of registration.permissions) permissions.add(permission);
      return {
        id: oidcActorId('SERVICE', this.config.issuer, subject),
        kind: 'SERVICE',
        permissions,
        displayName: registration.displayName,
      };
    } catch (error) {
      if (error instanceof AuthenticationInfrastructureError) throw error;
      if (error instanceof AuthenticationInvalidError) throw error;
      const message = error instanceof Error ? error.message : '';
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (
        (error instanceof TypeError && /fetch|network|connect|socket/i.test(message)) ||
        code === 'ERR_JWKS_TIMEOUT' ||
        /JSON Web Key Set HTTP response|fetch failed/i.test(message)
      ) {
        throw new AuthenticationInfrastructureError();
      }
      throw new AuthenticationInvalidError();
    }
  }

  private async getKeySet(createRemoteJWKSet: (url: URL) => unknown): Promise<unknown> {
    if (!this.keySetPromise) {
      this.keySetPromise = this.resolveJwksUri()
        .then((uri) => createRemoteJWKSet(new URL(uri)))
        .catch((error: unknown) => {
          this.keySetPromise = undefined;
          if (error instanceof AuthenticationInfrastructureError) throw error;
          throw new AuthenticationInfrastructureError();
        });
    }
    return this.keySetPromise;
  }

  private async resolveJwksUri(): Promise<string> {
    if (this.config.jwksUri) return this.config.jwksUri;
    try {
      const discoveryUrl = `${this.config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new AuthenticationInfrastructureError();
      const metadata = (await response.json()) as OidcMetadata;
      if (metadata.issuer !== this.config.issuer || typeof metadata.jwks_uri !== 'string') {
        throw new AuthenticationInfrastructureError();
      }
      return validDiscoveredJwksUri(metadata.jwks_uri, this.config.issuer);
    } catch (error) {
      if (error instanceof AuthenticationInfrastructureError) throw error;
      throw new AuthenticationInfrastructureError();
    }
  }
}

function exactClientId(payload: JWTPayload): string {
  const authorizedParty = payload.azp;
  const clientId = payload.client_id;
  if (authorizedParty !== undefined && typeof authorizedParty !== 'string') {
    throw new AuthenticationInvalidError();
  }
  if (clientId !== undefined && typeof clientId !== 'string') {
    throw new AuthenticationInvalidError();
  }
  if (authorizedParty && clientId && authorizedParty !== clientId) {
    throw new AuthenticationInvalidError();
  }
  const resolved = authorizedParty ?? clientId;
  if (!resolved) throw new AuthenticationInvalidError();
  return resolved;
}

function rejectCallerProvidedActorClassification(payload: JWTPayload): void {
  for (const claim of ['kind', 'actorKind', 'actor_type', 'actorType', 'service']) {
    if (Object.hasOwn(payload, claim)) throw new AuthenticationInvalidError();
  }
}

function validateServiceTemporalClaims(payload: JWTPayload, config: AuthConfig): void {
  const { iat, nbf, exp } = payload;
  if (![iat, nbf, exp].every((value) => Number.isInteger(value))) {
    throw new AuthenticationInvalidError();
  }
  const issuedAt = iat as number;
  const notBefore = nbf as number;
  const expiresAt = exp as number;
  const now = Math.floor(Date.now() / 1_000);
  if (
    issuedAt > now + config.clockToleranceSeconds ||
    expiresAt <= issuedAt ||
    notBefore > expiresAt ||
    expiresAt - issuedAt > config.serviceTokenMaxLifetimeSeconds
  ) {
    throw new AuthenticationInvalidError();
  }
}

function safeDisplayName(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
}

function validDiscoveredJwksUri(value: string, issuer: string): string {
  const uri = new URL(value);
  const issuerUrl = new URL(issuer);
  if (uri.protocol !== issuerUrl.protocol || uri.host !== issuerUrl.host) {
    throw new AuthenticationInfrastructureError();
  }
  return uri.toString();
}
