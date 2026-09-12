import type { KeyObject, webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { oidcActorId } from '../src/auth/actor-id';
import type { CurrentActor } from '../src/auth/auth.types';

export const TEST_AUTH_AUDIENCE = 'atlas-api';
export const TEST_AUTH_CLIENT_ID = 'atlas-web';
export const TEST_AUTH_SUBJECT = 'atlas-test-user';
export const TEST_AUTH_ACCESS_VALUE = 'atlas-user';

interface TestTokenOptions {
  subject?: string;
  audience?: string;
  issuer?: string;
  clientId?: string;
  roles?: unknown;
  expiresInSeconds?: number;
  notBeforeSeconds?: number;
  name?: string;
  signingKey?: KeyObject | webcrypto.CryptoKey | Uint8Array;
  keyId?: string;
  algorithm?: 'RS256' | 'HS256';
}

export interface TestAuthHarness {
  readonly issuer: string;
  readonly actor: CurrentActor;
  issueToken(options?: TestTokenOptions): Promise<string>;
  createAuthenticatedAgent(
    app: INestApplication,
    token?: string,
  ): Promise<ReturnType<typeof request.agent>>;
  setJwksAvailable(available: boolean): void;
  close(): Promise<void>;
}

export async function startTestAuthHarness(): Promise<TestAuthHarness> {
  const jose = await import('jose');
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const publicJwk = await jose.exportJWK(publicKey);
  const keyId = 'atlas-test-rs256';
  let jwksAvailable = true;
  let issuer = '';

  const server = createServer((incoming, response) => {
    if (incoming.url === '/.well-known/openid-configuration') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (incoming.url === '/jwks') {
      if (!jwksAvailable) {
        response.statusCode = 503;
        response.end('unavailable');
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: keyId, alg: 'RS256', use: 'sig' }],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test issuer did not bind to TCP.');
  issuer = `http://127.0.0.1:${address.port}`;

  process.env.AUTH_ISSUER = issuer;
  process.env.AUTH_AUDIENCE = TEST_AUTH_AUDIENCE;
  process.env.AUTH_HUMAN_CLIENT_ID = TEST_AUTH_CLIENT_ID;
  process.env.AUTH_ROLE_CLAIM = 'groups';
  process.env.AUTH_ATLAS_ACCESS_VALUES = TEST_AUTH_ACCESS_VALUE;
  process.env.AUTH_ALLOWED_ALGORITHMS = 'RS256';
  process.env.AUTH_CLOCK_TOLERANCE_SECONDS = '0';
  process.env.AUTH_JWKS_URI = `${issuer}/jwks`;

  const actor: CurrentActor = {
    id: oidcActorId('HUMAN', issuer, TEST_AUTH_SUBJECT),
    kind: 'HUMAN',
    displayName: 'Atlas Test User',
    permissions: new Set(['atlas:access']),
  };

  async function issueToken(options: TestTokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    const algorithm = options.algorithm ?? 'RS256';
    const signingKey =
      options.signingKey ??
      (algorithm === 'HS256'
        ? new TextEncoder().encode('test-only-invalid-algorithm-secret')
        : privateKey);
    return new jose.SignJWT({
      groups: options.roles ?? [TEST_AUTH_ACCESS_VALUE],
      name: options.name ?? 'Atlas Test User',
      azp: options.clientId ?? TEST_AUTH_CLIENT_ID,
    })
      .setProtectedHeader({ alg: algorithm, kid: options.keyId ?? keyId, typ: 'JWT' })
      .setIssuer(options.issuer ?? issuer)
      .setSubject(options.subject ?? TEST_AUTH_SUBJECT)
      .setAudience(options.audience ?? TEST_AUTH_AUDIENCE)
      .setIssuedAt(now)
      .setNotBefore(now + (options.notBeforeSeconds ?? 0))
      .setExpirationTime(now + (options.expiresInSeconds ?? 300))
      .sign(signingKey);
  }

  return {
    issuer,
    actor,
    issueToken,
    async createAuthenticatedAgent(app, token) {
      const agent = request.agent(app.getHttpServer() as Server);
      agent.set('Authorization', `Bearer ${token ?? (await issueToken())}`);
      return agent;
    },
    setJwksAvailable(available) {
      jwksAvailable = available;
    },
    async close() {
      await closeServer(server);
    },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
