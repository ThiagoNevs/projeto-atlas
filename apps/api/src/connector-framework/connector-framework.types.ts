import type { ActorKind } from '../auth/auth.types';
import type { JsonValue } from '../connector-execution/connector-execution.types';
import type { ConnectorRunTrigger } from '../generated/prisma/client';
import type { ResolvedSecret } from '../secrets/resolved-secret';

export const CONNECTOR_DEFINITIONS = Symbol('CONNECTOR_DEFINITIONS');

export interface ConnectorWorkerPolicy {
  readonly concurrency: number;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly heartbeatSeconds?: number;
}

export interface ConnectorAssetObservation {
  readonly schemaVersion: 1;
  readonly observationType: 'ASSET';
  readonly providerRecordId: string;
  readonly observedAt: Date | string;
  readonly asset: Readonly<{
    hostname: string;
    type: string;
    category?: string;
    serialNumber?: string;
    manufacturer?: string;
    model?: string;
    operatingSystem?: string;
    osVersion?: string;
    ipAddresses?: readonly string[];
    macAddresses?: readonly string[];
    confidenceScore?: number;
    dataQualityScore?: number;
  }>;
  readonly payload: Readonly<Record<string, JsonValue>>;
}

export type ConnectorObservation = ConnectorAssetObservation;

export interface ConnectorSecretSlots {
  resolve(slot: string): Promise<ResolvedSecret>;
}

export interface ConnectorSafeLogger {
  debug(event: string): void;
  warn(event: string, errorCode: string): void;
}

export interface ConnectorCollectionContext<TConfig> {
  readonly connectorInstanceId: string;
  readonly runId: string;
  readonly config: TConfig;
  readonly signal: AbortSignal;
  readonly secrets: ConnectorSecretSlots;
  readonly logger: ConnectorSafeLogger;
  readonly now: () => Date;
}

export interface ConnectorDefinition<TConfig = unknown> {
  readonly connectorType: string;
  readonly configurationSchemaVersion: number;
  readonly capabilities: readonly string[];
  readonly supportedObservationTypes: readonly ConnectorObservation['observationType'][];
  readonly requiredSecretSlots: readonly string[];
  readonly workerPolicy: ConnectorWorkerPolicy;
  validateConfig(input: unknown): TConfig;
  collect(context: ConnectorCollectionContext<TConfig>): AsyncIterable<ConnectorObservation>;
}

export interface CreateConnectorRunInput {
  readonly connectorInstanceId: string;
  readonly trigger: ConnectorRunTrigger;
  readonly triggerActor: Readonly<{ kind: ActorKind; id: string }>;
  readonly requestIdentity: string;
  readonly scheduledFor?: Date;
  readonly correlationId?: string;
}

export type ConnectorRunJobPayload = Readonly<{
  schemaVersion: 1;
  connectorInstanceId: string;
}>;
