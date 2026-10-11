import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { PgBoss } from 'pg-boss';

import { createPgBoss } from '../src/connector-execution/connector-execution.adapter';
import { ConnectorExecutionConfig } from '../src/connector-execution/connector-execution.config';
import { createAtlasJobEnvelope } from '../src/connector-execution/connector-execution-envelope';
import { ConnectorExecutionService } from '../src/connector-execution/connector-execution.service';
import type { JsonValue } from '../src/connector-execution/connector-execution.types';
import type { OperationalLogger } from '../src/operational-context/operational-logger.service';
import { PrismaService } from '../src/prisma/prisma.service';

const logger = {
  debug: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as OperationalLogger;

describe('Connector Execution lifecycle boundaries', () => {
  it('opens no pg-boss connection while disabled', async () => {
    const factory = jest.fn<typeof createPgBoss>();
    const service = new ConnectorExecutionService(configFor(false, 'unused'), logger, factory);
    await service.onApplicationBootstrap();
    expect(factory).not.toHaveBeenCalled();
    expect(service.getState()).toEqual({
      enabled: false,
      ready: true,
      status: 'disabled',
      workerCount: 0,
    });
  });

  it('fails closed without creating an incompatible schema when migrate:false', async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for integration tests.');
    const schema = uniqueName('pgboss_unmigrated');
    const service = new ConnectorExecutionService(configFor(true, schema), logger, createPgBoss);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'Connector Execution failed to initialize.',
    );
    const prisma = new PrismaService();
    await prisma.$connect();
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
        'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists',
        schema,
      );
      expect(rows[0]?.exists).toBe(false);
    } finally {
      await prisma.$disconnect();
    }
  });
});

describe('Connector Execution with ephemeral schemas', () => {
  let prisma: PrismaService;
  let service: ConnectorExecutionService;
  let migrationBoss: PgBoss;
  let observerBoss: PgBoss;
  const queueSchema = uniqueName('pgboss_atlas_test');
  const domainSchema = uniqueName('atlas_queue_test');
  const domainTable = 'domain_write';
  const queueName = 'atlas.test.atomicity';
  const deadLetterQueue = 'atlas.test.atomicity.dead';

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${domainSchema}"`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "${domainSchema}"."${domainTable}" (id uuid PRIMARY KEY, value text NOT NULL)`,
    );

    const { PgBoss } = await import('pg-boss');
    migrationBoss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: queueSchema,
      max: 1,
      migrate: true,
      schedule: false,
      supervise: false,
    });
    await migrationBoss.start();
    expect(await migrationBoss.schemaVersion()).toBe(42);
    await migrationBoss.stop({ graceful: true, close: true });

    // The explicit operation is safe to repeat on an already compatible schema.
    migrationBoss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: queueSchema,
      max: 1,
      migrate: true,
      schedule: false,
      supervise: false,
    });
    await migrationBoss.start();
    expect(await migrationBoss.schemaVersion()).toBe(42);
    await migrationBoss.stop({ graceful: true, close: true });

    service = new ConnectorExecutionService(configFor(true, queueSchema), logger, createPgBoss);
    await service.onApplicationBootstrap();
    await prepareQueue(service, queueName, deadLetterQueue);

    observerBoss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: queueSchema,
      max: 1,
      migrate: false,
      schedule: false,
      supervise: false,
    });
    await observerBoss.start();
  }, 30_000);

  afterAll(async () => {
    if (service) await service.onApplicationShutdown();
    if (observerBoss) await observerBoss.stop({ graceful: true, close: true });
    if (prisma) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${queueSchema}" CASCADE`);
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${domainSchema}" CASCADE`);
      await prisma.$disconnect();
    }
  }, 30_000);

  it('starts with migrate:false only after explicit migration and reports ready', async () => {
    expect(service.getState()).toEqual(
      expect.objectContaining({ enabled: true, ready: true, status: 'ready', schemaVersion: 42 }),
    );
    expect(await service.isReady()).toBe(true);
    expect(await service.getQueueState(queueName)).toEqual({
      queueName,
      queued: expect.any(Number),
      active: expect.any(Number),
      failed: expect.any(Number),
      total: expect.any(Number),
      capturedAt: expect.any(String),
    });
  });

  it('persists a durable versioned envelope', async () => {
    const before = await countJobs(observerBoss, queueName);
    await service.enqueue(
      queueName,
      createAtlasJobEnvelope({
        payload: { kind: 'synthetic' },
        idempotencyKey: `durable:${randomUUID()}`,
        maxBytes: 4096,
      }),
    );
    const after = await countJobs(observerBoss, queueName);
    expect(after).toBe(before + 1);
  });

  it('reports only the oldest ready job without reading payloads or mutating jobs', async () => {
    const observedQueue = 'atlas.test.queue-state';
    const isolatedQueue = 'atlas.test.queue-state.other';
    await prepareQueue(service, observedQueue, `${observedQueue}.dead`);
    await prepareQueue(service, isolatedQueue, `${isolatedQueue}.dead`);

    const empty = await service.getQueueState(observedQueue);
    expect(empty.oldestReadyAt).toBeUndefined();
    expect(empty.oldestReadyAgeMs).toBeUndefined();

    const now = Date.now();
    const oldestReadyAt = new Date(now - 120_000);
    const laterReadyAt = new Date(now - 60_000);
    const deferredCreatedAt = new Date(now - 600_000);
    const inactiveCreatedAt = new Date(now - 900_000);
    const otherQueueCreatedAt = new Date(now - 1_200_000);
    const futureStart = new Date(now + 3_600_000);

    const oldestId = await enqueueSynthetic(service, observedQueue, 'oldest-ready');
    const laterId = await enqueueSynthetic(service, observedQueue, 'later-ready');
    const deferredId = await service.enqueue(
      observedQueue,
      createAtlasJobEnvelope({
        payload: { marker: 'deferred-with-older-created-on' },
        idempotencyKey: `queue-state:${randomUUID()}`,
        maxBytes: 4096,
      }),
      { startAfter: futureStart },
    );
    const completedId = await enqueueSynthetic(service, observedQueue, 'completed');
    const failedId = await enqueueSynthetic(service, observedQueue, 'failed');
    const otherQueueId = await enqueueSynthetic(service, isolatedQueue, 'other-queue');

    await setJobMetadata(observerBoss, queueSchema, observedQueue, oldestId, {
      createdOn: oldestReadyAt,
      state: 'created',
    });
    await setJobMetadata(observerBoss, queueSchema, observedQueue, laterId, {
      createdOn: laterReadyAt,
      state: 'retry',
    });
    await setJobMetadata(observerBoss, queueSchema, observedQueue, deferredId, {
      createdOn: deferredCreatedAt,
      startAfter: futureStart,
      state: 'created',
    });
    await setJobMetadata(observerBoss, queueSchema, observedQueue, completedId, {
      createdOn: inactiveCreatedAt,
      state: 'completed',
    });
    await setJobMetadata(observerBoss, queueSchema, observedQueue, failedId, {
      createdOn: inactiveCreatedAt,
      state: 'failed',
    });
    await setJobMetadata(observerBoss, queueSchema, isolatedQueue, otherQueueId, {
      createdOn: otherQueueCreatedAt,
      state: 'created',
    });

    const before = await observerBoss.getJobById(observedQueue, oldestId);
    const state = await service.getQueueState(observedQueue);
    const after = await observerBoss.getJobById(observedQueue, oldestId);

    expect(state.oldestReadyAt).toBe(oldestReadyAt.toISOString());
    expect(state.oldestReadyAgeMs).toBeGreaterThanOrEqual(120_000);
    expect(state.oldestReadyAgeMs).toBeLessThan(130_000);
    expect(Object.keys(state).sort()).toEqual(
      [
        'active',
        'capturedAt',
        'failed',
        'oldestReadyAgeMs',
        'oldestReadyAt',
        'queueName',
        'queued',
        'total',
      ].sort(),
    );
    expect(after?.state).toBe(before?.state);
    expect(after?.id).toBe(before?.id);
  });

  it('commits a domain write and enqueue in the same Prisma transaction', async () => {
    const id = randomUUID();
    const before = await countJobs(observerBoss, queueName);
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "${domainSchema}"."${domainTable}" (id, value) VALUES ($1::uuid, $2)`,
        id,
        'commit',
      );
      await service.enqueueWithinTransaction(
        transaction,
        queueName,
        createAtlasJobEnvelope({
          payload: { domainId: id },
          idempotencyKey: `commit:${id}`,
          maxBytes: 4096,
        }),
      );
    });

    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${domainSchema}"."${domainTable}" WHERE id = $1::uuid`,
      id,
    );
    const after = await countJobs(observerBoss, queueName);
    expect(rows[0]?.count).toBe(1n);
    expect(after).toBe(before + 1);
  });

  it('rolls back both domain write and enqueue after a forced failure', async () => {
    const id = randomUUID();
    const before = await countJobs(observerBoss, queueName);
    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "${domainSchema}"."${domainTable}" (id, value) VALUES ($1::uuid, $2)`,
          id,
          'rollback',
        );
        await service.enqueueWithinTransaction(
          transaction,
          queueName,
          createAtlasJobEnvelope({
            payload: { domainId: id },
            idempotencyKey: `rollback:${id}`,
            maxBytes: 4096,
          }),
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${domainSchema}"."${domainTable}" WHERE id = $1::uuid`,
      id,
    );
    const after = await countJobs(observerBoss, queueName);
    expect(rows[0]?.count).toBe(0n);
    expect(after).toBe(before);
  });

  it('retries handler logic with the same logical idempotency key', async () => {
    const retryQueue = 'atlas.test.retry';
    const retryDlq = 'atlas.test.retry.dead';
    const idempotencyKey = `retry:${randomUUID()}`;
    const observed: Array<{ key: string; retryCount: number; retryLimit: number }> = [];
    await service.registerWorker({
      queueName: retryQueue,
      deadLetterQueue: retryDlq,
      concurrency: 1,
      retryLimit: 1,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      handler: (_payload, context) => {
        observed.push({
          key: context.idempotencyKey,
          retryCount: context.retryCount,
          retryLimit: context.retryLimit,
        });
        if (observed.length === 1) throw new Error('synthetic failure');
        return Promise.resolve();
      },
    });
    await service.enqueue(
      retryQueue,
      createAtlasJobEnvelope({ payload: {}, idempotencyKey, maxBytes: 4096 }),
    );
    await waitFor(() => observed.length === 2);
    expect(observed).toEqual([
      { key: idempotencyKey, retryCount: 0, retryLimit: 1 },
      { key: idempotencyKey, retryCount: 1, retryLimit: 1 },
    ]);
    await service.stopWorker(retryQueue);
  }, 20_000);

  it('allows two workers without simultaneous duplicate handling of one claim', async () => {
    const concurrentQueue = 'atlas.test.concurrent';
    const concurrentDlq = 'atlas.test.concurrent.dead';
    const secondService = new ConnectorExecutionService(
      configFor(true, queueSchema),
      logger,
      createPgBoss,
    );
    await secondService.onApplicationBootstrap();
    let active = 0;
    let maximumActive = 0;
    let completions = 0;
    const handler = async (): Promise<void> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      completions += 1;
      active -= 1;
    };
    const definition = {
      queueName: concurrentQueue,
      deadLetterQueue: concurrentDlq,
      concurrency: 1,
      retryLimit: 0,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      handler,
    } as const;
    try {
      await service.registerWorker(definition);
      await secondService.registerWorker(definition);
      await service.enqueue(
        concurrentQueue,
        createAtlasJobEnvelope({
          payload: {},
          idempotencyKey: `concurrent:${randomUUID()}`,
          maxBytes: 4096,
        }),
      );
      await waitFor(() => completions === 1);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      expect(completions).toBe(1);
      expect(maximumActive).toBe(1);
    } finally {
      await service.stopWorker(concurrentQueue);
      await secondService.onApplicationShutdown();
    }
  }, 20_000);

  it('moves exhausted work to DLQ and permits controlled redrive', async () => {
    const source = 'atlas.test.dlq';
    const dlq = 'atlas.test.dlq.dead';
    await service.registerWorker({
      queueName: source,
      deadLetterQueue: dlq,
      concurrency: 1,
      retryLimit: 0,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      handler: () => Promise.reject(new Error('synthetic terminal failure')),
    });
    await service.enqueue(
      source,
      createAtlasJobEnvelope({
        payload: {},
        idempotencyKey: `dlq:${randomUUID()}`,
        maxBytes: 4096,
      }),
    );
    await waitFor(async () => (await countJobs(observerBoss, dlq, true)) === 1);
    await service.stopWorker(source);
    expect(await service.redrive(dlq, source, 1)).toBe(1);
    expect(await countJobs(observerBoss, source, true)).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toContain(
      'synthetic terminal failure',
    );
  }, 20_000);

  it('recovers readiness after owned PostgreSQL sessions are interrupted', async () => {
    await prisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'atlas-connector-execution' AND pid <> pg_backend_pid()`,
    );
    await waitFor(() => service.isReady(), 15_000);
    expect(await service.isReady()).toBe(true);
  }, 20_000);

  it('waits for bounded active work during graceful shutdown', async () => {
    const shutdownQueue = 'atlas.test.shutdown';
    const shutdownDlq = 'atlas.test.shutdown.dead';
    let started = false;
    let release!: () => void;
    const released = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await service.registerWorker({
      queueName: shutdownQueue,
      deadLetterQueue: shutdownDlq,
      concurrency: 1,
      retryLimit: 0,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      handler: async () => {
        started = true;
        await released;
      },
    });
    await service.enqueue(
      shutdownQueue,
      createAtlasJobEnvelope({
        payload: {},
        idempotencyKey: `shutdown:${randomUUID()}`,
        maxBytes: 4096,
      }),
    );
    await waitFor(() => started);
    let stopped = false;
    const stopping = service.onApplicationShutdown().then(() => {
      stopped = true;
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  }, 20_000);

  it('uses a bounded pg-boss pool and releases all owned connections on shutdown', async () => {
    const countConnections = async (): Promise<number> => {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE application_name = 'atlas-connector-execution'`,
      );
      return Number(rows[0]?.count ?? 0n);
    };
    expect(await countConnections()).toBeLessThanOrEqual(2);
    await service.onApplicationShutdown();
    await waitFor(async () => (await countConnections()) === 0);
    expect(await countConnections()).toBe(0);
  });
});

function configFor(enabled: boolean, schema: string): ConnectorExecutionConfig {
  return {
    enabled,
    poolMax: 2,
    payloadMaxBytes: 65_536,
    shutdownTimeoutMs: 10_000,
    schema,
    databaseUrl: enabled ? process.env.DATABASE_URL : undefined,
  };
}

async function prepareQueue(
  service: ConnectorExecutionService,
  queueName: string,
  deadLetterQueue: string,
): Promise<void> {
  await service.registerWorker<JsonValue>({
    queueName,
    deadLetterQueue,
    concurrency: 1,
    retryLimit: 0,
    retryDelaySeconds: 0,
    retryBackoff: false,
    expireInSeconds: 30,
    handler: () => Promise.resolve(),
  });
  await service.stopWorker(queueName);
}

async function countJobs(boss: PgBoss, queueName: string, queued = false): Promise<number> {
  return (await boss.findJobs(queueName, { queued })).length;
}

async function enqueueSynthetic(
  service: ConnectorExecutionService,
  queueName: string,
  marker: string,
): Promise<string> {
  return service.enqueue(
    queueName,
    createAtlasJobEnvelope({
      payload: { marker },
      idempotencyKey: `queue-state:${randomUUID()}`,
      maxBytes: 4096,
    }),
  );
}

async function setJobMetadata(
  boss: PgBoss,
  schema: string,
  queueName: string,
  jobId: string,
  input: {
    readonly createdOn: Date;
    readonly startAfter?: Date;
    readonly state: 'created' | 'retry' | 'completed' | 'failed';
  },
): Promise<void> {
  const queue = await boss.getQueue(queueName);
  if (!queue) throw new Error('Queue is unavailable in test fixture.');
  const schemaIdentifier = quoteTestIdentifier(schema);
  const tableIdentifier = quoteTestIdentifier(queue.table);
  await boss.getDb().executeSql(
    `UPDATE ${schemaIdentifier}.${tableIdentifier}
     SET created_on = $3,
         start_after = COALESCE($4, start_after),
         state = $5
     WHERE name = $1 AND id = $2::uuid`,
    [queueName, jobId, input.createdOn, input.startAfter ?? null, input.state],
  );
}

function quoteTestIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error('Invalid test database identifier.');
  }
  return `"${identifier}"`;
}

function uniqueName(prefix: string): string {
  return `${prefix}_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Timed out waiting for Connector Execution state.');
}
