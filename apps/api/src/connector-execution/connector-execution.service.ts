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
  ConnectorQueueState,
  JsonValue,
} from './connector-execution.types';

const EXPECTED_PG_BOSS_SCHEMA_VERSION = 42;
const QUEUE_NAME_PATTERN = /^atlas\.[a-z0-9][a-z0-9._-]{0,126}$/;
const PG_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

interface OldestReadyJobRow {
  readonly capturedAt: Date;
  readonly oldestReadyAt: Date | null;
}

@Injectable()
export class ConnectorExecutionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private boss: PgBoss | undefined;
  private status: ConnectorExecutionState['status'];
  private schemaVersion: number | undefined;
  private readonly workers = new Map<string, string>();

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
      this.logger.log({ event: 'connector_execution.ready' });
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
    });
  }

  async isReady(): Promise<boolean> {
    if (!this.config.enabled) return true;
    if (this.status !== 'ready' || !this.boss) return false;
    try {
      return (await this.boss.schemaVersion()) === EXPECTED_PG_BOSS_SCHEMA_VERSION;
    } catch {
      return false;
    }
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

    await boss.createQueue(definition.deadLetterQueue, {
      retryLimit: 0,
      deleteAfterSeconds: 604_800,
    });
    await boss.createQueue(definition.queueName, {
      retryLimit: definition.retryLimit,
      retryDelay: definition.retryDelaySeconds,
      retryBackoff: definition.retryBackoff,
      expireInSeconds: definition.expireInSeconds,
      ...(definition.heartbeatSeconds === undefined
        ? {}
        : { heartbeatSeconds: definition.heartbeatSeconds }),
      deadLetter: definition.deadLetterQueue,
      deleteAfterSeconds: 604_800,
    });

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
              durationMs: Date.now() - startedAt,
            });
          } catch (error) {
            this.logger.error({
              event: 'connector_execution.job.failed',
              correlationId: envelope.correlationId,
              queueName: definition.queueName,
              jobId: rawJob.id,
              durationMs: Date.now() - startedAt,
              errorCode: 'JOB_HANDLER_FAILED',
              errorType: safeErrorType(error),
            });
            throw error;
          }
        }
      },
    );
    this.workers.set(definition.queueName, workerId);
    return workerId;
  }

  async stopWorker(queueName: string): Promise<void> {
    const boss = this.requireBoss();
    const workerId = this.workers.get(queueName);
    if (!workerId) return;
    await boss.offWork(queueName, { id: workerId, wait: true });
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
    const stats = (await boss.getQueueStats(queueName, { force: true }))[0];
    if (!stats) throw new Error('Queue state is unavailable.');
    const queue = await boss.getQueue(queueName);
    if (!queue) throw new Error('Queue state is unavailable.');

    // pg-boss 12.33.6 has no bounded public oldest-ready-job API. Keep this
    // version-coupled, payload-free aggregate inside the infrastructure boundary.
    const schema = quotePgIdentifier(this.config.schema);
    const table = quotePgIdentifier(queue.table);
    const { rows } = await boss.getDb().executeSql(
      `SELECT
         ${schema}.job_now() AS "capturedAt",
         MIN(created_on) AS "oldestReadyAt"
       FROM ${schema}.${table}
       WHERE name = $1
         AND state IN ('created', 'retry')
         AND start_after <= ${schema}.job_now()
         AND NOT blocked`,
      [queueName],
    );
    const oldestReady = rows[0] as OldestReadyJobRow | undefined;
    if (!oldestReady || !(oldestReady.capturedAt instanceof Date)) {
      throw new Error('Queue state is unavailable.');
    }
    const capturedAt = oldestReady.capturedAt;
    const oldestReadyAt = oldestReady.oldestReadyAt;
    return Object.freeze({
      queueName,
      queued: stats.queuedCount,
      active: stats.activeCount,
      failed: stats.failedCount,
      total: stats.totalCount,
      capturedAt: capturedAt.toISOString(),
      ...(oldestReadyAt === null
        ? {}
        : {
            oldestReadyAt: oldestReadyAt.toISOString(),
            oldestReadyAgeMs: Math.max(0, capturedAt.getTime() - oldestReadyAt.getTime()),
          }),
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
