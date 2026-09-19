import { Controller, Get, type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ATLAS_PERMISSIONS } from '@atlas/shared';
import type { Server } from 'node:http';
import request from 'supertest';

import { oidcActorId } from '../src/auth/actor-id';
import { AuthModule } from '../src/auth/auth.module';
import { RequirePermissions } from '../src/auth/require-permissions.decorator';
import { HealthController } from '../src/health.controller';
import { HealthReadinessService } from '../src/health-readiness.service';
import {
  startTestAuthHarness,
  TEST_AUTH_ACCESS_VALUE,
  TEST_AUTH_ADMIN_ROLE,
  TEST_AUTH_CLIENT_ID,
  TEST_AUTH_SERVICE_CLIENT_ID,
  TEST_AUTH_SERVICE_DISPLAY_NAME,
  TEST_AUTH_SERVICE_SUBJECT,
  type TestAuthHarness,
} from './auth-test-harness';

@Controller('service-actor-test')
class ServiceActorTestController {
  @Get('read')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  read() {
    return { ok: true };
  }

  @Get('admin')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryStatusUpdate)
  admin() {
    return { ok: true };
  }

  @Get('missing-policy')
  missingPolicy() {
    return { ok: true };
  }
}

describe('Trusted Service Actor authentication boundary', () => {
  let auth: TestAuthHarness;
  let app: INestApplication;

  async function createApp(): Promise<INestApplication> {
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [HealthController, ServiceActorTestController],
      providers: [
        {
          provide: HealthReadinessService,
          useValue: { isReady: () => Promise.resolve(true) },
        },
      ],
    }).compile();
    const created = module.createNestApplication();
    created.useLogger(false);
    await created.init();
    return created;
  }

  beforeAll(async () => {
    auth = await startTestAuthHarness();
    app = await createApp();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (auth) await auth.close();
  });

  function serviceToken(overrides: Parameters<TestAuthHarness['issueToken']>[0] = {}) {
    return auth.issueToken({
      clientId: TEST_AUTH_SERVICE_CLIENT_ID,
      subject: TEST_AUTH_SERVICE_SUBJECT,
      roles: [TEST_AUTH_ACCESS_VALUE],
      name: 'Untrusted token display name',
      ...overrides,
    });
  }

  it('projects a valid machine token as a stable SERVICE actor with only explicit permissions', async () => {
    const token = await serviceToken({
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_ADMIN_ROLE, 'inventory:status:update'],
    });
    const first = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const second = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${await serviceToken()}`)
      .expect(200);
    const expectedId = oidcActorId('SERVICE', auth.issuer, TEST_AUTH_SERVICE_SUBJECT);

    expect(first.body).toEqual({
      id: expectedId,
      kind: 'SERVICE',
      displayName: TEST_AUTH_SERVICE_DISPLAY_NAME,
      permissions: [
        ATLAS_PERMISSIONS.access,
        ATLAS_PERMISSIONS.discoveryConfigure,
        ATLAS_PERMISSIONS.inventoryRead,
      ].sort(),
    });
    expect(second.body).toEqual(first.body);
    expect(expectedId).toMatch(/^service:oidc:v1:[A-Za-z0-9_-]{43}$/);
    expect(expectedId).not.toContain(TEST_AUTH_SERVICE_SUBJECT);
    expect(expectedId).not.toContain(TEST_AUTH_SERVICE_CLIENT_ID);
    expect(expectedId).not.toBe(oidcActorId('HUMAN', auth.issuer, TEST_AUTH_SERVICE_SUBJECT));
    expect(JSON.stringify(first.body)).not.toContain(token);
    expect(first.body).not.toHaveProperty('subject');
    expect(first.body).not.toHaveProperty('issuer');
  });

  it('keeps HUMAN classification unchanged when the trusted registration uses a service subject', async () => {
    const response = await request(serverOf(app))
      .get('/auth/me')
      .set(
        'Authorization',
        `Bearer ${await auth.issueToken({
          clientId: TEST_AUTH_CLIENT_ID,
          subject: TEST_AUTH_SERVICE_SUBJECT,
        })}`,
      )
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        kind: 'HUMAN',
        id: oidcActorId('HUMAN', auth.issuer, TEST_AUTH_SERVICE_SUBJECT),
      }),
    );
  });

  it.each([
    ['human client forging kind', false, { kind: 'SERVICE' }],
    ['human client forging actor type', false, { actorType: 'SERVICE' }],
    ['service client forging kind', true, { kind: 'HUMAN' }],
    ['service client forging service flag', true, { service: true }],
  ])('rejects caller-provided classification: %s', async (_label, service, claims) => {
    const token = service
      ? await serviceToken({ additionalClaims: claims })
      : await auth.issueToken({ additionalClaims: claims });
    await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it.each(['azp', 'client_id', 'both'] as const)(
    'accepts one unambiguous %s client binding for the registered SERVICE principal',
    async (clientIdClaim) => {
      const response = await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `Bearer ${await serviceToken({ clientIdClaim })}`)
        .expect(200);
      expect(response.body).toEqual(expect.objectContaining({ kind: 'SERVICE' }));
    },
  );

  it('uses PermissionGuard, keeps atlas:access independent and preserves default-deny', async () => {
    const allowed = await serviceToken();
    await request(serverOf(app))
      .get('/service-actor-test/read')
      .set('Authorization', `Bearer ${allowed}`)
      .expect(200);
    await request(serverOf(app))
      .get('/service-actor-test/admin')
      .set('Authorization', `Bearer ${allowed}`)
      .expect(403);
    await request(serverOf(app))
      .get('/service-actor-test/missing-policy')
      .set('Authorization', `Bearer ${allowed}`)
      .expect(403);

    const noAccess = await serviceToken({ roles: [TEST_AUTH_ADMIN_ROLE] });
    await request(serverOf(app))
      .get('/service-actor-test/read')
      .set('Authorization', `Bearer ${noAccess}`)
      .expect(403);
  });

  it.each([
    ['unknown client', { clientId: 'unknown-machine-client' }],
    ['unknown subject', { subject: 'unknown-machine-subject' }],
    ['missing client binding', { omitClientId: true }],
    [
      'ambiguous client binding',
      { clientIdClaim: 'both' as const, secondaryClientId: TEST_AUTH_CLIENT_ID },
    ],
  ])('rejects %s without downgrading actor kind', async (_label, overrides) => {
    await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${await serviceToken(overrides)}`)
      .expect(401);
  });

  it.each([
    ['wrong issuer', { issuer: 'https://wrong-issuer.example' }],
    ['wrong audience', { audience: 'another-api' }],
    ['wrong algorithm', { algorithm: 'HS256' as const }],
    ['expired', { expiresInSeconds: -1 }],
    ['future nbf', { notBeforeSeconds: 300 }],
    ['missing iat', { omitIssuedAt: true }],
    ['missing nbf', { omitNotBefore: true }],
    ['future iat', { issuedAtSeconds: Math.floor(Date.now() / 1_000) + 300 }],
    ['excessive lifetime', { expiresInSeconds: 301 }],
  ])('rejects a SERVICE token with %s', async (_label, overrides) => {
    await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${await serviceToken(overrides)}`)
      .expect(401);
  });

  it('rejects a SERVICE token signed by an untrusted key', async () => {
    const jose = await import('jose');
    const { privateKey } = await jose.generateKeyPair('RS256');
    await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${await serviceToken({ signingKey: privateKey })}`)
      .expect(401);
  });

  it('adds only safe SERVICE provenance to completed-request telemetry', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const token = await serviceToken({
      additionalClaims: { private_claim: 'raw-claim-secret', client_secret: 'client-secret-value' },
    });
    try {
      const response = await request(serverOf(app))
        .get('/service-actor-test/read')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await new Promise((resolve) => setImmediate(resolve));

      const completion = log.mock.calls
        .map(([record]) => record as unknown)
        .find(
          (record): record is Record<string, unknown> =>
            typeof record === 'object' &&
            record !== null &&
            (record as { event?: unknown }).event === 'http.request.completed' &&
            (record as { requestId?: unknown }).requestId === response.headers['x-request-id'],
        );
      expect(completion).toEqual(
        expect.objectContaining({
          actorKind: 'SERVICE',
          actorId: oidcActorId('SERVICE', auth.issuer, TEST_AUTH_SERVICE_SUBJECT),
        }),
      );
      const serialized = JSON.stringify(log.mock.calls);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain('raw-claim-secret');
      expect(serialized).not.toContain('client-secret-value');
      expect(serialized).not.toContain(TEST_AUTH_SERVICE_SUBJECT);
    } finally {
      log.mockRestore();
    }
  });

  it('fails startup for invalid, duplicated, colliding or over-privileged registrations', async () => {
    const original = process.env.AUTH_SERVICE_ACTORS_JSON;
    const valid = {
      clientId: TEST_AUTH_SERVICE_CLIENT_ID,
      subject: TEST_AUTH_SERVICE_SUBJECT,
      displayName: TEST_AUTH_SERVICE_DISPLAY_NAME,
      permissions: [ATLAS_PERMISSIONS.inventoryRead],
    };
    const invalidPolicies: unknown[] = [
      '{not-json',
      {},
      [{ ...valid, clientId: TEST_AUTH_CLIENT_ID }],
      [valid, { ...valid, subject: 'another-subject' }],
      [valid, { ...valid, clientId: 'another-client' }],
      [{ ...valid, permissions: ['unknown:permission'] }],
      [{ ...valid, permissions: [ATLAS_PERMISSIONS.access] }],
      [
        {
          ...valid,
          permissions: [ATLAS_PERMISSIONS.inventoryRead, ATLAS_PERMISSIONS.inventoryRead],
        },
      ],
      [{ ...valid, displayName: 'unsafe\nname' }],
      [{ ...valid, credential: 'must-not-be-configurable' }],
    ];
    try {
      for (const policy of invalidPolicies) {
        process.env.AUTH_SERVICE_ACTORS_JSON =
          typeof policy === 'string' ? policy : JSON.stringify(policy);
        await expect(createApp()).rejects.toThrow();
      }
    } finally {
      process.env.AUTH_SERVICE_ACTORS_JSON = original;
    }
  });

  it('fails startup when the SERVICE token lifetime policy is invalid', async () => {
    const original = process.env.AUTH_SERVICE_TOKEN_MAX_LIFETIME_SECONDS;
    try {
      for (const value of ['59', '3601', '300.5', 'not-a-number']) {
        process.env.AUTH_SERVICE_TOKEN_MAX_LIFETIME_SECONDS = value;
        await expect(createApp()).rejects.toThrow(
          'AUTH_SERVICE_TOKEN_MAX_LIFETIME_SECONDS deve ser inteiro entre 60 e 3600.',
        );
      }
    } finally {
      process.env.AUTH_SERVICE_TOKEN_MAX_LIFETIME_SECONDS = original;
    }
  });

  it('keeps only the three health handlers public', async () => {
    await request(serverOf(app)).get('/health').expect(200);
    await request(serverOf(app)).get('/health/live').expect(200);
    await request(serverOf(app)).get('/health/ready').expect(200);
    await request(serverOf(app)).get('/auth/me').expect(401);
    await request(serverOf(app)).get('/service-actor-test/read').expect(401);
  });
});

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}
