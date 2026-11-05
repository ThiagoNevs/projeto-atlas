import { Injectable, Logger } from '@nestjs/common';

import { RequestContextService } from './request-context.service';

export interface OperationalLogRecord {
  readonly event: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly method?: string;
  readonly route?: string;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly actorKind?: 'HUMAN' | 'SERVICE' | 'SYSTEM';
  readonly actorId?: string;
  readonly requiredPermission?: string;
  readonly errorType?: string;
  readonly errorCode?: string;
  readonly queueName?: string;
  readonly jobId?: string;
  readonly runId?: string;
  readonly retryCount?: number;
  readonly retryLimit?: number;
  readonly poolMax?: number;
  readonly workerCount?: number;
  readonly schemaVersion?: number;
  readonly queueCreated?: number;
  readonly queueRetry?: number;
  readonly queueQueued?: number;
  readonly queueActive?: number;
  readonly queueFailed?: number;
  readonly queueTotal?: number;
  readonly oldestReadyAgeMs?: number;
  readonly deadLetterQueue?: string;
  readonly deadLetterQueued?: number;
  readonly inspectedCount?: number;
  readonly reconciledCount?: number;
  readonly infrastructureState?: 'LIVE' | 'TERMINAL' | 'MISSING' | 'INCONCLUSIVE';
}

@Injectable()
export class OperationalLogger {
  private readonly logger = new Logger(OperationalLogger.name);

  constructor(private readonly requestContext: RequestContextService) {}

  debug(record: OperationalLogRecord): void {
    this.logger.debug(this.withRequestContext(record));
  }

  log(record: OperationalLogRecord): void {
    this.logger.log(this.withRequestContext(record));
  }

  warn(record: OperationalLogRecord): void {
    this.logger.warn(this.withRequestContext(record));
  }

  error(record: OperationalLogRecord): void {
    this.logger.error(this.withRequestContext(record));
  }

  private withRequestContext(record: OperationalLogRecord): OperationalLogRecord {
    const context = this.requestContext.getContext();
    const requestId = record.requestId ?? context?.requestId;
    const correlationId = record.correlationId ?? context?.correlationId;
    return Object.freeze({
      event: record.event,
      ...(requestId === undefined ? {} : { requestId }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(record.method === undefined ? {} : { method: record.method }),
      ...(record.route === undefined ? {} : { route: record.route }),
      ...(record.statusCode === undefined ? {} : { statusCode: record.statusCode }),
      ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
      ...(record.actorKind === undefined ? {} : { actorKind: record.actorKind }),
      ...(record.actorId === undefined ? {} : { actorId: record.actorId }),
      ...(record.requiredPermission === undefined
        ? {}
        : { requiredPermission: record.requiredPermission }),
      ...(record.errorType === undefined ? {} : { errorType: record.errorType }),
      ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
      ...(record.queueName === undefined ? {} : { queueName: record.queueName }),
      ...(record.jobId === undefined ? {} : { jobId: record.jobId }),
      ...(record.runId === undefined ? {} : { runId: record.runId }),
      ...(record.retryCount === undefined ? {} : { retryCount: record.retryCount }),
      ...(record.retryLimit === undefined ? {} : { retryLimit: record.retryLimit }),
      ...(record.poolMax === undefined ? {} : { poolMax: record.poolMax }),
      ...(record.workerCount === undefined ? {} : { workerCount: record.workerCount }),
      ...(record.schemaVersion === undefined ? {} : { schemaVersion: record.schemaVersion }),
      ...(record.queueCreated === undefined ? {} : { queueCreated: record.queueCreated }),
      ...(record.queueRetry === undefined ? {} : { queueRetry: record.queueRetry }),
      ...(record.queueQueued === undefined ? {} : { queueQueued: record.queueQueued }),
      ...(record.queueActive === undefined ? {} : { queueActive: record.queueActive }),
      ...(record.queueFailed === undefined ? {} : { queueFailed: record.queueFailed }),
      ...(record.queueTotal === undefined ? {} : { queueTotal: record.queueTotal }),
      ...(record.oldestReadyAgeMs === undefined
        ? {}
        : { oldestReadyAgeMs: record.oldestReadyAgeMs }),
      ...(record.deadLetterQueue === undefined ? {} : { deadLetterQueue: record.deadLetterQueue }),
      ...(record.deadLetterQueued === undefined
        ? {}
        : { deadLetterQueued: record.deadLetterQueued }),
      ...(record.inspectedCount === undefined ? {} : { inspectedCount: record.inspectedCount }),
      ...(record.reconciledCount === undefined ? {} : { reconciledCount: record.reconciledCount }),
      ...(record.infrastructureState === undefined
        ? {}
        : { infrastructureState: record.infrastructureState }),
    });
  }
}
