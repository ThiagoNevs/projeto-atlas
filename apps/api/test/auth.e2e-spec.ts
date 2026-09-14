import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ATLAS_PERMISSIONS, ATLAS_PERMISSION_VALUES } from '@atlas/shared';
import request from 'supertest';

import { oidcActorId } from '../src/auth/actor-id';
import { AuthConfig } from '../src/auth/auth.config';
import { AuthModule } from '../src/auth/auth.module';
import { createCorsOptions, readWebOrigin } from '../src/auth/cors.config';
import { RequirePermissions } from '../src/auth/require-permissions.decorator';
import { HealthController } from '../src/health.controller';
import { HealthReadinessService } from '../src/health-readiness.service';
import { OperationalLogger } from '../src/operational-context/operational-logger.service';
import {
  startTestAuthHarness,
  TEST_AUTH_ACCESS_VALUE,
  TEST_AUTH_ADMIN_ROLE,
  TEST_AUTH_ANALYST_ROLE,
  TEST_AUTH_AUDIENCE,
  TEST_AUTH_CLIENT_ID,
  TEST_AUTH_SUBJECT,
  TEST_AUTH_VIEWER_ROLE,
  type TestAuthHarness,
} from './auth-test-harness';

@Controller()
class ProtectedDomainTestController {
  @Get('assets')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  assets() {
    return { ok: true };
  }
  @Get('conflict-review-cases')
  @RequirePermissions(ATLAS_PERMISSIONS.reviewCaseRead)
  reviewCases() {
    return { ok: true };
  }
  @Get('audit')
  @RequirePermissions(ATLAS_PERMISSIONS.auditRead)
  audit() {
    return { ok: true };
  }
  @Get('network-discovery/profiles')
  @RequirePermissions(ATLAS_PERMISSIONS.discoveryRead)
  discovery() {
    return { ok: true };
  }

  @Get('review-case-manage')
  @RequirePermissions(ATLAS_PERMISSIONS.reviewCaseManage)
  reviewCaseManage() {
    return { ok: true };
  }

  @Get('admin-status')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryStatusUpdate)
  adminStatus() {
    return { ok: true };
  }

  @Get('multiple-permissions')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead, ATLAS_PERMISSIONS.auditRead)
  multiplePermissions() {
    return { ok: true };
  }

  @Get('missing-policy')
  missingPolicy() {
    return { ok: true };
  }
}

describe('OIDC authentication boundary', () => {
  const webOrigin = 'https://atlas-web.example';
  let auth: TestAuthHarness;
  let app: INestApplication;
  let operationalLogger: OperationalLogger;

  async function createApp(): Promise<INestApplication> {
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [HealthController, ProtectedDomainTestController],
      providers: [
        {
          provide: HealthReadinessService,
          useValue: { isReady: () => Promise.resolve(true) },
        },
      ],
    }).compile();
    const created = module.createNestApplication();
    operationalLogger = module.get(OperationalLogger);
    created.useLogger(false);
    created.enableCors(createCorsOptions(webOrigin));
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

  it('keeps only GET /health public while unrelated domains are default-deny', async () => {
    await request(serverOf(app)).get('/health').expect(200);
    for (const path of [
      '/assets',
      '/conflict-review-cases',
      '/audit',
      '/network-discovery/profiles',
    ]) {
      const response = await request(serverOf(app)).get(path).expect(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Autenticação necessária.',
        }),
      );
    }
  });

  it('emits safe authentication telemetry correlated with the response', async () => {
    const warn = jest.spyOn(operationalLogger, 'warn');
    const nestWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const invalidToken = 'not-a-jwt-sensitive-value';

    try {
      const required = await request(serverOf(app)).get('/auth/me').expect(401);
      const invalid = await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'AUTHENTICATION_REQUIRED' }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'AUTHENTICATION_INVALID' }),
      );
      expect(required.headers['x-request-id']).toEqual(expect.any(String));
      expect(invalid.headers['x-request-id']).toEqual(expect.any(String));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(invalidToken);
      const finalRecords: unknown[] = [];
      for (const [record] of nestWarn.mock.calls) finalRecords.push(record as unknown);
      expect(finalRecords).toContainEqual(
        expect.objectContaining({
          event: 'AUTHENTICATION_REQUIRED',
          requestId: required.headers['x-request-id'],
          correlationId: required.headers['x-correlation-id'],
        }),
      );
      expect(JSON.stringify(finalRecords)).not.toContain(invalidToken);
    } finally {
      warn.mockRestore();
      nestWarn.mockRestore();
    }
  });

  it('emits stable safe events for access, permission and default-deny failures', async () => {
    const warn = jest.spyOn(operationalLogger, 'warn');
    const error = jest.spyOn(operationalLogger, 'error');
    const noAccessToken = await auth.issueToken({ roles: [] });
    const accessOnlyToken = await auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE] });
    const adminToken = await auth.issueToken();

    try {
      await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `Bearer ${noAccessToken}`)
        .expect(403);
      await request(serverOf(app))
        .get('/review-case-manage')
        .set('Authorization', `Bearer ${accessOnlyToken}`)
        .expect(403);
      await request(serverOf(app))
        .get('/missing-policy')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ATLAS_ACCESS_DENIED', actorKind: 'HUMAN' }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'AUTHORIZATION_DENIED',
          requiredPermission: ATLAS_PERMISSIONS.reviewCaseManage,
        }),
      );
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'AUTHORIZATION_POLICY_MISSING' }),
      );
      const serialized = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(serialized).not.toContain(noAccessToken);
      expect(serialized).not.toContain(accessOnlyToken);
      expect(serialized).not.toContain(adminToken);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('accepts a signed API access token and returns only the trusted actor projection', async () => {
    const token = await auth.issueToken();
    const response = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({
      id: oidcActorId('HUMAN', auth.issuer, TEST_AUTH_SUBJECT),
      kind: 'HUMAN',
      displayName: 'Atlas Test User',
      permissions: [...ATLAS_PERMISSION_VALUES].sort(),
    });
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(response.body).not.toHaveProperty('subject');
    expect(response.body).not.toHaveProperty('issuer');
  });

  it.each(['Bearer', 'bearer', 'BEARER'])(
    'accepts the case-insensitive %s authentication scheme',
    async (scheme) => {
      await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `${scheme} ${await auth.issueToken()}`)
        .expect(200);
    },
  );

  it.each(['Basic value', 'Bearer', 'Bearer token extra', 'Bearer token, Bearer other'])(
    'rejects malformed or unsupported authorization header %s',
    async (authorization) => {
      const response = await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', authorization)
        .expect(401);
      expect(response.body).toEqual(expect.objectContaining({ code: 'AUTHENTICATION_INVALID' }));
    },
  );

  it('authorizes the configured origin and required headers in a real preflight', async () => {
    const response = await request(serverOf(app))
      .options('/auth/me')
      .set('Origin', webOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set(
        'Access-Control-Request-Headers',
        'Authorization, Content-Type, Idempotency-Key, X-Correlation-ID',
      )
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(webOrigin);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['access-control-allow-headers']).toBe(
      'Authorization,Content-Type,Idempotency-Key,X-Correlation-ID',
    );

    const actualResponse = await request(serverOf(app))
      .get('/health')
      .set('Origin', webOrigin)
      .expect(200);
    expect(actualResponse.headers['access-control-expose-headers']).toBe(
      'X-Request-ID,X-Correlation-ID',
    );
  });

  it('does not authorize a different origin in preflight', async () => {
    const response = await request(serverOf(app))
      .options('/auth/me')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validates WEB_ORIGIN fail-fast and permits local HTTP only for development hosts', () => {
    expect(readWebOrigin('https://atlas.example')).toBe('https://atlas.example');
    expect(readWebOrigin('https://atlas.example/')).toBe('https://atlas.example');
    expect(readWebOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(readWebOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');

    for (const invalid of [
      undefined,
      '',
      ' ',
      '*',
      'null',
      'not-a-url',
      'ftp://atlas.example',
      'https://user:password@atlas.example',
      'https://atlas.example/path',
      'https://atlas.example?query=value',
      'https://atlas.example#fragment',
      'http://atlas.example',
    ]) {
      expect(() => readWebOrigin(invalid)).toThrow(/WEB_ORIGIN/);
    }
  });

  it('preserves and validates an exact issuer identifier ending in a slash', async () => {
    const originalIssuer = process.env.AUTH_ISSUER;
    const issuerWithTrailingSlash = `${auth.issuer}/`;
    process.env.AUTH_ISSUER = issuerWithTrailingSlash;
    const isolatedApp = await createApp();
    try {
      expect(isolatedApp.get(AuthConfig).issuer).toBe(issuerWithTrailingSlash);
      await request(serverOf(isolatedApp))
        .get('/auth/me')
        .set(
          'Authorization',
          `Bearer ${await auth.issueToken({ issuer: issuerWithTrailingSlash })}`,
        )
        .expect(200);
    } finally {
      process.env.AUTH_ISSUER = originalIssuer;
      await isolatedApp.close();
    }
  });

  it('rejects an anonymous request to /auth/me with the authentication challenge', async () => {
    const response = await request(serverOf(app)).get('/auth/me').expect(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Autenticação necessária.',
      }),
    );
  });

  it.each([
    ['expired', () => auth.issueToken({ expiresInSeconds: -1 })],
    ['future nbf', () => auth.issueToken({ notBeforeSeconds: 300 })],
    ['wrong issuer', () => auth.issueToken({ issuer: 'https://wrong-issuer.example' })],
    ['wrong audience', () => auth.issueToken({ audience: 'another-api' })],
    ['wrong client', () => auth.issueToken({ clientId: 'untrusted-client' })],
    ['wrong algorithm', () => auth.issueToken({ algorithm: 'HS256' })],
  ])('rejects %s tokens with the stable safe envelope', async (_label, tokenFactory) => {
    const token = await tokenFactory();
    const response = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        code: 'AUTHENTICATION_INVALID',
        message: 'A credencial de acesso é inválida ou expirou.',
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain(token);
  });

  it('rejects malformed and invalid-signature tokens', async () => {
    const malformed = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    expect(malformed.body).toEqual(expect.objectContaining({ code: 'AUTHENTICATION_INVALID' }));

    const jose = await import('jose');
    const { privateKey } = await jose.generateKeyPair('RS256');
    const invalidSignature = await auth.issueToken({ signingKey: privateKey });
    const invalid = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${invalidSignature}`)
      .expect(401);
    expect(invalid.body).toEqual(expect.objectContaining({ code: 'AUTHENTICATION_INVALID' }));
  });

  it('fails closed with 403 for missing, unknown or malformed access groups', async () => {
    for (const roles of [
      [],
      ['unknown-group'],
      ['atlas-admin'],
      { nested: TEST_AUTH_ACCESS_VALUE },
    ]) {
      const token = await auth.issueToken({ roles });
      const response = await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 403,
          code: 'INSUFFICIENT_PERMISSION',
          message: 'Você não tem permissão para realizar esta operação.',
        }),
      );
    }
    await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${await auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE] })}`)
      .expect(200);
  });

  it('accepts the configured access value when the role claim is a string', async () => {
    await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${await auth.issueToken({ roles: TEST_AUTH_ACCESS_VALUE })}`)
      .expect(200);
  });

  it('maps Viewer, Analyst and Admin roles exactly and returns sorted known permissions', async () => {
    const cases = [
      {
        role: TEST_AUTH_VIEWER_ROLE,
        allowed: ['/assets', '/conflict-review-cases', '/network-discovery/profiles'],
        denied: ['/audit', '/review-case-manage', '/admin-status'],
      },
      {
        role: TEST_AUTH_ANALYST_ROLE,
        allowed: ['/assets', '/audit', '/review-case-manage', '/multiple-permissions'],
        denied: ['/admin-status'],
      },
      {
        role: TEST_AUTH_ADMIN_ROLE,
        allowed: ['/assets', '/audit', '/review-case-manage', '/admin-status'],
        denied: [],
      },
    ];

    for (const scenario of cases) {
      const token = await auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE, scenario.role] });
      for (const path of scenario.allowed) {
        await request(serverOf(app)).get(path).set('Authorization', `Bearer ${token}`).expect(200);
      }
      for (const path of scenario.denied) {
        const response = await request(serverOf(app))
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        expect(response.body).toEqual(expect.objectContaining({ code: 'INSUFFICIENT_PERMISSION' }));
      }
      const me = await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const responseBody = me.body as { permissions: string[] };
      expect(responseBody.permissions).toEqual([...responseBody.permissions].sort());
      expect(
        responseBody.permissions.every((permission) =>
          ATLAS_PERMISSION_VALUES.includes(permission as (typeof ATLAS_PERMISSION_VALUES)[number]),
        ),
      ).toBe(true);
    }
  });

  it('unions multiple roles while ignoring unknown, case-different and substring values', async () => {
    const token = await auth.issueToken({
      roles: [
        TEST_AUTH_ACCESS_VALUE,
        TEST_AUTH_VIEWER_ROLE,
        TEST_AUTH_ANALYST_ROLE,
        'unknown-role',
        TEST_AUTH_ADMIN_ROLE.toUpperCase(),
        `prefix-${TEST_AUTH_ADMIN_ROLE}-suffix`,
      ],
    });
    await request(serverOf(app))
      .get('/review-case-manage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(serverOf(app))
      .get('/admin-status')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('keeps unknown granular roles non-authorizing when atlas:access is present', async () => {
    const token = await auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE, 'unknown-role'] });
    const me = await request(serverOf(app))
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body).toEqual(expect.objectContaining({ permissions: [ATLAS_PERMISSIONS.access] }));
    await request(serverOf(app)).get('/assets').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('requires atlas:access independently from every granular role', async () => {
    for (const role of [TEST_AUTH_VIEWER_ROLE, TEST_AUTH_ANALYST_ROLE, TEST_AUTH_ADMIN_ROLE]) {
      await request(serverOf(app))
        .get('/auth/me')
        .set('Authorization', `Bearer ${await auth.issueToken({ roles: [role] })}`)
        .expect(403);
    }
  });

  it('uses AND semantics and denies authenticated handlers without an explicit policy', async () => {
    const viewer = await auth.issueToken({
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_VIEWER_ROLE],
    });
    const analyst = await auth.issueToken({
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_ANALYST_ROLE],
    });
    await request(serverOf(app))
      .get('/multiple-permissions')
      .set('Authorization', `Bearer ${viewer}`)
      .expect(403);
    await request(serverOf(app))
      .get('/multiple-permissions')
      .set('Authorization', `Bearer ${analyst}`)
      .expect(200);
    const missing = await request(serverOf(app))
      .get('/missing-policy')
      .set('Authorization', `Bearer ${await auth.issueToken()}`)
      .expect(403);
    expect(missing.body).toEqual(expect.objectContaining({ code: 'INSUFFICIENT_PERMISSION' }));
  });

  it('fails startup for ambiguous, duplicate, empty or missing external role mappings', async () => {
    const original = {
      access: process.env.AUTH_ATLAS_ACCESS_VALUES,
      viewer: process.env.AUTH_VIEWER_ROLE_VALUES,
      analyst: process.env.AUTH_ANALYST_ROLE_VALUES,
      admin: process.env.AUTH_ADMIN_ROLE_VALUES,
    };
    const invalidMappings = [
      { access: 'shared', viewer: 'shared', analyst: 'analyst', admin: 'admin' },
      { access: 'shared', viewer: 'viewer', analyst: 'shared', admin: 'admin' },
      { access: 'shared', viewer: 'viewer', analyst: 'analyst', admin: 'shared' },
      { access: 'access', viewer: 'shared', analyst: 'shared', admin: 'admin' },
      { access: 'access', viewer: 'shared', analyst: 'analyst', admin: 'shared' },
      { access: 'access', viewer: 'viewer', analyst: 'shared', admin: 'shared' },
      { access: 'access', viewer: 'viewer,viewer', analyst: 'analyst', admin: 'admin' },
      { access: 'access', viewer: 'viewer,', analyst: 'analyst', admin: 'admin' },
      { access: 'access', viewer: '', analyst: 'analyst', admin: 'admin' },
    ];
    try {
      for (const mapping of invalidMappings) {
        process.env.AUTH_ATLAS_ACCESS_VALUES = mapping.access;
        process.env.AUTH_VIEWER_ROLE_VALUES = mapping.viewer;
        process.env.AUTH_ANALYST_ROLE_VALUES = mapping.analyst;
        process.env.AUTH_ADMIN_ROLE_VALUES = mapping.admin;
        await expect(createApp()).rejects.toThrow();
      }
    } finally {
      process.env.AUTH_ATLAS_ACCESS_VALUES = original.access;
      process.env.AUTH_VIEWER_ROLE_VALUES = original.viewer;
      process.env.AUTH_ANALYST_ROLE_VALUES = original.analyst;
      process.env.AUTH_ADMIN_ROLE_VALUES = original.admin;
    }
  });

  it('returns 503 when JWKS is unavailable and no verifier cache exists', async () => {
    auth.setJwksAvailable(false);
    const isolatedApp = await createApp();
    try {
      const response = await request(serverOf(isolatedApp))
        .get('/auth/me')
        .set('Authorization', `Bearer ${await auth.issueToken()}`)
        .expect(503);
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 503,
          code: 'AUTHENTICATION_UNAVAILABLE',
        }),
      );
    } finally {
      auth.setJwksAvailable(true);
      await isolatedApp.close();
    }
  });

  it('derives stable, namespaced actor IDs from exact issuer and subject', () => {
    const first = oidcActorId('HUMAN', auth.issuer, TEST_AUTH_SUBJECT);
    expect(first).toBe(oidcActorId('HUMAN', auth.issuer, TEST_AUTH_SUBJECT));
    expect(first).not.toBe(oidcActorId('HUMAN', `${auth.issuer}/other`, TEST_AUTH_SUBJECT));
    expect(first).not.toBe(oidcActorId('HUMAN', auth.issuer, 'another-subject'));
    expect(first).toMatch(/^human:oidc:v1:[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain(TEST_AUTH_SUBJECT);
    expect(TEST_AUTH_AUDIENCE).toBe('atlas-api');
    expect(TEST_AUTH_CLIENT_ID).toBe('atlas-web');
  });
});

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}
