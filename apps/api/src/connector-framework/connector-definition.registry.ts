import { Inject, Injectable } from '@nestjs/common';

import { ConnectorFrameworkError } from './connector-framework.errors';
import {
  CONNECTOR_DEFINITIONS,
  type ConnectorDefinition,
  type ConnectorWorkerPolicy,
} from './connector-framework.types';

const CONNECTOR_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SECRET_SLOT_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

@Injectable()
export class ConnectorDefinitionRegistry {
  private readonly definitions: ReadonlyMap<string, ConnectorDefinition>;

  constructor(@Inject(CONNECTOR_DEFINITIONS) definitions: readonly ConnectorDefinition[]) {
    const registered = new Map<string, ConnectorDefinition>();
    for (const definition of definitions) {
      validateDefinition(definition);
      if (registered.has(definition.connectorType)) {
        throw new ConnectorFrameworkError('CONNECTOR_DEFINITION_DUPLICATE');
      }
      registered.set(definition.connectorType, freezeDefinition(definition));
    }
    this.definitions = registered;
  }

  get(connectorType: string): ConnectorDefinition {
    const definition = this.definitions.get(connectorType);
    if (!definition) throw new ConnectorFrameworkError('CONNECTOR_DEFINITION_NOT_FOUND');
    return definition;
  }

  list(): readonly ConnectorDefinition[] {
    return Object.freeze([...this.definitions.values()]);
  }
}

function validateDefinition(definition: ConnectorDefinition): void {
  if (
    !CONNECTOR_TYPE_PATTERN.test(definition.connectorType) ||
    !Number.isInteger(definition.configurationSchemaVersion) ||
    definition.configurationSchemaVersion < 1 ||
    typeof definition.validateConfig !== 'function' ||
    typeof definition.collect !== 'function' ||
    !uniqueNames(definition.capabilities, NAME_PATTERN) ||
    !uniqueNames(definition.supportedObservationTypes, NAME_PATTERN) ||
    definition.supportedObservationTypes.length === 0 ||
    !uniqueNames(definition.requiredSecretSlots, SECRET_SLOT_PATTERN) ||
    !validWorkerPolicy(definition.workerPolicy)
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_DEFINITION_INVALID');
  }
}

function uniqueNames(values: readonly string[], pattern: RegExp): boolean {
  return (
    Array.isArray(values) &&
    values.every((value) => typeof value === 'string' && pattern.test(value)) &&
    new Set(values).size === values.length
  );
}

function validWorkerPolicy(policy: ConnectorWorkerPolicy): boolean {
  return (
    typeof policy === 'object' &&
    policy !== null &&
    Number.isInteger(policy.concurrency) &&
    policy.concurrency >= 1 &&
    policy.concurrency <= 32 &&
    Number.isInteger(policy.retryLimit) &&
    policy.retryLimit >= 0 &&
    policy.retryLimit <= 20 &&
    Number.isInteger(policy.retryDelaySeconds) &&
    policy.retryDelaySeconds >= 0 &&
    policy.retryDelaySeconds <= 86_400 &&
    typeof policy.retryBackoff === 'boolean' &&
    Number.isInteger(policy.expireInSeconds) &&
    policy.expireInSeconds >= 1 &&
    policy.expireInSeconds <= 86_400 &&
    (policy.heartbeatSeconds === undefined ||
      (Number.isInteger(policy.heartbeatSeconds) &&
        policy.heartbeatSeconds >= 10 &&
        policy.heartbeatSeconds < policy.expireInSeconds))
  );
}

function freezeDefinition(definition: ConnectorDefinition): ConnectorDefinition {
  return Object.freeze({
    connectorType: definition.connectorType,
    configurationSchemaVersion: definition.configurationSchemaVersion,
    capabilities: Object.freeze([...definition.capabilities]),
    supportedObservationTypes: Object.freeze([...definition.supportedObservationTypes]),
    requiredSecretSlots: Object.freeze([...definition.requiredSecretSlots]),
    workerPolicy: Object.freeze({ ...definition.workerPolicy }),
    validateConfig: definition.validateConfig.bind(definition),
    collect: definition.collect.bind(definition),
  });
}

export function connectorQueueName(connectorType: string): string {
  if (!CONNECTOR_TYPE_PATTERN.test(connectorType)) {
    throw new ConnectorFrameworkError('CONNECTOR_DEFINITION_INVALID');
  }
  return `atlas.connector.${connectorType}`;
}
