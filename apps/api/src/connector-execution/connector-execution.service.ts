import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { JobWithMetadata, PgBoss, SendOptions, WorkOptions } from 'pg-boss';

import { OperationalLogger } from '../operational-context/operational-logger.service';
import {
  CONNECTOR_EXECUTION_BOSS_FACTORY,
  type ConnectorExecutionBossFactory,
} from './connector-execution.adapter';
import { ConnectorExecutionConfig } from './connector-execution.config';
import { parseAtlasJobEnvelope } from './connector-execution-envelope';
import type {
  AtlasEnqueueOptions,
  AtlasJobEnvelope,
  AtlasPrismaTransaction,
  AtlasWorkerDefinition,
  ConnectorExecutionState,
  ConnectorExecutionOperationalSnapshot,
  ConnectorQueueState,
  ConnectorRegisteredQueueState,
  ConnectorRunInfrastructureInspection,
  JsonValue,
} from './connector-execution.types';

const EXPECTED_PG_BOSS_SCHEMA_VERSION = 42;
const COMPATIBILITY_CACHE_TTL_MS = 5_000;
const COMPATIBILITY_PROBE_TIMEOUT_MS = 1_000;
const QUEUE_NAME_PATTERN = /^atlas\.[a-z0-9][a-z0-9._-]{0,126}$/;
const PG_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

interface QueueStateRow {
  readonly capturedAt: Date;
  readonly oldestReadyAt: Date | null;
  readonly created: number;
  readonly retry: number;
  readonly active: number;
  readonly failed: number;
  readonly total: number;
}

interface InfrastructureStateRow {
  readonly anyCount: number;
  readonly liveCount: number;
  readonly exhaustedCount: number;
  readonly deadLetterAnyCount: number;
  readonly correlatedDeadLetterCount: number;
}

interface RegisteredWorker {
  readonly workerId: string;
  readonly sourceQueue: string;
  readonly deadLetterQueue: string;
}

@Injectable()
export class ConnectorExecutionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private boss: PgBoss | undefined;
  private status: ConnectorExecutionState['status'];
  private schemaVersion: number | undefined;
  private readonly workers = new Map<string, RegisteredWorker>();
  private compatibilityCache: Readonly<{ ready: boolean; expiresAt: number }> | undefined;
  private compatibilityProbeInFlight: Promise<boolean> | undefined;
  private observabilityTimer: ReturnType<typeof setInterval> | undefined;
  private observabilityInFlight: Promise<void> | undefined;
  private shuttingDown = false;

  constructor(
    readonly config: ConnectorExecutionConfig,
    private readonly logger: OperationalLogger,
    @Inject(CONNECTOR_EXECUTION_BOSS_FACTORY)
    private readonly createBoss: ConnectorExecutionBossFactory,
  ) {
    this.status = config.enabled ? 'starting' : 'disabled';
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.enabled) return;
    this.shuttingDown = false;

    this.logger.log({ event: 'connector_execution.started' });
    const boss = await this.createBoss({
      connectionString: this.config.databaseUrl,
      schema: this.config.schema,
      max: this.config.poolMax,
      migrate: false,
      schedule: true,
      supervise: true,
      useListenNotify: false,
      application_name: 'atlas-connector-execution',
    });
    boss.on('error', (error) => {
      this.logger.error({
        event: 'connector_execution.runtime_error',
        errorCode: 'QUEUE_RUNTIME_ERROR',
        errorType: safeErrorType(error),
      });
    });

    try {
      await boss.start();
      const schemaVersion = await boss.schemaVersion();
      if (schemaVersion !== EXPECTED_PG_BOSS_SCHEMA_VERSION) {
        throw new Error('SchemaVersionMismatch');
      }
      const drift = await boss.detectSchemaDrift();
      if (!drift.ok) throw new Error('SchemaDriftDetected');
      this.boss = boss;
      this.schemaVersion = schemaVersion;
      this.status = 'ready';
      this.logger.log({
        event: 'connector_execution.ready',
        schemaVersion,
        poolMax: this.config.poolMax,
      });
      this.startOperationalMonitor();
    } catch (error) {
      this.status = 'failed';
      this.logger.error({
        event: 'connector_execution.schema_incompatible',
        errorCode: 'CONNECTOR_EXECUTION_START_FAILED',
        errorType: safeErrorType(error),
      });
      await boss.stop({ graceful: false, close: true }).catch(() => undefined);
      throw new Error('Connector Execution failed to initialize.');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.observabilityTimer) {
      clearInterval(this.observabilityTimer);
      this.observabilityTimer = undefined;
    }
    await this.waitForOperationalSampling();
    const boss = this.boss;
    if (!boss) return;
    this.status = 'stopping';
    this.logger.log({ event: 'connector_execution.stopping' });
    try {
      await boss.stop({
        graceful: true,
        close: true,
        timeout: this.config.shutdownTimeoutMs,
      });
    } finally {
      this.boss = undefined;
      this.workers.clear();
      this.compatibilityCache = undefined;
      this.compatibilityProbeInFlight = undefined;
      this.status = 'stopped';
      this.logger.log({ event: 'connector_execution.stopped' });
    }
  }

  getState(): ConnectorExecutionState {
    return Object.freeze({
      enabled: this.config.enabled,
      ready: !this.config.enabled || this.status === 'ready',
      status: this.status,
      ...(this.schemaVersion === undefined ? {} : { schemaVersion: this.schemaVersion }),
      workerCount: this.workers.size,
      poolMax: this.config.poolMax,
    });
  }

  async isReady(): Promise<boolean> {
    if (!this.config.enabled) return true;
    if (this.status !== 'ready' || !this.boss) return false;
    const cached = this.compatibilityCache;
    if (cached && cached.expiresAt > Date.now()) return cached.ready;
    if (this.compatibilityProbeInFlight) return this.compatibilityProbeInFlight;

    const boss = this.boss;
    const underlying = this.probeCompatibility(boss).catch(() => false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const bounded = Promise.race([
      underlying,
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), COMPATIBILITY_PROBE_TIMEOUT_MS);
        timeout.unref?.();
      }),
    ]).then((ready) => {
      if (timeout) clearTimeout(timeout);
      this.compatibilityCache = Object.freeze({
        ready,
        expiresAt: Date.now() + COMPATIBILITY_CACHE_TTL_MS,
      });
      return ready;
    });
    this.compatibilityProbeInFlight = bounded;
    void bounded.then(() => {
      if (this.compatibilityProbeInFlight === bounded) {
        this.compatibilityProbeInFlight = undefined;
      }
    });
    return bounded;
  }

  async enqueue<TPayload extends JsonValue>(
    queueName: string,
    envelope: AtlasJobEnvelope<TPayload>,
    options: AtlasEnqueueOptions = {},
  ): Promise<string> {
    return this.send(queueName, envelope, options);
  }

  async enqueueWithinTransaction<TPayload extends JsonValue>(
    transaction: AtlasPrismaTransaction,
    queueName: string,
    envelope: AtlasJobEnvelope<TPayload>,
    options: AtlasEnqueueOptions = {},
  ): Promise<string> {
    const { fromPrisma } = await import('pg-boss');
    return this.send(queueName, envelope, options, fromPrisma(transaction));
  }

  async registerWorker<TPayload extends JsonValue>(
    definition: AtlasWorkerDefinition<TPayload>,
  ): Promise<string> {
    const boss = this.requireBoss();
    validateQueueName(definition.queueName);
    validateQueueName(definition.deadLetterQueue);
    validateWorkerDefinition(definition);
    if (this.workers.has(definition.queueName)) {
      throw new Error('Worker already registered for queue.');
    }

    const deadLetterOptions = {
      retryLimit: 0,
      deleteAfterSeconds: this.config.dlqRetentionSeconds,
    } as const;
    const sourceOptions = {
      retryLimit: definition.retryLimit,
      retryDelay: definition.retryDelaySeconds,
      retryBackoff: definition.retryBackoff,
      expireInSeconds: definition.expireInSeconds,
      ...(definition.heartbeatSeconds === undefined
        ? {}
        : { heartbeatSeconds: definition.heartbeatSeconds }),
      deadLetter: definition.deadLetterQueue,
      deleteAfterSeconds: this.config.sourceRetentionSeconds,
    } as const;
    await boss.createQueue(definition.deadLetterQueue, deadLetterOptions);
    await boss.updateQueue(definition.deadLetterQueue, deadLetterOptions);
    await boss.createQueue(definition.queueName, sourceOptions);
    await boss.updateQueue(definition.queueName, sourceOptions);

    const options: WorkOptions = {
      localConcurrency: definition.concurrency,
      batchSize: 1,
      includeMetadata: true,
      pollingIntervalSeconds: 2,
      ...(definition.heartbeatSeconds === undefined
        ? {}
        : { heartbeatRefreshSeconds: Math.max(1, Math.floor(definition.heartbeatSeconds / 2)) }),
    };
    const workerId = await boss.work<AtlasJobEnvelope<TPayload>>(
      definition.queueName,
      options,
      async (jobs) => {
        for (const rawJob of jobs as JobWithMetadata<AtlasJobEnvelope<TPayload>>[]) {
          const startedAt = Date.now();
          const envelope = parseAtlasJobEnvelope(
            rawJob.data,
            this.config.payloadMaxBytes,
          ) as AtlasJobEnvelope<TPayload>;
          this.logger.log({
            event: 'connector_execution.job.started',
            correlationId: envelope.correlationId,
            queueName: definition.queueName,
            jobId: rawJob.id,
            runId: envelope.runId,
            retryCount: rawJob.retryCount,
            retryLimit: rawJob.retryLimit,
          });
          try {
            await definition.handler(envelope.payload, {
              jobId: rawJob.id,
              queueName: definition.queueName,
              signal: rawJob.signal,
              idempotencyKey: envelope.idempotencyKey,
              runId: envelope.runId,
              ...(envelope.correlationId === undefined
                ? {}
                : { correlationId: envelope.correlationId }),
              retryCount: rawJob.retryCount,
              retryLimit: rawJob.retryLimit,
            });
            this.logger.log({
              event: 'connector_execution.job.completed',
              correlationId: envelope.correlationId,
              queueName: definition.queueName,
              jobId: rawJob.id,
              runId: envelope.runId,
              retryCount: rawJob.retryCount,
              retryLimit: rawJob.retryLimit,
              durationMs: Date.now() - startedAt,
            });
          } catch (error) {
            this.logger.error({
              event: 'connector_execution.job.failed',
              correlationId: envelope.correlationId,
              queueName: definition.queueName,
              jobId: rawJob.id,
              runId: envelope.runId,
              retryCount: rawJob.retryCount,
              retryLimit: rawJob.retryLimit,
              durationMs: Date.now() - startedAt,
              errorCode: 'JOB_HANDLER_FAILED',
              errorType: safeErrorType(error),
            });
            throw error;
          }
        }
      },
    );
    this.workers.set(
      definition.queueName,
      Object.freeze({
        workerId,
        sourceQueue: definition.queueName,
        deadLetterQueue: definition.deadLetterQueue,
      }),
    );
    return workerId;
  }

  async stopWorker(queueName: string): Promise<void> {
    const boss = this.requireBoss();
    const worker = this.workers.get(queueName);
    if (!worker) return;
    await boss.offWork(queueName, { id: worker.workerId, wait: true });
    this.workers.delete(queueName);
  }

  async redrive(deadLetterQueue: string, destination: string, limit = 100): Promise<number> {
    validateQueueName(deadLetterQueue);
    validateQueueName(destination);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Redrive limit must be between 1 and 1000.');
    }
    return this.requireBoss().redrive(deadLetterQueue, { destination, limit });
  }

  async cancel(queueName: string, jobId: string): Promise<void> {
    validateQueueName(queueName);
    await this.requireBoss().cancel(queueName, jobId);
  }

  async getQueueState(queueName: string): Promise<ConnectorQueueState> {
    validateQueueName(queueName);
    const boss = this.requireBoss();
    const state = await this.readQueueState(boss, queueName);
    const capturedAt = state.capturedAt;
    const oldestReadyAt = state.oldestReadyAt;
    return Object.freeze({
      queueName,
      created: state.created,
      retry: state.retry,
      queued: state.created + state.retry,
      active: state.active,
      failed: state.failed,
      total: state.total,
      capturedAt: capturedAt.toISOString(),
      ...(oldestReadyAt === null
        ? {}
        : {
            oldestReadyAt: oldestReadyAt.toISOString(),
            oldestReadyAgeMs: Math.max(0, capturedAt.getTime() - oldestReadyAt.getTime()),
          }),
    });
  }

  async getOperationalSnapshot(): Promise<ConnectorExecutionOperationalSnapshot> {
    const execution = Object.freeze({
      ...this.getState(),
      ready: await this.isReady(),
    });
    const queues: ConnectorRegisteredQueueState[] = [];
    for (const worker of this.workers.values()) {
      const [source, deadLetter] = await Promise.all([
        this.getQueueState(worker.sourceQueue),
        this.getQueueState(worker.deadLetterQueue),
      ]);
      queues.push(
        Object.freeze({
          ...source,
          deadLetterQueue: worker.deadLetterQueue,
          deadLetterQueued: deadLetter.queued,
        }),
      );
    }
    return Object.freeze({ execution, queues: Object.freeze(queues) });
  }

  async inspectRunInfrastructure(
    sourceQueue: string,
    deadLetterQueue: string,
    runId: string,
  ): Promise<ConnectorRunInfrastructureInspection> {
    validateQueueName(sourceQueue);
    validateQueueName(deadLetterQueue);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      throw new Error('Invalid ConnectorRun id.');
    }
    const boss = this.requireBoss();
    const source = await boss.getQueue(sourceQueue);
    const deadLetter = await boss.getQueue(deadLetterQueue);
    if (!source || !deadLetter) throw new Error('Queue infrastructure is unavailable.');
    const schema = quotePgIdentifier(this.config.schema);
    const sourceTable = quotePgIdentifier(source.table);
    const deadLetterTable = quotePgIdentifier(deadLetter.table);
    const { rows } = await boss.getDb().executeSql(
      `SELECT
         (SELECT COUNT(*)::int
            FROM ${schema}.${sourceTable}
           WHERE name = $1 AND singleton_key = $3) AS "anyCount",
         (SELECT COUNT(*)::int
            FROM ${schema}.${sourceTable}
           WHERE name = $1 AND singleton_key = $3
             AND state IN ('created', 'retry', 'active')) AS "liveCount",
         (SELECT COUNT(*)::int
            FROM ${schema}.${sourceTable}
           WHERE name = $1 AND singleton_key = $3
             AND state = 'failed' AND retry_count >= retry_limit) AS "exhaustedCount",
         (SELECT COUNT(*)::int
            FROM ${schema}.${deadLetterTable}
           WHERE name = $2 AND singleton_key = $3) AS "deadLetterAnyCount",
         (SELECT COUNT(*)::int
            FROM ${schema}.${deadLetterTable}
           WHERE name = $2 AND singleton_key = $3
             AND source_name = $1
             AND source_id IS NOT NULL
             AND source_retry_count IS NOT NULL) AS "correlatedDeadLetterCount"`,
      [sourceQueue, deadLetterQueue, runId],
    );
    const row = rows[0] as InfrastructureStateRow | undefined;
    if (!row) throw new Error('Queue infrastructure is unavailable.');
    const state =
      row.liveCount > 0
        ? 'LIVE'
        : row.exhaustedCount > 0 || row.correlatedDeadLetterCount > 0
          ? 'TERMINAL'
          : row.anyCount === 0 && row.deadLetterAnyCount === 0
            ? 'MISSING'
            : 'INCONCLUSIVE';
    return Object.freeze({
      state,
      sourceQueue,
      deadLetterQueue,
      sourceLiveCount: row.liveCount,
      sourceExhaustedCount: row.exhaustedCount,
      deadLetterCount: row.correlatedDeadLetterCount,
    });
  }

  private async send<TPayload extends JsonValue>(
    queueName: string,
    envelope: AtlasJobEnvelope<TPayload>,
    options: AtlasEnqueueOptions,
    db?: SendOptions['db'],
  ): Promise<string> {
    validateQueueName(queueName);
    const validated = parseAtlasJobEnvelope(envelope, this.config.payloadMaxBytes);
    const jobId = await this.requireBoss().send(queueName, validated, {
      ...options,
      ...(db === undefined ? {} : { db }),
    });
    if (!jobId) throw new Error('Queue rejected the job.');
    return jobId;
  }

  private async probeCompatibility(boss: PgBoss): Promise<boolean> {
    const schemaVersion = await boss.schemaVersion();
    if (schemaVersion !== EXPECTED_PG_BOSS_SCHEMA_VERSION) return false;
    const drift = await boss.detectSchemaDrift();
    return drift.ok === true;
  }

  private async readQueueState(boss: PgBoss, queueName: string): Promise<QueueStateRow> {
    const queue = await boss.getQueue(queueName);
    if (!queue) throw new Error('Queue state is unavailable.');
    // pg-boss 12.33.6 has no bounded public per-state/oldest-ready API. This
    // version-coupled query is aggregate-only and never selects job data/output.
    const schema = quotePgIdentifier(this.config.schema);
    const table = quotePgIdentifier(queue.table);
    const { rows } = await boss.getDb().executeSql(
      `SELECT
         ${schema}.job_now() AS "capturedAt",
         COUNT(*) FILTER (WHERE state = 'created')::int AS "created",
         COUNT(*) FILTER (WHERE state = 'retry')::int AS "retry",
         COUNT(*) FILTER (WHERE state = 'active')::int AS "active",
         COUNT(*) FILTER (WHERE state = 'failed')::int AS "failed",
         COUNT(*)::int AS "total",
         MIN(created_on) FILTER (
           WHERE state IN ('created', 'retry')
             AND start_after <= ${schema}.job_now()
             AND NOT blocked
         ) AS "oldestReadyAt"
       FROM ${schema}.${table}
       WHERE name = $1`,
      [queueName],
    );
    const row = rows[0] as QueueStateRow | undefined;
    if (!row || !(row.capturedAt instanceof Date)) {
      throw new Error('Queue state is unavailable.');
    }
    return row;
  }

  private startOperationalMonitor(): void {
    if (!this.config.enabled || this.shuttingDown || this.observabilityTimer) return;
    this.observabilityTimer = setInterval(
      () => this.startOperationalSampling(),
      this.config.observabilityIntervalSeconds * 1_000,
    );
    this.observabilityTimer.unref?.();
  }

  private startOperationalSampling(): void {
    if (this.shuttingDown || this.observabilityInFlight) return;
    const sampling = this.sampleOperationalState()
      .catch((error) => {
        this.logger.warn({
          event: 'connector_execution.observability.failed',
          errorCode: 'CONNECTOR_EXECUTION_OBSERVABILITY_FAILED',
          errorType: safeErrorType(error),
        });
      })
      .finally(() => {
        if (this.observabilityInFlight === sampling) this.observabilityInFlight = undefined;
      });
    this.observabilityInFlight = sampling;
  }

  private async sampleOperationalState(): Promise<void> {
    const snapshot = await this.getOperationalSnapshot();
    this.logger.log({
      event: 'connector_execution.operational.snapshot',
      poolMax: snapshot.execution.poolMax,
      workerCount: snapshot.execution.workerCount,
      ...(snapshot.execution.schemaVersion === undefined
        ? {}
        : { schemaVersion: snapshot.execution.schemaVersion }),
    });
    for (const queue of snapshot.queues) {
      const record = {
        queueName: queue.queueName,
        deadLetterQueue: queue.deadLetterQueue,
        queueCreated: queue.created,
        queueRetry: queue.retry,
        queueQueued: queue.queued,
        queueActive: queue.active,
        queueFailed: queue.failed,
        queueTotal: queue.total,
        deadLetterQueued: queue.deadLetterQueued,
        ...(queue.oldestReadyAgeMs === undefined
          ? {}
          : { oldestReadyAgeMs: queue.oldestReadyAgeMs }),
      };
      this.logger.log({ event: 'connector_execution.queue.snapshot', ...record });
      if (
        queue.oldestReadyAgeMs !== undefined &&
        queue.oldestReadyAgeMs >= this.config.oldestReadyWarningSeconds * 1_000
      ) {
        this.logger.warn({
          event: 'connector_execution.queue.oldest_ready_warning',
          ...record,
        });
      }
      if (queue.deadLetterQueued >= this.config.dlqWarningDepth) {
        this.logger.warn({ event: 'connector_execution.dlq.warning', ...record });
      }
    }
  }

  private async waitForOperationalSampling(): Promise<void> {
    const sampling = this.observabilityInFlight;
    if (!sampling) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      sampling,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.config.shutdownTimeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  private requireBoss(): PgBoss {
    if (!this.config.enabled || this.status !== 'ready' || !this.boss) {
      throw new Error('Connector Execution is not ready.');
    }
    return this.boss;
  }
}

function validateQueueName(name: string): void {
  if (!QUEUE_NAME_PATTERN.test(name)) throw new Error('Invalid Atlas queue name.');
}

function quotePgIdentifier(identifier: string): string {
  if (!PG_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error('Invalid pg-boss identifier.');
  }
  return `"${identifier}"`;
}

function validateWorkerDefinition<TPayload extends JsonValue>(
  definition: AtlasWorkerDefinition<TPayload>,
): void {
  if (
    !Number.isInteger(definition.concurrency) ||
    definition.concurrency < 1 ||
    definition.concurrency > 32
  ) {
    throw new Error('Worker concurrency must be between 1 and 32.');
  }
  if (
    !Number.isInteger(definition.retryLimit) ||
    definition.retryLimit < 0 ||
    definition.retryLimit > 20
  ) {
    throw new Error('Worker retry limit must be between 0 and 20.');
  }
  if (
    !Number.isInteger(definition.retryDelaySeconds) ||
    definition.retryDelaySeconds < 0 ||
    definition.retryDelaySeconds > 86_400
  ) {
    throw new Error('Worker retry delay is invalid.');
  }
  if (
    !Number.isInteger(definition.expireInSeconds) ||
    definition.expireInSeconds < 1 ||
    definition.expireInSeconds > 86_400
  ) {
    throw new Error('Worker expiration is invalid.');
  }
  if (
    definition.heartbeatSeconds !== undefined &&
    (!Number.isInteger(definition.heartbeatSeconds) ||
      definition.heartbeatSeconds < 10 ||
      definition.heartbeatSeconds >= definition.expireInSeconds)
  ) {
    throw new Error('Worker heartbeat must be at least 10 seconds and below expiration.');
  }
}

function safeErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}
