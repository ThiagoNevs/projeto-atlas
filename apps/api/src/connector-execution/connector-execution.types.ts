import type { PrismaTransactionLike } from 'pg-boss';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface AtlasJobEnvelope<TPayload extends JsonValue = JsonValue> {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly correlationId?: string;
  readonly idempotencyKey: string;
  readonly payload: TPayload;
}

export interface AtlasEnqueueOptions {
  readonly priority?: number;
  readonly startAfter?: Date | string | number;
  readonly singletonKey?: string;
}

export interface AtlasWorkerContext {
  readonly jobId: string;
  readonly queueName: string;
  readonly signal: AbortSignal;
  readonly idempotencyKey: string;
  readonly runId: string;
  readonly correlationId?: string;
}

export interface AtlasWorkerDefinition<TPayload extends JsonValue = JsonValue> {
  readonly queueName: string;
  readonly deadLetterQueue: string;
  readonly concurrency: number;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly heartbeatSeconds?: number;
  readonly handler: (payload: TPayload, context: AtlasWorkerContext) => Promise<void>;
}

export interface ConnectorExecutionState {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly status: 'disabled' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
  readonly schemaVersion?: number;
  readonly workerCount: number;
}

export interface ConnectorQueueState {
  readonly queueName: string;
  readonly queued: number;
  readonly active: number;
  readonly failed: number;
  readonly total: number;
  readonly capturedAt: string;
}

export type AtlasPrismaTransaction = PrismaTransactionLike;
