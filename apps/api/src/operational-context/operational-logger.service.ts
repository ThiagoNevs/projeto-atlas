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
    });
  }
}
