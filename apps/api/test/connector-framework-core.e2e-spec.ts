import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { config as loadEnv } from 'dotenv';
import type { PgBoss } from 'pg-boss';

import {
  connectorQueueName,
  ConnectorDefinitionRegistry,
} from '../src/connector-framework/connector-definition.registry';
import { ConnectorFrameworkError } from '../src/connector-framework/connector-framework.errors';
import type {
  ConnectorAssetObservation,
  ConnectorDefinition,
  ConnectorRunJobPayload,
} from '../src/connector-framework/connector-framework.types';
import { parseConnectorObservation } from '../src/connector-framework/connector-observation';
import { ConnectorRunService } from '../src/connector-framework/connector-run.service';
import { ConnectorRunWorker } from '../src/connector-framework/connector-run.worker';
import { ConnectorSecretSlotResolver } from '../src/connector-framework/connector-secret-slots';
import { createPgBoss } from '../src/connector-execution/connector-execution.adapter';
import { ConnectorExecutionConfig } from '../src/connector-execution/connector-execution.config';
import { ConnectorExecutionService } from '../src/connector-execution/connector-execution.service';
import type {
  AtlasJobEnvelope,
  AtlasWorkerContext,
} from '../src/connector-execution/connector-execution.types';
import { ConnectorRunStatus, ConnectorRunTrigger } from '../src/generated/prisma/client';
import { IngestionService } from '../src/ingestion/ingestion.service';
import type { OperationalLogger } from '../src/operational-context/operational-logger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ResolvedSecret } from '../src/secrets/resolved-secret';
import { SecretResolutionError } from '../src/secrets/secret-resolution.errors';
import type { SecretResolver } from '../src/secrets/secret-resolver.service';

const connectorType = 'synthetic-core-test';
const queueName = connectorQueueName(connectorType);
const testScope = randomUUID();
const actorId = `service:test-connector-core:${testScope}`;
const instanceIds = new Set<string>();

const logger = {
  debug: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as OperationalLogger;

describe('Connector Framework Core (e2e)', () => {
  let prisma: PrismaService;
  let execution: ConnectorExecutionService;
  let observerBoss: PgBoss;
  const queueSchema = `pgboss_core_${testScope.replaceAll('-', '_')}`;

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaService();
    await prisma.$connect();

    const { PgBoss } = await import('pg-boss');
    const migrationBoss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: queueSchema,
      max: 1,
      migrate: true,
      schedule: false,
      supervise: false,
    });
    await migrationBoss.start();
    await migrationBoss.stop({ graceful: true, close: true });

    execution = new ConnectorExecutionService(configFor(queueSchema), logger, createPgBoss);
    await execution.onApplicationBootstrap();
    observerBoss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: queueSchema,
      max: 1,
      migrate: false,
      schedule: false,
      supervise: false,
    });
    await observerBoss.start();
    await observerBoss.createQueue(`${queueName}.dead`, { retryLimit: 0 });
    await observerBoss.createQueue(queueName, {
      retryLimit: 2,
      retryDelay: 0,
      deadLetter: `${queueName}.dead`,
    });
  }, 30_000);

  afterEach(async () => {
    const runs = await prisma.connectorRun.findMany({
      where: { connectorInstanceId: { in: [...instanceIds] } },
      select: { id: true },
    });
    const runIds = runs.map(({ id }) => id);
    const assets = await prisma.assetEvidence.findMany({
      where: { connectorRunId: { in: runIds } },
      select: { assetId: true },
    });
    await prisma.asset.deleteMany({ where: { id: { in: assets.map(({ assetId }) => assetId) } } });
    await prisma.connectorRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.connectorSecretReference.deleteMany({
      where: { connectorInstanceId: { in: [...instanceIds] } },
    });
    await prisma.connectorInstance.deleteMany({ where: { id: { in: [...instanceIds] } } });
    instanceIds.clear();
  });

  afterAll(async () => {
    if (execution) await execution.onApplicationShutdown();
    if (observerBoss) await observerBoss.stop({ graceful: true, close: true });
    if (prisma) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${queueSchema}" CASCADE`);
      await prisma.$disconnect();
    }
  }, 30_000);

  it('registers immutable code-owned definitions and rejects duplicates', () => {
    const definition = createDefinition(() => emitObservations());
    const registry = new ConnectorDefinitionRegistry([definition]);

    expect(registry.get(connectorType)).toEqual(
      expect.objectContaining({ connectorType, configurationSchemaVersion: 1 }),
    );
    expect(() => new ConnectorDefinitionRegistry([definition, definition])).toThrow(
      expect.objectContaining({ code: 'CONNECTOR_DEFINITION_DUPLICATE' }),
    );
    expect(
      () =>
        new ConnectorDefinitionRegistry([
          {
            ...definition,
            workerPolicy: {
              ...definition.workerPolicy,
              retryBackoff: 'true' as unknown as boolean,
            },
          },
        ]),
    ).toThrow(expect.objectContaining({ code: 'CONNECTOR_DEFINITION_INVALID' }));
  });

  it('creates ConnectorRun and queue job atomically, then replays without another job', async () => {
    const instance = await createInstance();
    const service = new ConnectorRunService(
      prisma,
      execution,
      new ConnectorDefinitionRegistry([createDefinition(() => emitObservations())]),
    );
    const input = requestedRun(instance.id, `atomic:${randomUUID()}`);
    const before = await countJobs();

    const first = await service.create(input);
    const afterFirst = await countJobs();
    await prisma.connectorInstance.update({ where: { id: instance.id }, data: { enabled: false } });
    const replay = await service.create(input);
    const afterReplay = await countJobs();

    expect(first.replayed).toBe(false);
    expect(first.run.status).toBe(ConnectorRunStatus.QUEUED);
    expect(first.run.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(replay).toEqual({ run: first.run, replayed: true });
    expect([before, afterFirst, afterReplay]).toEqual([before, before + 1, before + 1]);

    const jobs = await observerBoss.findJobs<AtlasJobEnvelope<ConnectorRunJobPayload>>(queueName, {
      queued: true,
    });
    const job = jobs.find(({ data }) => data.runId === first.run.id);
    expect(job?.data).toEqual(
      expect.objectContaining({
        runId: first.run.id,
        idempotencyKey: first.run.requestFingerprint,
        payload: {
          schemaVersion: 1,
          connectorInstanceId: instance.id,
          configurationVersion: 1,
        },
      }),
    );
    expect(JSON.stringify(job?.data)).not.toMatch(/password|logicalKey|secret/i);
  });

  it('registers only source workers and none for dead-letter queues', async () => {
    const worker = new ConnectorRunWorker(
      prisma,
      execution,
      new ConnectorDefinitionRegistry([createDefinition(() => emitObservations())]),
      {
        resolve: () => Promise.resolve(ResolvedSecret.from('synthetic-value')),
      } as unknown as SecretResolver,
      new IngestionService(prisma),
      logger,
    );

    await worker.onApplicationBootstrap();
    expect(execution.getState().workerCount).toBe(1);
    await worker.onApplicationShutdown();
    expect(execution.getState().workerCount).toBe(0);

    const emptyWorker = new ConnectorRunWorker(
      prisma,
      execution,
      new ConnectorDefinitionRegistry([]),
      {
        resolve: () => Promise.resolve(ResolvedSecret.from('synthetic-value')),
      } as unknown as SecretResolver,
      new IngestionService(prisma),
      logger,
    );
    await emptyWorker.onApplicationBootstrap();
    expect(execution.getState().workerCount).toBe(0);
    await emptyWorker.onApplicationShutdown();
  });

  it('rolls back ConnectorRun when transactional enqueue fails', async () => {
    const instance = await createInstance();
    const requestIdentity = `rollback:${randomUUID()}`;
    const failingExecution = {
      config: execution.config,
      enqueueWithinTransaction: jest.fn(() =>
        Promise.reject(new Error('synthetic enqueue failure')),
      ),
    } as unknown as ConnectorExecutionService;
    const service = new ConnectorRunService(
      prisma,
      failingExecution,
      new ConnectorDefinitionRegistry([createDefinition(() => emitObservations())]),
    );

    await expect(service.create(requestedRun(instance.id, requestIdentity))).rejects.toThrow(
      'synthetic enqueue failure',
    );
    expect(await prisma.connectorRun.count({ where: { connectorInstanceId: instance.id } })).toBe(
      0,
    );
  });

  it('fails closed for disabled instances and invalid trigger actor combinations', async () => {
    const instance = await createInstance(false);
    const service = new ConnectorRunService(
      prisma,
      execution,
      new ConnectorDefinitionRegistry([createDefinition(() => emitObservations())]),
    );
    await expect(
      service.create(requestedRun(instance.id, `disabled:${randomUUID()}`)),
    ).rejects.toMatchObject({
      code: 'CONNECTOR_INSTANCE_DISABLED',
    });
    await expect(
      service.create({
        ...requestedRun(instance.id, `actor:${randomUUID()}`),
        triggerActor: { kind: 'SYSTEM', id: 'system:atlas:connector-scheduler' },
      }),
    ).rejects.toMatchObject({ code: 'CONNECTOR_RUN_REQUEST_INVALID' });
  });

  it('resolves only declared semantic secret slots and never exposes the locator', async () => {
    const resolveSecret = jest.fn<(input: unknown) => Promise<ResolvedSecret>>(() =>
      Promise.resolve(ResolvedSecret.from('synthetic-value')),
    );
    const slots = new ConnectorSecretSlotResolver(
      { resolve: resolveSecret } as unknown as SecretResolver,
      ['bind-password'],
      [{ slot: 'bind-password', providerKind: 'ENV', logicalKey: 'CONNECTOR_TEST_VALUE' }],
    );

    const resolved = await slots.resolve('bind-password');
    expect(resolved.toJSON()).toBe('[REDACTED_SECRET]');
    expect(resolveSecret).toHaveBeenCalledWith({
      providerKind: 'ENV',
      logicalKey: 'CONNECTOR_TEST_VALUE',
    });
    await expect(slots.resolve('unknown-slot')).rejects.toMatchObject({
      code: 'CONNECTOR_SECRET_SLOT_NOT_DECLARED',
    });
    expect(JSON.stringify(slots)).not.toContain('CONNECTOR_TEST_VALUE');
  });

  it('builds stable observation keys and rejects secret material or locator metadata', () => {
    const instanceId = randomUUID();
    const runId = randomUUID();
    const observation = validObservation(`stable-${randomUUID()}`);
    const input = {
      observation,
      connectorType,
      connectorInstanceId: instanceId,
      runId,
      supportedObservationTypes: ['ASSET'],
    } as const;
    const first = parseConnectorObservation(input);
    const second = parseConnectorObservation(input);
    const laterObservation = parseConnectorObservation({
      ...input,
      observation: { ...observation, observedAt: '2026-10-10T12:00:00.000Z' },
    });
    const laterRun = parseConnectorObservation({ ...input, runId: randomUUID() });
    const changedSemanticContent = parseConnectorObservation({
      ...input,
      observation: {
        ...observation,
        asset: { ...observation.asset, operatingSystem: 'Linux' },
      },
    });
    expect(first.connectorObservationKey).toBe(second.connectorObservationKey);
    expect(first.semanticFingerprint).toBe(second.semanticFingerprint);
    expect(first.normalized.connectorRunId).toBe(runId);
    expect(first.normalized.source).toBe(`connector:${connectorType}:${instanceId.toLowerCase()}`);
    expect(laterObservation.semanticFingerprint).toBe(first.semanticFingerprint);
    expect(laterObservation.connectorObservationKey).toBe(first.connectorObservationKey);
    expect((laterObservation.normalized.payload as { observedAt: string }).observedAt).toBe(
      '2026-10-10T12:00:00.000Z',
    );
    expect(laterRun.semanticFingerprint).toBe(first.semanticFingerprint);
    expect(laterRun.connectorObservationKey).not.toBe(first.connectorObservationKey);
    expect(changedSemanticContent.semanticFingerprint).not.toBe(first.semanticFingerprint);
    expect(changedSemanticContent.connectorObservationKey).not.toBe(first.connectorObservationKey);

    expect(() =>
      parseConnectorObservation({
        ...input,
        observation: { ...observation, payload: { clientSecret: 'synthetic-value' } },
      }),
    ).toThrow(ConnectorFrameworkError);
    expect(() =>
      parseConnectorObservation({
        ...input,
        observation: {
          ...observation,
          payload: { reference: { providerKind: 'ENV', logicalKey: 'CONNECTOR_TEST_VALUE' } },
        },
      }),
    ).toThrow(ConnectorFrameworkError);
    expect(() =>
      parseConnectorObservation({
        ...input,
        observation: { ...observation, observedAt: '2026-02-30T12:00:00.000Z' },
      }),
    ).toThrow(ConnectorFrameworkError);
  });

  it('isolates source identity for two instances of the same connector type', async () => {
    const firstInstance = await createInstance();
    const secondInstance = await createInstance();
    const firstRun = await createPersistedRun(firstInstance.id);
    const secondRun = await createPersistedRun(secondInstance.id);
    const observation = validObservation(`shared-provider-record-${randomUUID()}`);
    const ingestion = new IngestionService(prisma);
    const first = parseConnectorObservation({
      observation,
      connectorType,
      connectorInstanceId: firstInstance.id,
      runId: firstRun.id,
      supportedObservationTypes: ['ASSET'],
    });
    const second = parseConnectorObservation({
      observation,
      connectorType,
      connectorInstanceId: secondInstance.id,
      runId: secondRun.id,
      supportedObservationTypes: ['ASSET'],
    });

    expect(first.normalized.source).not.toBe(second.normalized.source);
    await ingestion.ingestNormalizedAsset(first.normalized);
    await ingestion.ingestNormalizedAsset(second.normalized);

    const evidence = await prisma.assetEvidence.findMany({
      where: { connectorRunId: { in: [firstRun.id, secondRun.id] } },
      select: { assetId: true, source: true, sourceRecordId: true },
      orderBy: { source: 'asc' },
    });
    expect(evidence).toHaveLength(2);
    expect(new Set(evidence.map(({ assetId }) => assetId)).size).toBe(2);
    expect(new Set(evidence.map(({ source }) => source)).size).toBe(2);
    expect(new Set(evidence.map(({ sourceRecordId }) => sourceRecordId))).toEqual(
      new Set([observation.providerRecordId]),
    );
  });

  it('ingests a valid observation, completes the run and deduplicates terminal replay', async () => {
    const observation = validObservation(`success-${randomUUID()}`);
    const { run, worker } = await createWorkerRun(
      createDefinition(() => emitObservations(observation)),
    );

    await worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 0, 2));
    await worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 1, 2));

    const persisted = await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persisted).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.COMPLETED,
        observedCount: 1,
        ingestedCount: 1,
        rejectedCount: 0,
        errorCode: null,
      }),
    );
    expect(await prisma.assetEvidence.count({ where: { connectorRunId: run.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId } })).toBe(0);
  });

  it('finishes PARTIAL when one observation is rejected and one is ingested', async () => {
    const valid = validObservation(`partial-${randomUUID()}`);
    const invalid = { ...valid, payload: { authorization: 'synthetic-value' } };
    const { run, worker } = await createWorkerRun(
      createDefinition(() => emitObservations(invalid, valid)),
    );

    await worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 0, 2));
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.PARTIAL,
        observedCount: 2,
        ingestedCount: 1,
        rejectedCount: 1,
        errorCode: 'CONNECTOR_OBSERVATION_REJECTED',
      }),
    );
  });

  it('finishes FAILED when collection completes with only rejected observations', async () => {
    const invalid = {
      ...validObservation(`rejected-${randomUUID()}`),
      payload: { authorization: 'synthetic-value' },
    };
    const { run, worker } = await createWorkerRun(
      createDefinition(() => emitObservations(invalid)),
    );

    await worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 0, 2));
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.FAILED,
        observedCount: 1,
        ingestedCount: 0,
        rejectedCount: 1,
        errorCode: 'CONNECTOR_OBSERVATION_REJECTED',
      }),
    );
  });

  it('keeps the same run RUNNING across retry and completes on the next attempt', async () => {
    let attempt = 0;
    const observation = validObservation(`retry-${randomUUID()}`);
    const { run, worker } = await createWorkerRun(
      createDefinition(async function* () {
        await Promise.resolve();
        attempt += 1;
        if (attempt === 1) throw new Error('synthetic collection failure');
        yield observation;
      }),
    );

    await expect(
      worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 0, 1)),
    ).rejects.toThrow('synthetic collection failure');
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({ status: ConnectorRunStatus.RUNNING, finishedAt: null }),
    );

    await worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 1, 1));
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({ status: ConnectorRunStatus.COMPLETED, ingestedCount: 1 }),
    );
  });

  it('rejects non-positive, unsafe and extended queue payload versions without retry', async () => {
    const collect = jest.fn<ConnectorDefinition['collect']>(() => emitObservations());
    const resolveSecret = jest.fn<() => Promise<ResolvedSecret>>(() =>
      Promise.resolve(ResolvedSecret.from('synthetic-value')),
    );
    const payloads = [
      { configurationVersion: 0 },
      { configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
      { configurationVersion: 1, unexpected: true },
    ];

    for (const payloadExtension of payloads) {
      const { run, worker } = await createWorkerRun(createDefinition(collect), {
        resolve: resolveSecret,
      } as unknown as SecretResolver);
      await expect(
        worker.process(
          {
            schemaVersion: 1,
            connectorInstanceId: run.connectorInstanceId,
            ...payloadExtension,
          },
          workerContext(run.id, 0, 2),
        ),
      ).resolves.toBeUndefined();
      expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
        expect.objectContaining({
          status: ConnectorRunStatus.FAILED,
          errorCode: 'CONNECTOR_RUN_REPLAY_INCONSISTENT',
        }),
      );
    }

    expect(collect).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('fails without provider or secret work when an enqueued instance is disabled', async () => {
    const collect = jest.fn<ConnectorDefinition['collect']>(() => emitObservations());
    const resolveSecret = jest.fn<() => Promise<ResolvedSecret>>(() =>
      Promise.resolve(ResolvedSecret.from('synthetic-value')),
    );
    const { instance, run, worker } = await createWorkerRun(createDefinition(collect), {
      resolve: resolveSecret,
    } as unknown as SecretResolver);
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { enabled: false },
    });

    await expect(
      worker.process(jobPayload(instance.id, 1), workerContext(run.id, 0, 2)),
    ).resolves.toBeUndefined();

    expect(collect).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.FAILED,
        observedCount: 0,
        ingestedCount: 0,
        rejectedCount: 0,
        errorCode: 'CONNECTOR_INSTANCE_DISABLED',
        finishedAt: expect.any(Date),
      }),
    );
  });

  it('fences queued configuration changes before provider or secret work', async () => {
    const collect = jest.fn<ConnectorDefinition['collect']>(() => emitObservations());
    const resolveSecret = jest.fn<() => Promise<ResolvedSecret>>(() =>
      Promise.resolve(ResolvedSecret.from('synthetic-value')),
    );
    const { instance, run, worker } = await createWorkerRun(createDefinition(collect), {
      resolve: resolveSecret,
    } as unknown as SecretResolver);
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { configurationVersion: 2 },
    });

    await expect(
      worker.process(jobPayload(instance.id, 1), workerContext(run.id, 0, 2)),
    ).resolves.toBeUndefined();

    expect(collect).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.FAILED,
        errorCode: 'CONNECTOR_CONFIG_CHANGED',
        finishedAt: expect.any(Date),
      }),
    );
  });

  it('distinguishes an unsupported current configuration version without retry', async () => {
    const collect = jest.fn<ConnectorDefinition['collect']>(() => emitObservations());
    const resolveSecret = jest.fn<() => Promise<ResolvedSecret>>(() =>
      Promise.resolve(ResolvedSecret.from('synthetic-value')),
    );
    const { instance, run, worker } = await createWorkerRun(createDefinition(collect), {
      resolve: resolveSecret,
    } as unknown as SecretResolver);
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { configurationVersion: 2 },
    });

    await expect(
      worker.process(jobPayload(instance.id, 2), workerContext(run.id, 0, 2)),
    ).resolves.toBeUndefined();

    expect(collect).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.FAILED,
        errorCode: 'CONNECTOR_CONFIG_VERSION_UNSUPPORTED',
      }),
    );
  });

  it('retries unavailable secret providers and fails only on the final attempt', async () => {
    const collect = jest.fn<ConnectorDefinition['collect']>(() => emitObservations());
    const resolveSecret = jest.fn<() => Promise<ResolvedSecret>>(() =>
      Promise.reject(new SecretResolutionError('PROVIDER_UNAVAILABLE', 'ENV')),
    );
    const { run, worker } = await createWorkerRun(createDefinition(collect), {
      resolve: resolveSecret,
    } as unknown as SecretResolver);

    await expect(
      worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 0, 1)),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({ status: ConnectorRunStatus.RUNNING, finishedAt: null }),
    );

    await expect(
      worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 1, 1)),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(collect).not.toHaveBeenCalled();
    expect(resolveSecret).toHaveBeenCalledTimes(2);
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.FAILED,
        errorCode: 'SECRET_PROVIDER_UNAVAILABLE',
        finishedAt: expect.any(Date),
      }),
    );
  });

  it('terminalizes a non-retryable secret failure immediately and preserves evidence', async () => {
    const observation = validObservation(`secret-partial-${randomUUID()}`);
    const resolveSecret = jest
      .fn<() => Promise<ResolvedSecret>>()
      .mockResolvedValueOnce(ResolvedSecret.from('synthetic-value'))
      .mockRejectedValueOnce(new SecretResolutionError('SECRET_NOT_FOUND', 'ENV'));
    let collectionAttempts = 0;
    const { run, worker } = await createWorkerRun(
      createDefinition(async function* () {
        await Promise.resolve();
        collectionAttempts += 1;
        yield observation;
        throw new Error('synthetic transient after evidence');
      }),
      { resolve: resolveSecret } as unknown as SecretResolver,
    );

    await expect(
      worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 0, 2)),
    ).rejects.toThrow('synthetic transient after evidence');
    await expect(
      worker.process(jobPayload(run.connectorInstanceId), workerContext(run.id, 1, 2)),
    ).resolves.toBeUndefined();

    expect(collectionAttempts).toBe(1);
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.PARTIAL,
        ingestedCount: 1,
        errorCode: 'SECRET_NOT_FOUND',
        finishedAt: expect.any(Date),
      }),
    );
  });

  it('marks exhausted work FAILED without evidence and PARTIAL after durable evidence', async () => {
    const failed = await createWorkerRun(
      createDefinition(async function* () {
        await Promise.resolve();
        yield* [] as ConnectorAssetObservation[];
        throw new Error('synthetic terminal failure');
      }),
    );
    await expect(
      failed.worker.process(
        jobPayload(failed.run.connectorInstanceId),
        workerContext(failed.run.id, 1, 1),
      ),
    ).rejects.toThrow('synthetic terminal failure');
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: failed.run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.FAILED,
        errorCode: 'CONNECTOR_COLLECTION_FAILED',
      }),
    );

    const observation = validObservation(`terminal-partial-${randomUUID()}`);
    const partial = await createWorkerRun(
      createDefinition(async function* () {
        await Promise.resolve();
        yield observation;
        throw new Error('synthetic failure after evidence');
      }),
    );
    await expect(
      partial.worker.process(
        jobPayload(partial.run.connectorInstanceId),
        workerContext(partial.run.id, 1, 1),
      ),
    ).rejects.toThrow('synthetic failure after evidence');
    expect(await prisma.connectorRun.findUniqueOrThrow({ where: { id: partial.run.id } })).toEqual(
      expect.objectContaining({
        status: ConnectorRunStatus.PARTIAL,
        ingestedCount: 1,
        errorCode: 'CONNECTOR_COLLECTION_FAILED',
      }),
    );
  });

  it('leaves terminally failed jobs waiting in the DLQ and eligible for redrive', async () => {
    const dlqConnectorType = 'synthetic-core-dlq-test';
    const sourceQueue = connectorQueueName(dlqConnectorType);
    const deadLetterQueue = `${sourceQueue}.dead`;
    const baseDefinition = createDefinition(() => emitObservations());
    let attempts = 0;
    const definition: ConnectorDefinition<{ schemaVersion: 1; endpointLabel: string }> = {
      ...baseDefinition,
      collect: async function* () {
        await Promise.resolve();
        attempts += 1;
        yield* [] as ConnectorAssetObservation[];
        throw new Error('synthetic terminal failure');
      },
      connectorType: dlqConnectorType,
      workerPolicy: {
        ...baseDefinition.workerPolicy,
        retryLimit: 0,
      },
    };
    const registry = new ConnectorDefinitionRegistry([definition]);
    const worker = new ConnectorRunWorker(
      prisma,
      execution,
      registry,
      {
        resolve: () => Promise.resolve(ResolvedSecret.from('synthetic-value')),
      } as unknown as SecretResolver,
      new IngestionService(prisma),
      logger,
    );
    const instance = await createInstance(true, dlqConnectorType);
    const runService = new ConnectorRunService(prisma, execution, registry);

    await worker.onApplicationBootstrap();
    try {
      expect(execution.getState().workerCount).toBe(1);
      const { run } = await runService.create(
        requestedRun(instance.id, `dlq-preservation:${randomUUID()}`),
      );

      await waitFor(async () => {
        const persisted = await prisma.connectorRun.findUniqueOrThrow({ where: { id: run.id } });
        const deadJobs = await observerBoss.findJobs<AtlasJobEnvelope<ConnectorRunJobPayload>>(
          deadLetterQueue,
          { queued: true },
        );
        return (
          persisted.status === ConnectorRunStatus.FAILED &&
          deadJobs.some(({ data }) => data.runId === run.id)
        );
      });

      const deadJobs = await observerBoss.findJobs<AtlasJobEnvelope<ConnectorRunJobPayload>>(
        deadLetterQueue,
        { queued: true },
      );
      expect(deadJobs.filter(({ data }) => data.runId === run.id)).toHaveLength(1);
      expect(attempts).toBe(1);
      expect(execution.getState().workerCount).toBe(1);

      await worker.onApplicationShutdown();
      expect(execution.getState().workerCount).toBe(0);
      expect(await execution.redrive(deadLetterQueue, sourceQueue, 1)).toBe(1);
      const redrivenJobs = await observerBoss.findJobs<AtlasJobEnvelope<ConnectorRunJobPayload>>(
        sourceQueue,
        { queued: true },
      );
      expect(redrivenJobs.some(({ data }) => data.runId === run.id)).toBe(true);
    } finally {
      await worker.onApplicationShutdown();
    }
  }, 20_000);

  async function createInstance(enabled = true, type = connectorType) {
    const instance = await prisma.connectorInstance.create({
      data: {
        connectorType: type,
        name: `Synthetic connector ${randomUUID()}`,
        enabled,
        configurationVersion: 1,
        configuration: { schemaVersion: 1, endpointLabel: 'synthetic' },
        secretReferences: {
          create: {
            slot: 'bind-password',
            providerKind: 'ENV',
            logicalKey: 'CONNECTOR_TEST_VALUE',
          },
        },
      },
    });
    instanceIds.add(instance.id);
    return instance;
  }

  async function createPersistedRun(connectorInstanceId: string) {
    return prisma.connectorRun.create({
      data: {
        connectorInstanceId,
        trigger: ConnectorRunTrigger.REQUESTED,
        triggerActorType: 'SERVICE',
        triggerActorId: actorId,
        requestFingerprint: sha256(`${testScope}:${randomUUID()}`),
      },
    });
  }

  async function createWorkerRun(
    definition: ConnectorDefinition,
    secretResolver: SecretResolver = {
      resolve: () => Promise.resolve(ResolvedSecret.from('synthetic-value')),
    } as unknown as SecretResolver,
  ) {
    const instance = await createInstance();
    const run = await createPersistedRun(instance.id);
    const worker = new ConnectorRunWorker(
      prisma,
      execution,
      new ConnectorDefinitionRegistry([definition]),
      secretResolver,
      new IngestionService(prisma),
      logger,
    );
    return { instance, run, worker };
  }

  async function countJobs(): Promise<number> {
    return (await observerBoss.findJobs(queueName, { queued: true })).length;
  }
});

function createDefinition(
  collect: ConnectorDefinition<{ schemaVersion: 1; endpointLabel: string }>['collect'],
): ConnectorDefinition<{ schemaVersion: 1; endpointLabel: string }> {
  return {
    connectorType,
    configurationSchemaVersion: 1,
    capabilities: ['ASSET_INVENTORY'],
    supportedObservationTypes: ['ASSET'],
    requiredSecretSlots: ['bind-password'],
    workerPolicy: {
      concurrency: 1,
      retryLimit: 2,
      retryDelaySeconds: 0,
      retryBackoff: false,
      expireInSeconds: 30,
      heartbeatSeconds: 10,
    },
    validateConfig(input) {
      if (
        typeof input !== 'object' ||
        input === null ||
        (input as { schemaVersion?: unknown }).schemaVersion !== 1 ||
        typeof (input as { endpointLabel?: unknown }).endpointLabel !== 'string'
      ) {
        throw new Error('invalid synthetic config');
      }
      return input as { schemaVersion: 1; endpointLabel: string };
    },
    collect,
  };
}

function validObservation(providerRecordId: string): ConnectorAssetObservation {
  return {
    schemaVersion: 1,
    observationType: 'ASSET',
    providerRecordId,
    observedAt: '2026-10-09T12:00:00.000Z',
    asset: {
      hostname: `host-${providerRecordId}`,
      type: 'SERVER',
      serialNumber: `serial-${providerRecordId}`,
      ipAddresses: ['192.0.2.10'],
      macAddresses: ['02:00:00:00:00:10'],
    },
    payload: { directoryObjectId: providerRecordId, enabled: true },
  };
}

function requestedRun(connectorInstanceId: string, requestIdentity: string) {
  return {
    connectorInstanceId,
    trigger: ConnectorRunTrigger.REQUESTED,
    triggerActor: { kind: 'SERVICE' as const, id: actorId },
    requestIdentity,
  };
}

function jobPayload(connectorInstanceId: string, configurationVersion = 1): ConnectorRunJobPayload {
  return { schemaVersion: 1, connectorInstanceId, configurationVersion };
}

function workerContext(runId: string, retryCount: number, retryLimit: number): AtlasWorkerContext {
  return {
    jobId: randomUUID(),
    queueName,
    signal: new AbortController().signal,
    idempotencyKey: sha256(runId),
    runId,
    retryCount,
    retryLimit,
  };
}

function configFor(schema: string): ConnectorExecutionConfig {
  return {
    enabled: true,
    poolMax: 2,
    payloadMaxBytes: 65_536,
    shutdownTimeoutMs: 5_000,
    schema,
    databaseUrl: process.env.DATABASE_URL,
  };
}

async function* emitObservations(
  ...observations: ConnectorAssetObservation[]
): AsyncIterable<ConnectorAssetObservation> {
  await Promise.resolve();
  yield* observations;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
  throw new Error('Timed out waiting for Connector Framework state.');
}
