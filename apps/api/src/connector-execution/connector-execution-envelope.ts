import { randomUUID } from 'node:crypto';

import { parseSecretReference } from '../secrets/secret-reference.types';
import type { AtlasJobEnvelope, JsonValue } from './connector-execution.types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;
const PROHIBITED_MATERIAL_KEYS = new Set([
  'password',
  'token',
  'secret',
  'credential',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'privatekey',
  'authorization',
  'credentialmaterial',
  'secretmaterial',
  'resolvedsecret',
  'rawcredential',
  'providerresponse',
  'providercredentialresponse',
]);

export class ConnectorExecutionEnvelopeError extends Error {
  constructor(
    readonly code:
      'INVALID_ENVELOPE' | 'UNSUPPORTED_VERSION' | 'PAYLOAD_TOO_LARGE' | 'SECRET_MATERIAL',
  ) {
    super(code);
    this.name = 'ConnectorExecutionEnvelopeError';
  }
}

export function createAtlasJobEnvelope<TPayload extends JsonValue>(input: {
  readonly payload: TPayload;
  readonly idempotencyKey: string;
  readonly runId?: string;
  readonly correlationId?: string;
  readonly maxBytes: number;
}): AtlasJobEnvelope<TPayload> {
  return parseAtlasJobEnvelope(
    {
      schemaVersion: 1,
      runId: input.runId ?? randomUUID(),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    },
    input.maxBytes,
  ) as AtlasJobEnvelope<TPayload>;
}

export function parseAtlasJobEnvelope(input: unknown, maxBytes: number): AtlasJobEnvelope {
  if (!isPlainObject(input)) throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  const keys = Object.keys(input);
  if (
    keys.some(
      (key) =>
        !['schemaVersion', 'runId', 'correlationId', 'idempotencyKey', 'payload'].includes(key),
    )
  ) {
    throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  }
  if (input.schemaVersion !== 1) {
    throw new ConnectorExecutionEnvelopeError('UNSUPPORTED_VERSION');
  }
  if (!isUuidV4(input.runId)) throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  if (input.correlationId !== undefined && !isUuidV4(input.correlationId)) {
    throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  }
  if (
    typeof input.idempotencyKey !== 'string' ||
    !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
  ) {
    throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  }

  const payload = sanitizeJson(input.payload, new WeakSet<object>());
  const envelope = {
    schemaVersion: 1 as const,
    runId: input.runId.toLowerCase(),
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId.toLowerCase() }),
    idempotencyKey: input.idempotencyKey,
    payload,
  };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new ConnectorExecutionEnvelopeError('PAYLOAD_TOO_LARGE');
  }
  return deepFreeze(envelope);
}

function sanitizeJson(input: unknown, seen: WeakSet<object>): JsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'object') throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  if (seen.has(input)) throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
  seen.add(input);
  try {
    if (Array.isArray(input)) return input.map((item) => sanitizeJson(item, seen));
    if (!isPlainObject(input)) throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');

    if (Object.keys(input).length === 2 && 'providerKind' in input && 'logicalKey' in input) {
      try {
        return { ...parseSecretReference(input) };
      } catch {
        throw new ConnectorExecutionEnvelopeError('INVALID_ENVELOPE');
      }
    }

    const result: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(input)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (PROHIBITED_MATERIAL_KEYS.has(normalized)) {
        throw new ConnectorExecutionEnvelopeError('SECRET_MATERIAL');
      }
      result[key] = sanitizeJson(value, seen);
    }
    return result;
  } finally {
    seen.delete(input);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
