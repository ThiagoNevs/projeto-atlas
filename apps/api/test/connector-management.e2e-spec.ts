import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { resolve } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AuthModule } from '../src/auth/auth.module';
import { ATLAS_PERMISSIONS } from '../src/auth/permissions';
import { ConnectorExecutionService } from '../src/connector-execution/connector-execution.service';
import type { AtlasJobEnvelope } from '../src/connector-execution/connector-execution.types';
import { ConnectorFrameworkModule } from '../src/connector-framework/connector-framework.module';
import { parseConnectorConfiguration } from '../src/connector-framework/management/connector-configuration';
import type {
  ConnectorAssetObservation,
  ConnectorDefinition,
  ConnectorRunJobPayload,
} from '../src/connector-framework/connector-framework.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import {
  startTestAuthHarness,
  TEST_AUTH_ACCESS_VALUE,
  TEST_AUTH_ADMIN_ROLE,
  TEST_AUTH_ANALYST_ROLE,
  TEST_AUTH_SERVICE_CLIENT_ID,
  TEST_AUTH_SERVICE_DISPLAY_NAME,
  TEST_AUTH_SERVICE_SUBJECT,
  TEST_AUTH_VIEWER_ROLE,
  type TestAuthHarness,
} from './auth-test-harness';

const connectorType = 'synthetic-management-test';
const createdInstanceIds = new Set<string>();
const queued: AtlasJobEnvelope<ConnectorRunJobPayload>[] = [];

interface InstanceResponse {
  readonly id: string;
  readonly version: number;
  readonly configurationVersion: number;
  readonly secretSlots: readonly { readonly slot: string; readonly configured: boolean }[];
}

interface RunResponse {
  readonly id: string;
  readonly triggerActorType: string;
}

interface RequestedRunResponse {
  readonly run: RunResponse;
  readonly replayed: boolean;
}

const definition: ConnectorDefinition<{ schemaVersion: 1; endpointLabel: string }> = {
  connectorType,
  configurationSchemaVersion: 1,
  capabilities: ['ASSET_INVENTORY'],
  supportedObservationTypes: ['ASSET'],
  requiredSecretSlots: ['bind-password'],
  workerPolicy: {
    concurrency: 1,
    retryLimit: 2,
    retryDelaySeconds: 1,
    retryBackoff: true,
    expireInSeconds: 60,
    heartbeatSeconds: 10,
  },
  validateConfig(input) {
    if (
      typeof input !== 'object' ||
      input === null ||
      (input as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (input as { endpointLabel?: unknown }).endpointLabel !== 'string'
    ) {
      throw new Error('invalid synthetic configuration');
    }
    return input as { schemaVersion: 1; endpointLabel: string };
  },
  async *collect(): AsyncIterable<ConnectorAssetObservation> {
    await Promise.resolve();
    yield* [] as ConnectorAssetObservation[];
  },
};

const execution = {
  config: { enabled: false, payloadMaxBytes: 65_536 },
  enqueueWithinTransaction: jest.fn(
    async (_transaction: unknown, _queueName: string, envelope: AtlasJobEnvelope) => {
      await Promise.resolve();
      queued.push(envelope as AtlasJobEnvelope<ConnectorRunJobPayload>);
      return randomUUID();
    },
  ),
};

describe('Connector Management Control Plane (e2e)', () => {
  let auth: TestAuthHarness;
  let app: INestApplication;
  let emptyApp: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let viewerToken: string;
  let analystToken: string;
  let serviceToken: string;

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    auth = await startTestAuthHarness();
    process.env.AUTH_SERVICE_ACTORS_JSON = JSON.stringify([
      {
        clientId: TEST_AUTH_SERVICE_CLIENT_ID,
        subject: TEST_AUTH_SERVICE_SUBJECT,
        displayName: TEST_AUTH_SERVICE_DISPLAY_NAME,
        permissions: [ATLAS_PERMISSIONS.connectorRead, ATLAS_PERMISSIONS.connectorExecute],
      },
    ]);
    app = await createApp([definition]);
    emptyApp = await createApp([]);
    prisma = app.get(PrismaService);
    adminToken = await auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_ADMIN_ROLE] });
    viewerToken = await auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_VIEWER_ROLE] });
    analystToken = await auth.issueToken({
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_ANALYST_ROLE],
    });
    serviceToken = await auth.issueToken({
      subject: TEST_AUTH_SERVICE_SUBJECT,
      clientId: TEST_AUTH_SERVICE_CLIENT_ID,
      roles: [TEST_AUTH_ACCESS_VALUE],
    });
  }, 30_000);

  afterAll(async () => {
    const runIds = (
      await prisma.connectorRun.findMany({
        where: { connectorInstanceId: { in: [...createdInstanceIds] } },
        select: { id: true },
      })
    ).map(({ id }) => id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ entityId: { in: [...createdInstanceIds] } }, { entityId: { in: runIds } }],
      },
    });
    await prisma.connectorRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.connectorSecretReference.deleteMany({
      where: { connectorInstanceId: { in: [...createdInstanceIds] } },
    });
    await prisma.connectorInstance.deleteMany({ where: { id: { in: [...createdInstanceIds] } } });
    if (emptyApp) await emptyApp.close();
    if (app) await app.close();
    if (auth) await auth.close();
  });

  it('keeps production definitions empty and exposes only safe definition metadata', async () => {
    const production = await authorized(emptyApp, adminToken)
      .get('/connectors/definitions')
      .expect(200);
    expect(production.body).toEqual([]);

    const response = await authorized(app, viewerToken).get('/connectors/definitions').expect(200);
    expect(response.body).toEqual([
      {
        connectorType,
        configurationSchemaVersion: 1,
        capabilities: ['ASSET_INVENTORY'],
        supportedObservationTypes: ['ASSET'],
        requiredSecretSlots: ['bind-password'],
      },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/workerPolicy|queue|collect|validateConfig/);
  });

  it('enforces VIEWER, ANALYST, ADMIN and explicit SERVICE permissions', async () => {
    await authorized(app, viewerToken).get('/connectors/instances').expect(200);
    await authorized(app, viewerToken)
      .post('/connectors/instances')
      .send(validCreate())
      .expect(403);
    await authorized(app, viewerToken)
      .post(`/connectors/instances/${randomUUID()}/runs`)
      .set('Idempotency-Key', 'viewer-request')
      .expect(403);

    await authorized(app, analystToken).get('/connectors/runs').expect(200);
    await authorized(app, analystToken)
      .post('/connectors/instances')
      .send(validCreate())
      .expect(403);
    await authorized(app, analystToken)
      .post(`/connectors/instances/${randomUUID()}/runs`)
      .set('Idempotency-Key', 'analyst-request')
      .expect(404);

    await authorized(app, serviceToken).get('/connectors/instances').expect(200);
    await authorized(app, serviceToken)
      .post('/connectors/instances')
      .send(validCreate())
      .expect(403);
    await authorized(app, serviceToken)
      .post(`/connectors/instances/${randomUUID()}/runs`)
      .set('Idempotency-Key', 'service-request')
      .expect(404);

    await request(serverOf(app)).get('/connectors/instances').expect(401);
  });

  it('creates a disabled instance atomically and rejects unsafe configurations', async () => {
    const created = await createInstance();
    expect(created).toEqual(
      expect.objectContaining({
        connectorType,
        enabled: false,
        configurationVersion: 1,
        version: 1,
        configuration: { schemaVersion: 1, endpointLabel: 'synthetic' },
        secretSlots: [],
      }),
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: created.id, action: 'CONNECTOR_INSTANCE_CREATED' },
    });
    expect(JSON.stringify(audit)).not.toContain('endpointLabel');
    expect(JSON.stringify(audit)).toMatch(/[a-f0-9]{64}/);

    for (const configuration of [
      { schemaVersion: 1, endpointLabel: 'x', password: 'synthetic' },
      {
        schemaVersion: 1,
        endpointLabel: 'x',
        nested: { providerKind: 'ENV', logicalKey: 'SYNTHETIC_CONNECTOR_VALUE' },
      },
      { schemaVersion: 1, endpointLabel: 'x'.repeat(65_537) },
    ]) {
      await authorized(app, adminToken)
        .post('/connectors/instances')
        .send({ ...validCreate(), configuration })
        .expect(400);
    }
    await authorized(app, adminToken)
      .post('/connectors/instances')
      .send({ ...validCreate(), connectorType: 'unknown-connector' })
      .expect(400);
  });

  it('rejects non-JSON object graphs and fails closed on unsafe persisted configuration', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const withAccessor = {};
    Object.defineProperty(withAccessor, 'value', {
      enumerable: true,
      get: () => 'synthetic',
    });
    for (const unsafe of [cyclic, withAccessor, new Proxy({}, {}), [1, 2], { value: Infinity }]) {
      expect(() => parseConnectorConfiguration(unsafe)).toThrow(
        expect.objectContaining({ code: 'CONNECTOR_CONFIG_INVALID' }),
      );
    }

    const created = await createInstance();
    await prisma.connectorInstance.update({
      where: { id: created.id },
      data: { configuration: { password: 'never-reflect-this-value' } },
    });
    const response = await authorized(app, adminToken)
      .get(`/connectors/instances/${String(created.id)}`)
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('never-reflect-this-value');
  });

  it('uses atomic optimistic concurrency and preserves configurationVersion', async () => {
    const created = await createInstance();
    const [first, second] = await Promise.all([
      authorized(app, adminToken)
        .patch(`/connectors/instances/${created.id}`)
        .send({ expectedVersion: 1, name: 'First winner' }),
      authorized(app, adminToken)
        .patch(`/connectors/instances/${created.id}`)
        .send({
          expectedVersion: 1,
          configuration: { schemaVersion: 1, endpointLabel: 'second' },
        }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = instanceResponse((first.status === 200 ? first.body : second.body) as unknown);
    expect(winner.version).toBe(2);
    expect(winner.configurationVersion).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: created.id, action: 'CONNECTOR_INSTANCE_UPDATED' },
      }),
    ).toBe(1);
    const persisted = await prisma.connectorInstance.findUniqueOrThrow({
      where: { id: created.id },
    });
    const stale = await authorized(app, adminToken)
      .patch(`/connectors/instances/${String(created.id)}`)
      .send({ expectedVersion: 1, name: 'Stale write' })
      .expect(409);
    expect(recordResponse(stale.body as unknown).code).toBe('CONNECTOR_INSTANCE_VERSION_CONFLICT');
    expect(await prisma.auditLog.count({ where: { entityId: created.id } })).toBe(2);
    expect(await prisma.connectorInstance.findUniqueOrThrow({ where: { id: created.id } })).toEqual(
      persisted,
    );
  });

  it('rejects configuration edits across schema versions while preserving safe disable', async () => {
    const created = await createInstance();
    await prisma.connectorInstance.update({
      where: { id: created.id },
      data: { configurationVersion: 2, enabled: true },
    });
    await authorized(app, adminToken)
      .patch(`/connectors/instances/${created.id}`)
      .send({
        expectedVersion: 1,
        configuration: { schemaVersion: 1, endpointLabel: 'unsupported-update' },
      })
      .expect(400);
    const disabled = await authorized(app, adminToken)
      .patch(`/connectors/instances/${created.id}`)
      .send({ expectedVersion: 1, enabled: false })
      .expect(200);
    expect(instanceResponse(disabled.body as unknown)).toEqual(
      expect.objectContaining({ enabled: false, version: 2, configurationVersion: 2 }),
    );
  });

  it('administers secret locators without disclosure and auto-disables on removal', async () => {
    const created = await createInstance();
    const set = await authorized(app, adminToken)
      .put(`/connectors/instances/${created.id}/secret-references/bind-password`)
      .send({
        expectedVersion: 1,
        providerKind: 'ENV',
        logicalKey: 'SYNTHETIC_CONNECTOR_BIND_PASSWORD',
      })
      .expect(200);
    const setBody = instanceResponse(set.body as unknown);
    expect(setBody).toEqual(expect.objectContaining({ version: 2 }));
    expect(setBody.secretSlots).toEqual([{ slot: 'bind-password', configured: true }]);
    expect(JSON.stringify(setBody)).not.toMatch(/logicalKey|providerKind|SYNTHETIC_CONNECTOR/);

    const enabled = await authorized(app, adminToken)
      .patch(`/connectors/instances/${created.id}`)
      .send({ expectedVersion: 2, enabled: true })
      .expect(200);
    expect(enabled.body).toEqual(expect.objectContaining({ enabled: true, version: 3 }));

    const removed = await authorized(app, adminToken)
      .delete(`/connectors/instances/${created.id}/secret-references/bind-password`)
      .send({ expectedVersion: 3 })
      .expect(200);
    expect(removed.body).toEqual(
      expect.objectContaining({ enabled: false, version: 4, secretSlots: [] }),
    );
    const audits = await prisma.auditLog.findMany({ where: { entityId: created.id } });
    expect(JSON.stringify(audits)).not.toMatch(
      /SYNTHETIC_CONNECTOR_BIND_PASSWORD|logicalKey|providerKind/,
    );

    await authorized(app, adminToken)
      .put(`/connectors/instances/${created.id}/secret-references/undeclared`)
      .send({ expectedVersion: 4, providerKind: 'ENV', logicalKey: 'SYNTHETIC_OTHER_VALUE' })
      .expect(400);
    const unsupported = await authorized(app, adminToken)
      .put(`/connectors/instances/${created.id}/secret-references/bind-password`)
      .send({ expectedVersion: 4, providerKind: 'VAULT', logicalKey: 'SYNTHETIC_OTHER_VALUE' })
      .expect(400);
    expect(recordResponse(unsupported.body as unknown).code).toBe(
      'CONNECTOR_SECRET_PROVIDER_UNSUPPORTED',
    );
    const invalid = await authorized(app, adminToken)
      .put(`/connectors/instances/${created.id}/secret-references/bind-password`)
      .send({ expectedVersion: 4, providerKind: 'ENV', logicalKey: 'DATABASE_URL' })
      .expect(400);
    expect(recordResponse(invalid.body as unknown).code).toBe('CONNECTOR_SECRET_REFERENCE_INVALID');
    await authorized(app, adminToken)
      .patch(`/connectors/instances/${created.id}`)
      .send({ expectedVersion: 4, enabled: true })
      .expect(400);
  });

  it('creates requested run, enqueue and audit once across an idempotent replay', async () => {
    const created = await createEnabledInstance();
    const key = `request-${randomUUID()}`;
    const beforeJobs = queued.length;
    const first = await authorized(app, adminToken)
      .post(`/connectors/instances/${created.id}/runs`)
      .set('Idempotency-Key', key)
      .expect(202);
    const replay = await authorized(app, adminToken)
      .post(`/connectors/instances/${created.id}/runs`)
      .set('Idempotency-Key', key)
      .expect(202);

    const firstBody = requestedRunResponse(first.body as unknown);
    const replayBody = requestedRunResponse(replay.body as unknown);
    expect(firstBody.replayed).toBe(false);
    expect(replayBody).toEqual({ run: firstBody.run, replayed: true });
    expect(queued).toHaveLength(beforeJobs + 1);
    expect(queued.at(-1)?.payload).toEqual({
      schemaVersion: 1,
      connectorInstanceId: created.id,
      configurationVersion: 1,
      instanceVersion: 3,
    });
    expect(Object.keys(queued.at(-1)?.payload ?? {}).sort()).toEqual(
      ['configurationVersion', 'connectorInstanceId', 'instanceVersion', 'schemaVersion'].sort(),
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: firstBody.run.id, action: 'CONNECTOR_RUN_REQUESTED' },
      }),
    ).toBe(1);
    expect(JSON.stringify(firstBody)).not.toMatch(/requestFingerprint|jobId|queueName|logicalKey/);
    const detail = await authorized(app, adminToken)
      .get(`/connectors/runs/${firstBody.run.id}`)
      .expect(200);
    expect(runResponse(detail.body as unknown).id).toBe(firstBody.run.id);

    const service = await authorized(app, serviceToken)
      .post(`/connectors/instances/${created.id}/runs`)
      .set('Idempotency-Key', `service-${randomUUID()}`)
      .expect(202);
    const serviceBody = requestedRunResponse(service.body as unknown);
    expect(serviceBody.run.triggerActorType).toBe('SERVICE');
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { entityId: serviceBody.run.id } }),
    ).toEqual(expect.objectContaining({ actorType: 'SERVICE' }));
  });

  it('rejects missing/unsafe idempotency keys and rolls back run/audit on enqueue failure', async () => {
    const created = await createEnabledInstance();
    await authorized(app, adminToken).post(`/connectors/instances/${created.id}/runs`).expect(400);
    await authorized(app, adminToken)
      .post(`/connectors/instances/${created.id}/runs`)
      .set('Idempotency-Key', 'contains space')
      .expect(400);

    execution.enqueueWithinTransaction.mockRejectedValueOnce(
      new Error('synthetic enqueue failure'),
    );
    const beforeRuns = await prisma.connectorRun.count({
      where: { connectorInstanceId: created.id },
    });
    await authorized(app, adminToken)
      .post(`/connectors/instances/${created.id}/runs`)
      .set('Idempotency-Key', `failure-${randomUUID()}`)
      .expect(500);
    expect(await prisma.connectorRun.count({ where: { connectorInstanceId: created.id } })).toBe(
      beforeRuns,
    );
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'CONNECTOR_RUN_REQUESTED',
          metadata: { path: ['connectorInstanceId'], equals: created.id },
        },
      }),
    ).toBe(0);
  });

  async function createInstance(): Promise<InstanceResponse> {
    const response = await authorized(app, adminToken)
      .post('/connectors/instances')
      .send(validCreate())
      .expect(201);
    const body = instanceResponse(response.body as unknown);
    createdInstanceIds.add(body.id);
    return body;
  }

  async function createEnabledInstance(): Promise<InstanceResponse> {
    const created = await createInstance();
    await authorized(app, adminToken)
      .put(`/connectors/instances/${created.id}/secret-references/bind-password`)
      .send({
        expectedVersion: 1,
        providerKind: 'ENV',
        logicalKey: 'SYNTHETIC_CONNECTOR_BIND_PASSWORD',
      })
      .expect(200);
    const enabled = await authorized(app, adminToken)
      .patch(`/connectors/instances/${created.id}`)
      .send({ expectedVersion: 2, enabled: true })
      .expect(200);
    return instanceResponse(enabled.body as unknown);
  }
});

async function createApp(definitions: readonly ConnectorDefinition[]): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [AuthModule, PrismaModule, ConnectorFrameworkModule.register(definitions)],
  })
    .overrideProvider(ConnectorExecutionService)
    .useValue(execution)
    .compile();
  const app = module.createNestApplication();
  app.useLogger(false);
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

function authorized(app: INestApplication, token: string) {
  return request.agent(serverOf(app)).set('Authorization', `Bearer ${token}`);
}

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function validCreate() {
  return {
    connectorType,
    name: `Synthetic ${randomUUID()}`,
    configuration: { schemaVersion: 1, endpointLabel: 'synthetic' },
  };
}

function recordResponse(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Expected an object response.');
  }
  return input as Record<string, unknown>;
}

function instanceResponse(input: unknown): InstanceResponse {
  const value = recordResponse(input);
  if (
    typeof value.id !== 'string' ||
    typeof value.version !== 'number' ||
    typeof value.configurationVersion !== 'number' ||
    !Array.isArray(value.secretSlots)
  ) {
    throw new Error('Expected a ConnectorInstance response.');
  }
  return value as unknown as InstanceResponse;
}

function runResponse(input: unknown): RunResponse {
  const value = recordResponse(input);
  if (typeof value.id !== 'string' || typeof value.triggerActorType !== 'string') {
    throw new Error('Expected a ConnectorRun response.');
  }
  return value as unknown as RunResponse;
}

function requestedRunResponse(input: unknown): RequestedRunResponse {
  const value = recordResponse(input);
  if (typeof value.replayed !== 'boolean') throw new Error('Expected a run replay flag.');
  return { run: runResponse(value.run), replayed: value.replayed };
}
