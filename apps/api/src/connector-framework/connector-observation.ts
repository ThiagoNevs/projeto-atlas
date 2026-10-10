import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { types as utilTypes } from 'node:util';

import type { NormalizedAssetObservation } from '../ingestion/normalized-asset-observation';
import { ConnectorFrameworkError } from './connector-framework.errors';

const MAX_PAYLOAD_BYTES = 65_536;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAC_ADDRESS_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
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

type SafeJson =
  null | boolean | number | string | readonly SafeJson[] | { readonly [key: string]: SafeJson };

interface ParsedAsset {
  readonly hostname: string;
  readonly type: string;
  readonly category?: string;
  readonly serialNumber?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly operatingSystem?: string;
  readonly osVersion?: string;
  readonly ipAddresses?: readonly string[];
  readonly macAddresses?: readonly string[];
  readonly confidenceScore?: number;
  readonly dataQualityScore?: number;
}

export interface ParsedConnectorObservation {
  readonly normalized: NormalizedAssetObservation;
  readonly semanticFingerprint: string;
  readonly connectorObservationKey: string;
}

export function parseConnectorObservation(input: {
  readonly observation: unknown;
  readonly connectorType: string;
  readonly connectorInstanceId: string;
  readonly runId: string;
  readonly supportedObservationTypes: readonly string[];
}): ParsedConnectorObservation {
  if (!UUID_PATTERN.test(input.connectorInstanceId) || !UUID_PATTERN.test(input.runId)) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  const raw = exactObject(input.observation, [
    'schemaVersion',
    'observationType',
    'providerRecordId',
    'observedAt',
    'asset',
    'payload',
  ]);
  if (
    raw.schemaVersion !== 1 ||
    raw.observationType !== 'ASSET' ||
    !input.supportedObservationTypes.includes(raw.observationType)
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }

  const providerRecordId = boundedString(raw.providerRecordId, 255);
  const observedAt = parseObservedAt(raw.observedAt);
  const asset = parseAsset(raw.asset);
  const assetPayload = Object.fromEntries(
    Object.entries(asset).filter(([, value]) => value !== undefined),
  );
  const providerPayload = sanitizeJson(raw.payload, new WeakSet<object>());
  if (!isJsonObject(providerPayload)) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }

  const sourceFaithfulPayload = {
    schemaVersion: 1,
    observationType: 'ASSET',
    providerRecordId,
    observedAt: observedAt.toISOString(),
    asset: assetPayload,
    provider: providerPayload,
  } satisfies SafeJson;
  if (Buffer.byteLength(JSON.stringify(sourceFaithfulPayload), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }

  const semanticPayload = {
    schemaVersion: 1,
    observationType: 'ASSET',
    providerRecordId,
    asset: assetPayload,
    provider: providerPayload,
  } satisfies SafeJson;
  const semanticFingerprint = sha256(canonicalJson(semanticPayload));
  const connectorObservationKey = sha256(
    canonicalJson({
      connectorInstanceId: input.connectorInstanceId.toLowerCase(),
      runId: input.runId.toLowerCase(),
      observationType: 'ASSET',
      providerRecordId,
      semanticFingerprint,
    }),
  );

  return Object.freeze({
    semanticFingerprint,
    connectorObservationKey,
    normalized: Object.freeze({
      source: `connector:${input.connectorType}:${input.connectorInstanceId.toLowerCase()}`,
      sourceRecordId: providerRecordId,
      hostname: asset.hostname,
      type: asset.type,
      ...optional(asset, 'category'),
      ...optional(asset, 'serialNumber'),
      ...optional(asset, 'manufacturer'),
      ...optional(asset, 'model'),
      ...optional(asset, 'operatingSystem'),
      ...optional(asset, 'osVersion'),
      ...optional(asset, 'ipAddresses'),
      ...optional(asset, 'macAddresses'),
      ...optional(asset, 'confidenceScore'),
      ...optional(asset, 'dataQualityScore'),
      observedAt,
      evidenceType: 'CONNECTOR_ASSET_OBSERVATION',
      payload: sourceFaithfulPayload,
      description: `Observação técnica recebida do conector ${input.connectorType}.`,
      connectorRunId: input.runId.toLowerCase(),
      connectorObservationKey,
    }),
  });
}

function parseAsset(input: unknown): ParsedAsset {
  const raw = exactObject(input, [
    'hostname',
    'type',
    'category',
    'serialNumber',
    'manufacturer',
    'model',
    'operatingSystem',
    'osVersion',
    'ipAddresses',
    'macAddresses',
    'confidenceScore',
    'dataQualityScore',
  ]);
  const parsed: Record<string, unknown> = {
    hostname: boundedString(raw.hostname, 255),
    type: boundedString(raw.type, 100),
  };
  for (const [key, maximum] of [
    ['category', 100],
    ['serialNumber', 255],
    ['manufacturer', 255],
    ['model', 255],
    ['operatingSystem', 255],
    ['osVersion', 100],
  ] as const) {
    if (raw[key] !== undefined) parsed[key] = boundedString(raw[key], maximum);
  }
  if (raw.ipAddresses !== undefined) {
    parsed.ipAddresses = stringArray(raw.ipAddresses, (value) => isIP(value) !== 0);
  }
  if (raw.macAddresses !== undefined) {
    parsed.macAddresses = stringArray(raw.macAddresses, (value) =>
      MAC_ADDRESS_PATTERN.test(value.replaceAll('-', ':')),
    ).map((value) => value.replaceAll('-', ':').toLowerCase());
  }
  for (const key of ['confidenceScore', 'dataQualityScore'] as const) {
    if (raw[key] !== undefined) parsed[key] = score(raw[key]);
  }
  return Object.freeze(parsed) as unknown as ParsedAsset;
}

function exactObject(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(input) || utilTypes.isProxy(input)) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== 'string' ||
        !allowedKeys.includes(key) ||
        !isEnumerableDataDescriptor(descriptors[key]),
    )
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value as unknown]),
  );
}

function sanitizeJson(input: unknown, seen: WeakSet<object>): SafeJson {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'object' || utilTypes.isProxy(input) || seen.has(input)) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  seen.add(input);
  try {
    if (Array.isArray(input)) return input.map((item) => sanitizeJson(item, seen));
    const raw = exactObject(input, Object.keys(input));
    if (Object.keys(raw).length === 2 && 'providerKind' in raw && 'logicalKey' in raw) {
      throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
    }
    const result: Record<string, SafeJson> = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (PROHIBITED_MATERIAL_KEYS.has(normalizedKey)) {
        throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
      }
      result[key] = sanitizeJson(value, seen);
    }
    return result;
  } finally {
    seen.delete(input);
  }
}

function parseObservedAt(input: unknown): Date {
  if (
    (typeof input !== 'string' && !(input instanceof Date)) ||
    (typeof input === 'object' && input !== null && utilTypes.isProxy(input))
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  if (typeof input === 'string' && !isCalendarTimestamp(input)) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  return date;
}

function isCalendarTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);

  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetMinute > 59) return false;
  return offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function boundedString(input: unknown, maximum: number): string {
  if (typeof input !== 'string') {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  const value = input.trim();
  if (value.length < 1 || value.length > maximum) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  return value;
}

function stringArray(input: unknown, validate: (value: string) => boolean): string[] {
  if (!Array.isArray(input) || utilTypes.isProxy(input) || input.length > 64) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.entries(descriptors).some(
      ([key, descriptor]) => key !== 'length' && !isEnumerableDataDescriptor(descriptor),
    )
  ) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  const values = input.map((value) => boundedString(value, 255).toLowerCase());
  if (!values.every(validate)) throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  return [...new Set(values)];
}

function score(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 100) {
    throw new ConnectorFrameworkError('CONNECTOR_OBSERVATION_INVALID');
  }
  return input;
}

function optional<T extends object, K extends keyof T>(value: T, key: K): Partial<Pick<T, K>> {
  return value[key] === undefined ? {} : ({ [key]: value[key] } as Partial<Pick<T, K>>);
}

function canonicalJson(input: SafeJson): string {
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(',')}]`;
  if (isJsonObject(input)) {
    return `{${Object.keys(input)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key]!)}`)
      .join(',')}}`;
  }
  return JSON.stringify(input);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isJsonObject(value: SafeJson): value is { readonly [key: string]: SafeJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
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
