import { Injectable } from '@nestjs/common';

import { createExternalRoleMapping, type AtlasRole } from './role-mapping';
import { ServiceActorPolicy } from './service-actor-policy';

const SAFE_ALGORITHMS = new Set(['RS256', 'PS256', 'ES256', 'EdDSA']);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}

function validUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} deve ser uma URL válida.`);
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`${name} deve usar HTTPS fora do ambiente local.`);
  }
  return value;
}

function configuredValues(name: string): readonly string[] {
  const raw = required(name);
  const entries = raw.split(',');
  if (entries.some((entry) => !entry.trim())) {
    throw new Error(`${name} contém um valor vazio.`);
  }
  const values = entries.map((entry) => entry.trim());
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} contém um valor duplicado.`);
  }
  return Object.freeze(values);
}

@Injectable()
export class AuthConfig {
  readonly issuer = validUrl('AUTH_ISSUER', required('AUTH_ISSUER'));
  readonly audience = required('AUTH_AUDIENCE');
  readonly humanClientId = required('AUTH_HUMAN_CLIENT_ID');
  readonly roleClaim = required('AUTH_ROLE_CLAIM');
  readonly accessValues = new Set(configuredValues('AUTH_ATLAS_ACCESS_VALUES'));
  readonly externalRoleMapping = createExternalRoleMapping(
    {
      VIEWER: configuredValues('AUTH_VIEWER_ROLE_VALUES'),
      ANALYST: configuredValues('AUTH_ANALYST_ROLE_VALUES'),
      ADMIN: configuredValues('AUTH_ADMIN_ROLE_VALUES'),
    } satisfies Record<AtlasRole, readonly string[]>,
    [...this.accessValues],
  );
  readonly algorithms = required('AUTH_ALLOWED_ALGORITHMS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  readonly clockToleranceSeconds = Number(process.env.AUTH_CLOCK_TOLERANCE_SECONDS ?? '60');
  readonly serviceTokenMaxLifetimeSeconds = Number(
    process.env.AUTH_SERVICE_TOKEN_MAX_LIFETIME_SECONDS ?? '300',
  );
  readonly serviceActors = ServiceActorPolicy.fromEnvironment(
    process.env.AUTH_SERVICE_ACTORS_JSON,
    this.humanClientId,
  );
  readonly jwksUri = process.env.AUTH_JWKS_URI?.trim()
    ? validUrl('AUTH_JWKS_URI', process.env.AUTH_JWKS_URI.trim())
    : undefined;

  constructor() {
    if (
      this.algorithms.length === 0 ||
      this.algorithms.some((item) => !SAFE_ALGORITHMS.has(item))
    ) {
      throw new Error('AUTH_ALLOWED_ALGORITHMS contém algoritmo ausente ou não permitido.');
    }
    if (
      !Number.isInteger(this.clockToleranceSeconds) ||
      this.clockToleranceSeconds < 0 ||
      this.clockToleranceSeconds > 300
    ) {
      throw new Error('AUTH_CLOCK_TOLERANCE_SECONDS deve ser inteiro entre 0 e 300.');
    }
    if (
      !Number.isInteger(this.serviceTokenMaxLifetimeSeconds) ||
      this.serviceTokenMaxLifetimeSeconds < 60 ||
      this.serviceTokenMaxLifetimeSeconds > 3600
    ) {
      throw new Error('AUTH_SERVICE_TOKEN_MAX_LIFETIME_SECONDS deve ser inteiro entre 60 e 3600.');
    }
  }
}
