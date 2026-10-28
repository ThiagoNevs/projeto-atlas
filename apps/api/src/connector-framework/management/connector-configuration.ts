import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { ConnectorFrameworkError } from '../connector-framework.errors';

const MAX_CONFIGURATION_BYTES = 65_536;
const MAX_DEPTH = 16;
const MAX_ARRAY_ITEMS = 1_024;
const MAX_OBJECT_KEYS = 256;
const PROHIBITED_KEYS = new Set([
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

export interface SafeConnectorConfiguration {
  readonly [key: string]: SafeJsonValue;
}
type SafeJsonValue =
  null | boolean | number | string | readonly SafeJsonValue[] | SafeConnectorConfiguration;

export function parseConnectorConfiguration(input: unknown): SafeConnectorConfiguration {
  const parsed = parseValue(input, 0, new WeakSet<object>());
  if (!isObject(parsed)) throw invalidConfiguration();
  if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAX_CONFIGURATION_BYTES) {
    throw invalidConfiguration();
  }
  return parsed;
}

export function connectorConfigurationFingerprint(input: SafeConnectorConfiguration): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function parseValue(input: unknown, depth: number, seen: WeakSet<object>): SafeJsonValue {
  if (depth > MAX_DEPTH) throw invalidConfiguration();
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'object' || utilTypes.isProxy(input) || seen.has(input)) {
    throw invalidConfiguration();
  }

  seen.add(input);
  try {
    if (Array.isArray(input)) return parseArray(input, depth, seen);
    return parseObject(input, depth, seen);
  } finally {
    seen.delete(input);
  }
}

function parseArray(
  input: unknown[],
  depth: number,
  seen: WeakSet<object>,
): readonly SafeJsonValue[] {
  if (input.length > MAX_ARRAY_ITEMS) throw invalidConfiguration();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) return true;
      const index = Number(key);
      return index >= input.length || !isEnumerableDataDescriptor(descriptors[key]);
    }) ||
    keys.length !== input.length + 1
  ) {
    throw invalidConfiguration();
  }
  return Object.freeze(
    Array.from({ length: input.length }, (_, index) =>
      parseValue(descriptors[String(index)]!.value, depth + 1, seen),
    ),
  );
}

function parseObject(
  input: object,
  depth: number,
  seen: WeakSet<object>,
): Readonly<Record<string, SafeJsonValue>> {
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) throw invalidConfiguration();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length > MAX_OBJECT_KEYS ||
    keys.some((key) => typeof key !== 'string' || !isEnumerableDataDescriptor(descriptors[key]))
  ) {
    throw invalidConfiguration();
  }
  const stringKeys = keys as string[];
  if (stringKeys.includes('providerKind') && stringKeys.includes('logicalKey')) {
    throw invalidConfiguration();
  }

  const result: Record<string, SafeJsonValue> = {};
  for (const key of stringKeys) {
    if (PROHIBITED_KEYS.has(normalizeKey(key))) throw invalidConfiguration();
    Object.defineProperty(result, key, {
      value: parseValue(descriptors[key]!.value, depth + 1, seen),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function canonicalJson(input: SafeJsonValue): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(',')}]`;
  const objectInput = input as SafeConnectorConfiguration;
  return `{${Object.keys(objectInput)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectInput[key]!)}`)
    .join(',')}}`;
}

function isObject(input: SafeJsonValue): input is SafeConnectorConfiguration {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    descriptor !== undefined &&
    descriptor.enumerable === true &&
    Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
    !Object.prototype.hasOwnProperty.call(descriptor, 'get') &&
    !Object.prototype.hasOwnProperty.call(descriptor, 'set')
  );
}

function invalidConfiguration(): ConnectorFrameworkError {
  return new ConnectorFrameworkError('CONNECTOR_CONFIG_INVALID');
}
