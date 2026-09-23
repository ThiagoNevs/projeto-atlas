import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';

import {
  ConnectorExecutionEnvelopeError,
  createAtlasJobEnvelope,
  parseAtlasJobEnvelope,
} from '../src/connector-execution/connector-execution-envelope';
import type { JsonValue } from '../src/connector-execution/connector-execution.types';

describe('Connector Execution job envelope', () => {
  it('creates a frozen versioned envelope with a stable logical idempotency key', () => {
    const envelope = createAtlasJobEnvelope({
      payload: { assetId: randomUUID() },
      idempotencyKey: 'connector:asset:operation-1',
      correlationId: randomUUID(),
      maxBytes: 4096,
    });

    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.idempotencyKey).toBe('connector:asset:operation-1');
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.payload)).toBe(true);
  });

  it('accepts a validated SecretReference without resolving secret material', () => {
    const envelope = createAtlasJobEnvelope({
      payload: {
        credentialReference: { providerKind: 'ENV', logicalKey: 'CONNECTOR_CLIENT' },
      },
      idempotencyKey: 'connector:reference:1',
      maxBytes: 4096,
    });

    expect(envelope.payload).toEqual({
      credentialReference: { providerKind: 'ENV', logicalKey: 'CONNECTOR_CLIENT' },
    });
  });

  it.each([
    { password: 'value' },
    { apiKey: 'value' },
    { token: 'value' },
    { accessToken: 'value' },
    { client_secret: 'value' },
    { privateKey: 'value' },
    { resolvedSecret: 'value' },
    { nested: { authorization: 'Bearer value' } },
  ])('rejects secret material keys without reflecting values: %j', (payload) => {
    expect(() =>
      createAtlasJobEnvelope({
        payload: payload as unknown as JsonValue,
        idempotencyKey: 'safe-key',
        maxBytes: 4096,
      }),
    ).toThrow(expect.objectContaining({ code: 'SECRET_MATERIAL', message: 'SECRET_MATERIAL' }));
  });

  it('rejects unsupported envelope versions', () => {
    expect(() =>
      parseAtlasJobEnvelope(
        {
          schemaVersion: 2,
          runId: randomUUID(),
          idempotencyKey: 'safe-key',
          payload: {},
        },
        4096,
      ),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
  });

  it('rejects malformed envelopes and non-JSON payloads', () => {
    expect(() =>
      parseAtlasJobEnvelope(
        {
          schemaVersion: 1,
          runId: randomUUID(),
          idempotencyKey: 'safe-key',
          payload: { invalid: undefined },
        },
        4096,
      ),
    ).toThrow(ConnectorExecutionEnvelopeError);
  });

  it('rejects payloads above the serialized byte limit', () => {
    expect(() =>
      createAtlasJobEnvelope({
        payload: { content: 'x'.repeat(4096) },
        idempotencyKey: 'safe-key',
        maxBytes: 1024,
      }),
    ).toThrow(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });

  it('rejects ambiguous or non-ASCII idempotency keys', () => {
    for (const idempotencyKey of ['', ' contains-space', 'chave-á', 'x'.repeat(201)]) {
      expect(() => createAtlasJobEnvelope({ payload: {}, idempotencyKey, maxBytes: 4096 })).toThrow(
        expect.objectContaining({ code: 'INVALID_ENVELOPE' }),
      );
    }
  });
});
