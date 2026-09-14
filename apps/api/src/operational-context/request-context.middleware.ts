import { Injectable, type NestMiddleware } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

import { OperationalLogger } from './operational-logger.service';
import { RequestContextService } from './request-context.service';
import { resolveRequestContext } from './request-context.types';

interface OperationalRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method?: string;
  readonly baseUrl?: string;
  readonly route?: { readonly path?: string };
}

interface OperationalResponse {
  readonly statusCode: number;
  readonly writableEnded?: boolean;
  setHeader(name: string, value: string): void;
  once(event: 'finish' | 'close', listener: () => void): this;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly logger: OperationalLogger,
  ) {}

  use(request: OperationalRequest, response: OperationalResponse, next: () => void): void {
    const resolution = resolveRequestContext(request.headers['x-correlation-id']);
    const { requestId, correlationId } = resolution.context;

    response.setHeader('X-Request-ID', requestId);
    response.setHeader('X-Correlation-ID', correlationId);

    this.requestContext.runWithContext(resolution.context, () => {
      if (resolution.correlationIdRejected) {
        this.logger.debug({ event: 'correlation_id_rejected' });
      }

      const startedAt = performance.now();
      let emitted = false;
      const emit = (event: 'http.request.completed' | 'http.request.aborted'): void => {
        if (emitted) return;
        emitted = true;

        const record = {
          event,
          requestId,
          correlationId,
          method: safeMethod(request.method),
          route: routeTemplate(request),
          statusCode: response.statusCode,
          durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000),
        } as const;

        if (event === 'http.request.aborted') {
          this.logger.warn(record);
        } else if (isHealthRoute(record.route)) {
          this.logger.debug(record);
        } else if (record.statusCode >= 500) {
          this.logger.error(record);
        } else if (record.statusCode === 401 || record.statusCode === 403) {
          this.logger.warn(record);
        } else {
          this.logger.log(record);
        }
      };

      response.once('finish', () => emit('http.request.completed'));
      response.once('close', () => {
        if (!response.writableEnded) emit('http.request.aborted');
      });
      next();
    });
  }
}

function safeMethod(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16 || !/^[A-Za-z]+$/.test(value)) {
    return 'UNKNOWN';
  }
  return value.toUpperCase();
}

function isHealthRoute(route: string): boolean {
  return route === '/health' || route.startsWith('/health/');
}

function routeTemplate(request: OperationalRequest): string {
  if (typeof request.route?.path !== 'string' || request.route.path === '/{*splat}')
    return 'UNMATCHED';

  const baseUrl = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  const value = `${baseUrl}${request.route.path}` || '/';
  if (value.length > 256 || /[\r\n?]/.test(value)) return 'UNMATCHED';
  return value;
}
