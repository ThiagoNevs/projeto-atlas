import { Injectable } from '@nestjs/common';

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

@Injectable()
export class AuthConfig {
  readonly issuer = validUrl('AUTH_ISSUER', required('AUTH_ISSUER'));
  readonly audience = required('AUTH_AUDIENCE');
  readonly humanClientId = required('AUTH_HUMAN_CLIENT_ID');
  readonly roleClaim = required('AUTH_ROLE_CLAIM');
  readonly accessValues = new Set(
    required('AUTH_ATLAS_ACCESS_VALUES')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  readonly algorithms = required('AUTH_ALLOWED_ALGORITHMS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  readonly clockToleranceSeconds = Number(process.env.AUTH_CLOCK_TOLERANCE_SECONDS ?? '60');
  readonly jwksUri = process.env.AUTH_JWKS_URI?.trim()
    ? validUrl('AUTH_JWKS_URI', process.env.AUTH_JWKS_URI.trim())
    : undefined;

  constructor() {
    if (this.accessValues.size === 0)
      throw new Error('AUTH_ATLAS_ACCESS_VALUES não pode ser vazio.');
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
  }
}
