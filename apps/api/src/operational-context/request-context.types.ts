import { randomUUID } from 'node:crypto';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
}

export interface RequestContextResolution {
  readonly context: RequestContext;
  readonly correlationIdRejected: boolean;
}

export function resolveRequestContext(correlationHeader: unknown): RequestContextResolution {
  const requestId = randomUUID();
  const correlationId = canonicalUuidV4(correlationHeader);

  return {
    context: Object.freeze({
      requestId,
      correlationId: correlationId ?? requestId,
    }),
    correlationIdRejected: correlationHeader !== undefined && correlationId === null,
  };
}

export function canonicalUuidV4(value: unknown): string | null {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return null;
  return value.toLowerCase();
}
