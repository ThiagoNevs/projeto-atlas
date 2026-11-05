import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ConnectorExecutionService } from '../connector-execution/connector-execution.service';
import type { ConnectorRunInfrastructureState } from '../connector-execution/connector-execution.types';
import { ConnectorRunStatus } from '../generated/prisma/client';
import { OperationalLogger } from '../operational-context/operational-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { connectorQueueName } from './connector-definition.registry';

export interface ConnectorRunReconciliationResult {
  readonly inspectedCount: number;
  readonly reconciledCount: number;
}

@Injectable()
export class ConnectorRunReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<ConnectorRunReconciliationResult> | undefined;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: ConnectorExecutionService,
    private readonly logger: OperationalLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.execution.config.enabled) return;
    this.timer = setInterval(
      () => void this.reconcileOnce(),
      this.execution.config.reconciliationIntervalSeconds * 1_000,
    );
    this.timer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const inFlight = this.inFlight;
    if (!inFlight) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      inFlight.then(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.execution.config.shutdownTimeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  reconcileOnce(): Promise<ConnectorRunReconciliationResult> {
    if (this.inFlight) return this.inFlight;
    if (this.shuttingDown || !this.execution.config.enabled) {
      return Promise.resolve(Object.freeze({ inspectedCount: 0, reconciledCount: 0 }));
    }
    const pass = this.executePass().finally(() => {
      if (this.inFlight === pass) this.inFlight = undefined;
    });
    this.inFlight = pass;
    return pass;
  }

  private async executePass(): Promise<ConnectorRunReconciliationResult> {
    const startedAt = Date.now();
    this.logger.log({ event: 'connector_execution.reconciliation.started' });
    let inspectedCount = 0;
    let reconciledCount = 0;
    try {
      if (!(await this.execution.isReady())) {
        throw new Error('ConnectorExecutionNotReady');
      }
      const now = new Date();
      const candidates = await this.prisma.connectorRun.findMany({
        where: {
          status: { in: [ConnectorRunStatus.QUEUED, ConnectorRunStatus.RUNNING] },
          OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
        },
        select: {
          id: true,
          status: true,
          rejectedCount: true,
          createdAt: true,
          scheduledFor: true,
          connectorInstance: { select: { connectorType: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: this.execution.config.reconciliationBatchSize,
      });

      for (const run of candidates) {
        inspectedCount += 1;
        try {
          const sourceQueue = connectorQueueName(run.connectorInstance.connectorType);
          const deadLetterQueue = `${sourceQueue}.dead`;
          const infrastructure = await this.execution.inspectRunInfrastructure(
            sourceQueue,
            deadLetterQueue,
            run.id,
          );
          if (!this.shouldTerminalize(infrastructure.state, run.createdAt, run.scheduledFor, now)) {
            continue;
          }
          const ingestedCount = await this.prisma.assetEvidence.count({
            where: { connectorRunId: run.id },
          });
          const updated = await this.prisma.connectorRun.updateMany({
            where: {
              id: run.id,
              status: { in: [ConnectorRunStatus.QUEUED, ConnectorRunStatus.RUNNING] },
            },
            data: {
              status: ingestedCount > 0 ? ConnectorRunStatus.PARTIAL : ConnectorRunStatus.FAILED,
              observedCount: ingestedCount + run.rejectedCount,
              ingestedCount,
              rejectedCount: run.rejectedCount,
              errorCode: 'CONNECTOR_EXECUTION_ABANDONED',
              finishedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (updated.count === 1) {
            reconciledCount += 1;
            this.logger.warn({
              event: 'connector_execution.run.reconciled',
              runId: run.id,
              queueName: sourceQueue,
              infrastructureState: infrastructure.state,
            });
          }
        } catch (error) {
          this.logger.warn({
            event: 'connector_execution.reconciliation.failed',
            runId: run.id,
            errorCode: 'CONNECTOR_RUN_RECONCILIATION_FAILED',
            errorType: safeErrorType(error),
          });
        }
      }

      const result = Object.freeze({ inspectedCount, reconciledCount });
      this.logger.log({
        event: 'connector_execution.reconciliation.completed',
        durationMs: Date.now() - startedAt,
        inspectedCount,
        reconciledCount,
      });
      return result;
    } catch (error) {
      this.logger.warn({
        event: 'connector_execution.reconciliation.failed',
        durationMs: Date.now() - startedAt,
        inspectedCount,
        reconciledCount,
        errorCode: 'CONNECTOR_EXECUTION_RECONCILIATION_FAILED',
        errorType: safeErrorType(error),
      });
      return Object.freeze({ inspectedCount, reconciledCount });
    }
  }

  private shouldTerminalize(
    state: ConnectorRunInfrastructureState,
    createdAt: Date,
    scheduledFor: Date | null,
    now: Date,
  ): boolean {
    if (state === 'TERMINAL') return true;
    if (state !== 'MISSING') return false;
    const base = Math.max(createdAt.getTime(), scheduledFor?.getTime() ?? 0);
    const eligibility =
      base +
      (this.execution.config.sourceRetentionSeconds +
        this.execution.config.missingJobGraceSeconds) *
        1_000;
    return now.getTime() >= eligibility;
  }
}

function safeErrorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}
