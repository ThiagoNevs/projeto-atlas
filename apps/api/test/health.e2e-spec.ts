import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { config as loadEnv } from 'dotenv';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { ConnectorExecutionService } from '../src/connector-execution/connector-execution.service';
import { HealthController } from '../src/health.controller';
import {
  HEALTH_READINESS_TIMEOUT_MS,
  HealthReadinessService,
} from '../src/health-readiness.service';
import { OperationalLogger } from '../src/operational-context/operational-logger.service';
import { OperationalContextModule } from '../src/operational-context/operational-context.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { startTestAuthHarness, type TestAuthHarness } from './auth-test-harness';

describe('health endpoints with PostgreSQL', () => {
  let auth: TestAuthHarness;
  let app: INestApplication;
  let operationalLogger: OperationalLogger;

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    auth = await startTestAuthHarness();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    operationalLogger = module.get(OperationalLogger);
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (auth) await auth.close();
  });

  it('preserves GET /health and exposes public liveness without dependencies', async () => {
    const health = await request(serverOf(app)).get('/health').expect(200);
    expect(health.body).toEqual({
      service: 'atlas-api',
      status: 'ok',
      timestamp: expect.any(String),
    });
    const healthBody = health.body as { timestamp: string };
    expect(Number.isNaN(Date.parse(healthBody.timestamp))).toBe(false);

    const live = await request(serverOf(app)).get('/health/live').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
  });

  it('reports ready only after a real PostgreSQL probe', async () => {
    const response = await request(serverOf(app)).get('/health/ready').expect(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.headers['x-correlation-id']).toBe(response.headers['x-request-id']);
  });

  it('emits exactly one DEBUG completion event for a successful health request', async () => {
    const debug = jest.spyOn(operationalLogger, 'debug');
    try {
      await request(serverOf(app)).get('/health/live').expect(200);
      await nextTurn();
      expect(
        debug.mock.calls.filter(
          ([record]) =>
            (record as { event?: string; route?: string }).event === 'http.request.completed' &&
            (record as { route?: string }).route === '/health/live',
        ),
      ).toHaveLength(1);
    } finally {
      debug.mockRestore();
    }
  });
});

describe('health readiness failure boundaries', () => {
  it('does not probe Prisma for liveness', async () => {
    const query = jest.fn<() => Promise<unknown>>().mockResolvedValue([{ '?column?': 1 }]);
    const fixture = await createHealthFixture(query, 100);

    try {
      await request(serverOf(fixture.app)).get('/health/live').expect(200, { status: 'ok' });
      expect(query).not.toHaveBeenCalled();
    } finally {
      await fixture.app.close();
    }
  });

  it('returns a sanitized 503 when PostgreSQL rejects the probe', async () => {
    const databaseError = Object.assign(new Error('postgres-secret-host:5432'), {
      code: 'credential-like-secret',
    });
    const fixture = await createHealthFixture(() => Promise.reject(databaseError), 100);
    const warnSpy = jest.spyOn(fixture.logger, 'warn');

    try {
      const response = await request(serverOf(fixture.app)).get('/health/ready').expect(503);
      expect(response.body).toEqual({ status: 'not_ready' });
      expect(JSON.stringify(response.body)).not.toContain('postgres-secret-host');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'health.readiness.failed',
          errorType: 'DatabaseProbeError',
          errorCode: 'POSTGRES_READINESS_FAILED',
        }),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('credential-like-secret');
    } finally {
      await fixture.app.close();
    }
  });

  it('returns 503 when enabled Connector Execution is not ready', async () => {
    const query = jest.fn<() => Promise<unknown>>().mockResolvedValue([{ '?column?': 1 }]);
    const fixture = await createHealthFixture(query, 100, () => Promise.resolve(false));

    try {
      await request(serverOf(fixture.app)).get('/health/ready').expect(503, {
        status: 'not_ready',
      });
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.app.close();
    }
  });

  it('times out at the HTTP boundary while retaining one underlying single-flight probe', async () => {
    const firstProbe = deferred<unknown>();
    const query = jest
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => firstProbe.promise)
      .mockResolvedValueOnce([{ '?column?': 1 }]);
    const fixture = await createHealthFixture(query, 10);
    const warnSpy = jest.spyOn(fixture.logger, 'warn');

    try {
      await request(serverOf(fixture.app)).get('/health/ready').expect(503, {
        status: 'not_ready',
      });
      await request(serverOf(fixture.app)).get('/health/ready').expect(503, {
        status: 'not_ready',
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(
        warnSpy.mock.calls.filter(
          ([record]) => (record as { event?: string }).event === 'health.readiness.failed',
        ),
      ).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'health.readiness.failed',
          errorType: 'ReadinessTimeout',
          errorCode: 'HEALTH_READINESS_TIMEOUT',
        }),
      );

      firstProbe.resolve([{ '?column?': 1 }]);
      await nextTurn();

      await request(serverOf(fixture.app)).get('/health/ready').expect(200, { status: 'ready' });
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      firstProbe.resolve(undefined);
      await fixture.app.close();
    }
  });
});

async function createHealthFixture(
  query: () => Promise<unknown>,
  timeoutMs: number,
  connectorReady: () => Promise<boolean> = () => Promise.resolve(true),
): Promise<{ app: INestApplication; logger: OperationalLogger }> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [OperationalContextModule],
    controllers: [HealthController],
    providers: [
      HealthReadinessService,
      { provide: HEALTH_READINESS_TIMEOUT_MS, useValue: timeoutMs },
      { provide: PrismaService, useValue: { $queryRaw: query } },
      { provide: ConnectorExecutionService, useValue: { isReady: connectorReady } },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.useLogger(false);
  await app.init();
  return { app, logger: module.get(OperationalLogger) };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
