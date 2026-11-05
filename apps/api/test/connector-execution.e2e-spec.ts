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
      poolMax: 2,
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

describe('Connector Execution production compatibility', () => {
  it('shares one runtime compatibility probe and caches the result', async () => {
    const fixture = fakeBoss();
    const service = new ConnectorExecutionService(
      configFor(true, 'pgboss_runtime_probe'),
      logger,
      () => Promise.resolve(fixture.boss),
    );
    await service.onApplicationBootstrap();
    fixture.schemaVersion.mockClear();
    fixture.detectSchemaDrift.mockClear();
    const pending = deferred<number>();
    fixture.schemaVersion.mockImplementation(() => pending.promise);

    const first = service.isReady();
    const second = service.isReady();
    expect(fixture.schemaVersion).toHaveBeenCalledTimes(1);
    pending.resolve(42);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fixture.detectSchemaDrift).toHaveBeenCalledTimes(1);

    await expect(service.isReady()).resolves.toBe(true);
    expect(fixture.schemaVersion).toHaveBeenCalledTimes(1);
    await service.onApplicationShutdown();
  });

  it('fails closed on timeout and recovers after the negative cache expires', async () => {
    jest.useFakeTimers();
    const fixture = fakeBoss();
    const service = new ConnectorExecutionService(
      configFor(true, 'pgboss_runtime_recovery'),
      logger,
      () => Promise.resolve(fixture.boss),
    );
    try {
      await service.onApplicationBootstrap();
      fixture.schemaVersion.mockClear();
      fixture.detectSchemaDrift.mockClear();
      const pending = deferred<number>();
      fixture.schemaVersion.mockImplementationOnce(() => pending.promise);

      const timedProbe = service.isReady();
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(timedProbe).resolves.toBe(false);
      pending.resolve(42);
      await Promise.resolve();
      await Promise.resolve();

      fixture.schemaVersion.mockResolvedValue(42);
      await jest.advanceTimersByTimeAsync(5_001);
      await expect(service.isReady()).resolves.toBe(true);
      expect(fixture.detectSchemaDrift).toHaveBeenCalled();
    } finally {
      await service.onApplicationShutdown();
      jest.useRealTimers();
    }
  });

  it('fails runtime readiness when schema drift is detected', async () => {
    const fixture = fakeBoss();
    const service = new ConnectorExecutionService(
      configFor(true, 'pgboss_runtime_drift'),
      logger,
      () => Promise.resolve(fixture.boss),
    );
    await service.onApplicationBootstrap();
    fixture.schemaVersion.mockClear();
    fixture.detectSchemaDrift.mockClear();
    fixture.detectSchemaDrift.mockResolvedValue({ ok: false });

    await expect(service.isReady()).resolves.toBe(false);
    await service.onApplicationShutdown();
  });

  it('fails runtime readiness on schema mismatch without running drift detection', async () => {
    const fixture = fakeBoss();
    const service = new ConnectorExecutionService(
      configFor(true, 'pgboss_runtime_mismatch'),
      logger,
      () => Promise.resolve(fixture.boss),
    );
    await service.onApplicationBootstrap();
    fixture.schemaVersion.mockClear();
    fixture.detectSchemaDrift.mockClear();
    fixture.schemaVersion.mockResolvedValue(41);

    await expect(service.isReady()).resolves.toBe(false);
    expect(fixture.detectSchemaDrift).not.toHaveBeenCalled();
    await service.onApplicationShutdown();
  });

  it('fails runtime readiness safely when the compatibility probe rejects', async () => {
    const fixture = fakeBoss();
    const service = new ConnectorExecutionService(
      configFor(true, 'pgboss_runtime_error'),
      logger,
      () => Promise.resolve(fixture.boss),
    );
    await service.onApplicationBootstrap();
    fixture.schemaVersion.mockClear();
    fixture.schemaVersion.mockRejectedValue(new Error('NEVER_LOG_RUNTIME_PROBE_DETAIL'));

    await expect(service.isReady()).resolves.toBe(false);
    expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toContain(
      'NEVER_LOG_RUNTIME_PROBE_DETAIL',
    );
    await service.onApplicationShutdown();
  });

  it('uses separate source and dead-letter retention values', async () => {
    const fixture = fakeBoss();
    const config = {
      ...configFor(true, 'pgboss_retention'),
      sourceRetentionSeconds: 86_400,
      dlqRetentionSeconds: 2_592_000,
    };
    const service = new ConnectorExecutionService(config, logger, () =>
      Promise.resolve(fixture.boss),
    );
    await service.onApplicationBootstrap();
    await service.registerWorker({
      queueName: 'atlas.test.retention',
      deadLetterQueue: 'atlas.test.retention.dead',
      concurrency: 1,
      retryLimit: 1,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      handler: () => Promise.resolve(),
    });

    expect(fixture.createQueue).toHaveBeenNthCalledWith(
      1,
      'atlas.test.retention.dead',
      expect.objectContaining({ deleteAfterSeconds: 2_592_000 }),
    );
    expect(fixture.createQueue).toHaveBeenNthCalledWith(
      2,
      'atlas.test.retention',
      expect.objectContaining({ deleteAfterSeconds: 86_400 }),
    );
    expect(fixture.updateQueue).toHaveBeenNthCalledWith(
      1,
      'atlas.test.retention.dead',
      expect.objectContaining({ deleteAfterSeconds: 2_592_000 }),
    );
    expect(fixture.updateQueue).toHaveBeenNthCalledWith(
      2,
      'atlas.test.retention',
      expect.objectContaining({ deleteAfterSeconds: 86_400 }),
    );
    await service.onApplicationShutdown();
  });

  it('warns on backlog and DLQ depth without failing runtime readiness', async () => {
    const fixture = fakeBoss();
    const service = new ConnectorExecutionService(
      configFor(true, 'pgboss_operational_warning'),
      logger,
      () => Promise.resolve(fixture.boss),
    );
    await service.onApplicationBootstrap();
    await service.registerWorker({
      queueName: 'atlas.test.warning',
      deadLetterQueue: 'atlas.test.warning.dead',
      concurrency: 1,
      retryLimit: 1,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      handler: () => Promise.resolve(),
    });
    const snapshot = jest.spyOn(service, 'getOperationalSnapshot').mockResolvedValue({
      execution: service.getState(),
      queues: [
        {
          queueName: 'atlas.test.warning',
          created: 2,
          retry: 1,
          queued: 3,
          active: 0,
          failed: 0,
          total: 3,
          capturedAt: new Date().toISOString(),
          oldestReadyAt: new Date(Date.now() - 600_000).toISOString(),
          oldestReadyAgeMs: 600_000,
          deadLetterQueue: 'atlas.test.warning.dead',
          deadLetterQueued: 1,
        },
      ],
    });
    (logger.warn as jest.Mock).mockClear();

    await (
      service as unknown as { sampleOperationalState(): Promise<void> }
    ).sampleOperationalState();

    const warningRecords = (logger.warn as jest.Mock).mock.calls.map(([record]) => record);
    expect(warningRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'connector_execution.queue.oldest_ready_warning' }),
        expect.objectContaining({ event: 'connector_execution.dlq.warning' }),
      ]),
    );
    await expect(service.isReady()).resolves.toBe(true);
    await service.onApplicationShutdown();
    snapshot.mockClear();
    (service as unknown as { startOperationalSampling(): void }).startOperationalSampling();
    await Promise.resolve();
    expect(snapshot.mock.calls).toHaveLength(0);
  });

  it.each([
    ['CONNECTOR_EXECUTION_SOURCE_RETENTION_SECONDS', '86399'],
    ['CONNECTOR_EXECUTION_DLQ_RETENTION_SECONDS', '7776001'],
    ['CONNECTOR_EXECUTION_OLDEST_READY_WARNING_SECONDS', '59'],
    ['CONNECTOR_EXECUTION_DLQ_WARNING_DEPTH', '0'],
    ['CONNECTOR_EXECUTION_OBSERVABILITY_INTERVAL_SECONDS', '14'],
    ['CONNECTOR_EXECUTION_RECONCILIATION_INTERVAL_SECONDS', '3601'],
    ['CONNECTOR_EXECUTION_RECONCILIATION_BATCH_SIZE', '101'],
    ['CONNECTOR_EXECUTION_MISSING_JOB_GRACE_SECONDS', '3599'],
    ['CONNECTOR_EXECUTION_SOURCE_RETENTION_SECONDS', '604800.5'],
  ])('rejects invalid %s configuration', (name, value) => {
    const previous = process.env[name];
    process.env[name] = value;
    try {
      expect(() => new ConnectorExecutionConfig()).toThrow(`${name} deve ser inteiro entre`);
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
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
      created: expect.any(Number),
      retry: expect.any(Number),
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
    const activeId = await enqueueSynthetic(service, observedQueue, 'active');
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
    await setJobMetadata(observerBoss, queueSchema, observedQueue, activeId, {
      createdOn: inactiveCreatedAt,
      state: 'active',
    });
    await setJobMetadata(observerBoss, queueSchema, isolatedQueue, otherQueueId, {
      createdOn: otherQueueCreatedAt,
      state: 'created',
    });

    const before = await observerBoss.getJobById(observedQueue, oldestId);
    const state = await service.getQueueState(observedQueue);
    const after = await observerBoss.getJobById(observedQueue, oldestId);

    expect(state).toEqual(
      expect.objectContaining({ created: 2, retry: 1, queued: 3, active: 1, failed: 1, total: 6 }),
    );
    expect(state.oldestReadyAt).toBe(oldestReadyAt.toISOString());
    expect(state.oldestReadyAgeMs).toBeGreaterThanOrEqual(120_000);
    expect(state.oldestReadyAgeMs).toBeLessThan(130_000);
    expect(Object.keys(state).sort()).toEqual(
      [
        'active',
        'capturedAt',
        'created',
        'failed',
        'oldestReadyAgeMs',
        'oldestReadyAt',
        'queueName',
        'queued',
        'retry',
        'total',
      ].sort(),
    );
    expect(after?.state).toBe(before?.state);
    expect(after?.id).toBe(before?.id);
  });

  it.each(['created', 'retry', 'active'] as const)(
    'classifies correlated source work in %s as LIVE',
    async (jobState) => {
      const source = `atlas.test.infrastructure-live-${jobState}`;
      const deadLetter = `${source}.dead`;
      const runId = randomUUID();
      await prepareQueue(service, source, deadLetter);
      const jobId = await service.enqueue(
        source,
        createAtlasJobEnvelope({
          runId,
          payload: {},
          idempotencyKey: `infrastructure-live:${randomUUID()}`,
          maxBytes: 4096,
        }),
        { singletonKey: runId },
      );
      await setJobMetadata(observerBoss, queueSchema, source, jobId, {
        createdOn: new Date(),
        state: jobState,
      });

      expect(await service.inspectRunInfrastructure(source, deadLetter, runId)).toEqual(
        expect.objectContaining({
          state: 'LIVE',
          sourceLiveCount: 1,
          sourceExhaustedCount: 0,
          deadLetterCount: 0,
        }),
      );
    },
  );

  it('classifies only a failed source job with exhausted retries as TERMINAL', async () => {
    const source = 'atlas.test.infrastructure-exhausted';
    const deadLetter = `${source}.dead`;
    const runId = randomUUID();
    await prepareQueue(service, source, deadLetter);
    const jobId = await service.enqueue(
      source,
      createAtlasJobEnvelope({
        runId,
        payload: {},
        idempotencyKey: `infrastructure-exhausted:${randomUUID()}`,
        maxBytes: 4096,
      }),
      { singletonKey: runId },
    );
    await setJobMetadata(observerBoss, queueSchema, source, jobId, {
      createdOn: new Date(),
      state: 'failed',
      retryCount: 2,
      retryLimit: 2,
    });

    expect(await service.inspectRunInfrastructure(source, deadLetter, runId)).toEqual(
      expect.objectContaining({
        state: 'TERMINAL',
        sourceLiveCount: 0,
        sourceExhaustedCount: 1,
        deadLetterCount: 0,
      }),
    );
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
    const snapshot = await service.getOperationalSnapshot();
    expect(snapshot.execution).toEqual(
      expect.objectContaining({ enabled: true, ready: true, schemaVersion: 42, poolMax: 2 }),
    );
    expect(snapshot.queues).toEqual([
      expect.objectContaining({
        queueName: retryQueue,
        deadLetterQueue: retryDlq,
        created: expect.any(Number),
        retry: expect.any(Number),
        queued: expect.any(Number),
        active: expect.any(Number),
        failed: expect.any(Number),
        total: expect.any(Number),
        deadLetterQueued: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /payload|configuration|logicalKey|idempotencyKey|requestIdentity|databaseUrl/i,
    );
    (logger.log as jest.Mock).mockClear();
    (logger.error as jest.Mock).mockClear();
    await service.enqueue(
      retryQueue,
      createAtlasJobEnvelope({ payload: {}, idempotencyKey, maxBytes: 4096 }),
    );
    await waitFor(() => observed.length === 2);
    expect(observed).toEqual([
      { key: idempotencyKey, retryCount: 0, retryLimit: 1 },
      { key: idempotencyKey, retryCount: 1, retryLimit: 1 },
    ]);
    const jobLogs = [
      ...(logger.log as jest.Mock).mock.calls,
      ...(logger.error as jest.Mock).mock.calls,
    ]
      .map(([record]) => record as Record<string, unknown>)
      .filter(({ queueName }) => queueName === retryQueue);
    expect(jobLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'connector_execution.job.started',
          runId: expect.any(String),
          retryCount: 0,
          retryLimit: 1,
        }),
        expect.objectContaining({
          event: 'connector_execution.job.failed',
          runId: expect.any(String),
          retryCount: 0,
          retryLimit: 1,
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          event: 'connector_execution.job.completed',
          runId: expect.any(String),
          retryCount: 1,
          retryLimit: 1,
          durationMs: expect.any(Number),
        }),
      ]),
    );
    expect(JSON.stringify(jobLogs)).not.toContain(idempotencyKey);
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
    const runId = randomUUID();
    await service.enqueue(
      source,
      createAtlasJobEnvelope({
        runId,
        payload: {},
        idempotencyKey: `dlq:${randomUUID()}`,
        maxBytes: 4096,
      }),
      { singletonKey: runId },
    );
    await waitFor(async () => (await countJobs(observerBoss, dlq, true)) === 1);
    const snapshot = await service.getOperationalSnapshot();
    expect(snapshot.queues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queueName: source,
          deadLetterQueue: dlq,
          deadLetterQueued: 1,
        }),
      ]),
    );
    await expect(service.isReady()).resolves.toBe(true);
    expect(await service.inspectRunInfrastructure(source, dlq, runId)).toEqual(
      expect.objectContaining({ state: 'TERMINAL', deadLetterCount: 1 }),
    );
    await service.stopWorker(source);
    expect(await service.redrive(dlq, source, 1)).toBe(1);
    expect(await countJobs(observerBoss, source, true)).toBeGreaterThanOrEqual(1);
    expect(await service.inspectRunInfrastructure(source, dlq, runId)).toEqual(
      expect.objectContaining({ state: 'LIVE', sourceLiveCount: 1 }),
    );
    expect(JSON.stringify((logger.error as jest.Mock).mock.calls)).not.toContain(
      'synthetic terminal failure',
    );
  }, 20_000);

  it('recovers readiness after owned PostgreSQL sessions are interrupted', async () => {
    await prisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'atlas-connector-execution' AND pid <> pg_backend_pid()`,
    );
    // Let the bounded compatibility cache expire so this assertion proves a
    // real post-interruption probe instead of observing the previous success.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_100));
    await waitFor(async () => {
      if (!(await service.isReady())) return false;
      try {
        // Exercise the recovered pool beyond the compatibility calls so no
        // terminated client leaks into the following test.
        await service.getQueueState(queueName);
        await service.getQueueState(queueName);
        return true;
      } catch {
        return false;
      }
    }, 15_000);
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
    sourceRetentionSeconds: 604_800,
    dlqRetentionSeconds: 2_592_000,
    oldestReadyWarningSeconds: 300,
    dlqWarningDepth: 1,
    observabilityIntervalSeconds: 60,
    reconciliationIntervalSeconds: 60,
    reconciliationBatchSize: 100,
    missingJobGraceSeconds: 86_400,
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
    readonly state: 'created' | 'retry' | 'active' | 'completed' | 'failed';
    readonly retryCount?: number;
    readonly retryLimit?: number;
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
         state = $5,
         retry_count = COALESCE($6, retry_count),
         retry_limit = COALESCE($7, retry_limit)
     WHERE name = $1 AND id = $2::uuid`,
    [
      queueName,
      jobId,
      input.createdOn,
      input.startAfter ?? null,
      input.state,
      input.retryCount ?? null,
      input.retryLimit ?? null,
    ],
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

function fakeBoss() {
  const schemaVersion = jest.fn<() => Promise<number>>().mockResolvedValue(42);
  const detectSchemaDrift = jest
    .fn<() => Promise<{ ok: boolean }>>()
    .mockResolvedValue({ ok: true });
  const createQueue = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
  const updateQueue = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
  const boss = {
    on: jest.fn(),
    start: jest.fn<() => Promise<void>>().mockResolvedValue(),
    stop: jest.fn<() => Promise<void>>().mockResolvedValue(),
    schemaVersion,
    detectSchemaDrift,
    createQueue,
    updateQueue,
    work: jest.fn<() => Promise<string>>().mockResolvedValue('worker-test-id'),
    offWork: jest.fn<() => Promise<void>>().mockResolvedValue(),
  } as unknown as PgBoss;
  return { boss, schemaVersion, detectSchemaDrift, createQueue, updateQueue };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
