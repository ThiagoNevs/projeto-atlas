import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ConnectorExecutionService } from '../connector-execution/connector-execution.service';
import type { AtlasWorkerContext } from '../connector-execution/connector-execution.types';
import { ConnectorRunStatus } from '../generated/prisma/client';
import { IngestionService } from '../ingestion/ingestion.service';
import { OperationalLogger } from '../operational-context/operational-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretResolutionError } from '../secrets/secret-resolution.errors';
import { SecretResolver } from '../secrets/secret-resolver.service';
import { connectorQueueName, ConnectorDefinitionRegistry } from './connector-definition.registry';
import { ConnectorFrameworkError } from './connector-framework.errors';
import { parseConnectorObservation } from './connector-observation';
import { ConnectorSecretSlotResolver } from './connector-secret-slots';
import type {
  ConnectorDefinition,
  ConnectorRunJobPayload,
  ConnectorSafeLogger,
} from './connector-framework.types';

const SAFE_EVENT_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ConnectorRunWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly registeredQueues: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: ConnectorExecutionService,
    private readonly definitions: ConnectorDefinitionRegistry,
    private readonly secrets: SecretResolver,
    private readonly ingestion: IngestionService,
    private readonly logger: OperationalLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.execution.config.enabled) return;
    for (const definition of this.definitions.list()) {
      const queueName = connectorQueueName(definition.connectorType);
      await this.execution.registerWorker<ConnectorRunJobPayload>({
        queueName,
        deadLetterQueue: `${queueName}.dead`,
        ...definition.workerPolicy,
        handler: (payload, context) => this.process(payload, context),
      });
      this.registeredQueues.push(queueName);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const queueName of [...this.registeredQueues].reverse()) {
      await this.execution.stopWorker(queueName);
    }
    this.registeredQueues.length = 0;
  }

  async process(payload: ConnectorRunJobPayload, context: AtlasWorkerContext): Promise<void> {
    let rejectedCount = 0;
    try {
      validateJobPayload(payload, context.runId);
      const run = await this.prisma.connectorRun.findUnique({
        where: { id: context.runId },
        include: {
          connectorInstance: {
            include: { secretReferences: true },
          },
        },
      });
      if (!run || run.connectorInstanceId !== payload.connectorInstanceId) {
        throw new ConnectorFrameworkError('CONNECTOR_RUN_REPLAY_INCONSISTENT');
      }
      if (
        run.status === ConnectorRunStatus.COMPLETED ||
        run.status === ConnectorRunStatus.PARTIAL ||
        run.status === ConnectorRunStatus.FAILED ||
        run.status === ConnectorRunStatus.CANCELLED
      ) {
        return;
      }

      const startedAt = run.startedAt ?? new Date();
      const transitioned = await this.prisma.connectorRun.updateMany({
        where: {
          id: run.id,
          status: run.status,
        },
        data: {
          status: ConnectorRunStatus.RUNNING,
          startedAt,
          finishedAt: null,
          errorCode: null,
          rejectedCount: 0,
          version: { increment: 1 },
        },
      });
      if (transitioned.count !== 1) return;

      try {
        const definition = this.definitions.get(run.connectorInstance.connectorType);
        if (!run.connectorInstance.enabled) {
          throw new ConnectorFrameworkError('CONNECTOR_INSTANCE_DISABLED');
        }
        if (payload.configurationVersion !== run.connectorInstance.configurationVersion) {
          throw new ConnectorFrameworkError('CONNECTOR_CONFIG_CHANGED');
        }
        const config = validateConfiguration(definition, run.connectorInstance);
        const secretSlots = new ConnectorSecretSlotResolver(
          this.secrets,
          definition.requiredSecretSlots,
          run.connectorInstance.secretReferences,
        );
        await Promise.all(definition.requiredSecretSlots.map((slot) => secretSlots.resolve(slot)));
        const safeLogger = this.safeLogger(definition.connectorType, run.id, context.correlationId);

        for await (const rawObservation of definition.collect({
          connectorInstanceId: run.connectorInstance.id,
          runId: run.id,
          config,
          signal: context.signal,
          secrets: secretSlots,
          logger: safeLogger,
          now: () => new Date(),
        })) {
          if (context.signal.aborted) throw new Error('Connector worker aborted.');
          let parsed: ReturnType<typeof parseConnectorObservation>;
          try {
            parsed = parseConnectorObservation({
              observation: rawObservation,
              connectorType: definition.connectorType,
              connectorInstanceId: run.connectorInstance.id,
              runId: run.id,
              supportedObservationTypes: definition.supportedObservationTypes,
            });
          } catch (error) {
            if (!(error instanceof ConnectorFrameworkError)) throw error;
            rejectedCount += 1;
            await this.refreshCounters(run.id, rejectedCount);
            continue;
          }

          await this.ingestion.ingestNormalizedAsset(parsed.normalized);
          await this.refreshCounters(run.id, rejectedCount);
        }

        const ingestedCount = await this.countEvidence(run.id);
        await this.prisma.connectorRun.updateMany({
          where: { id: run.id, status: ConnectorRunStatus.RUNNING },
          data: {
            status:
              rejectedCount === 0
                ? ConnectorRunStatus.COMPLETED
                : ingestedCount > 0
                  ? ConnectorRunStatus.PARTIAL
                  : ConnectorRunStatus.FAILED,
            observedCount: ingestedCount + rejectedCount,
            ingestedCount,
            rejectedCount,
            errorCode: rejectedCount === 0 ? null : 'CONNECTOR_OBSERVATION_REJECTED',
            finishedAt: new Date(),
            version: { increment: 1 },
          },
        });
      } catch (error) {
        const failure = classifyConnectorFailure(error);
        if (!failure.retryable || context.retryCount >= context.retryLimit) {
          await this.terminalizeFailure(run.id, rejectedCount, failure.errorCode);
          if (!failure.retryable) return;
        }
        throw error;
      }
    } catch (error) {
      const failure = classifyConnectorFailure(error);
      if (!failure.retryable) {
        await this.terminalizeFailure(context.runId, rejectedCount, failure.errorCode);
        return;
      }
      throw error;
    }
  }

  private async terminalizeFailure(
    runId: string,
    rejectedCount: number,
    errorCode: string,
  ): Promise<void> {
    const ingestedCount = await this.countEvidence(runId);
    await this.prisma.connectorRun.updateMany({
      where: {
        id: runId,
        status: { in: [ConnectorRunStatus.QUEUED, ConnectorRunStatus.RUNNING] },
      },
      data: {
        status: ingestedCount > 0 ? ConnectorRunStatus.PARTIAL : ConnectorRunStatus.FAILED,
        observedCount: ingestedCount + rejectedCount,
        ingestedCount,
        rejectedCount,
        errorCode,
        finishedAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  private async refreshCounters(runId: string, rejectedCount: number): Promise<void> {
    const ingestedCount = await this.countEvidence(runId);
    await this.prisma.connectorRun.updateMany({
      where: { id: runId, status: ConnectorRunStatus.RUNNING },
      data: {
        observedCount: ingestedCount + rejectedCount,
        ingestedCount,
        rejectedCount,
        version: { increment: 1 },
      },
    });
  }

  private countEvidence(runId: string): Promise<number> {
    return this.prisma.assetEvidence.count({ where: { connectorRunId: runId } });
  }

  private safeLogger(
    connectorType: string,
    runId: string,
    correlationId?: string,
  ): ConnectorSafeLogger {
    return Object.freeze({
      debug: (event: string) => {
        this.logger.debug({
          event: SAFE_EVENT_PATTERN.test(event) ? `connector.${event}` : 'connector.event',
          correlationId,
          runId,
          queueName: connectorQueueName(connectorType),
        });
      },
      warn: (event: string, errorCode: string) => {
        this.logger.warn({
          event: SAFE_EVENT_PATTERN.test(event) ? `connector.${event}` : 'connector.warning',
          correlationId,
          runId,
          queueName: connectorQueueName(connectorType),
          errorCode: SAFE_ERROR_CODE_PATTERN.test(errorCode) ? errorCode : 'CONNECTOR_WARNING',
        });
      },
    });
  }
}

function validateJobPayload(payload: ConnectorRunJobPayload, runId: string): void {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    payload.schemaVersion !== 1 ||
    !UUID_V4_PATTERN.test(payload.connectorInstanceId) ||
    !Number.isSafeInteger(payload.configurationVersion) ||
    payload.configurationVersion < 1 ||
    !UUID_V4_PATTERN.test(runId) ||
    Object.keys(payload).some(
      (key) => !['schemaVersion', 'connectorInstanceId', 'configurationVersion'].includes(key),
    )
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_RUN_REPLAY_INCONSISTENT');
  }
}

function validateConfiguration(
  definition: ConnectorDefinition,
  instance: { configurationVersion: number; configuration: unknown },
): unknown {
  if (instance.configurationVersion !== definition.configurationSchemaVersion) {
    throw new ConnectorFrameworkError('CONNECTOR_CONFIG_VERSION_UNSUPPORTED');
  }
  try {
    return definition.validateConfig(instance.configuration);
  } catch {
    throw new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
  }
}

function classifyConnectorFailure(error: unknown): Readonly<{
  errorCode: string;
  retryable: boolean;
}> {
  if (error instanceof ConnectorFrameworkError) {
    return Object.freeze({ errorCode: error.code, retryable: false });
  }
  if (error instanceof SecretResolutionError) {
    const errorCode =
      error.code === 'SECRET_NOT_FOUND' ? 'SECRET_NOT_FOUND' : `SECRET_${error.code}`;
    return Object.freeze({
      errorCode,
      retryable: error.code === 'PROVIDER_UNAVAILABLE',
    });
  }
  return Object.freeze({ errorCode: 'CONNECTOR_COLLECTION_FAILED', retryable: true });
}
