import { SecretResolutionError } from './secret-resolution.errors';
import { types as utilTypes } from 'node:util';

export type EnvironmentSecretReference = Readonly<{
  providerKind: 'ENV';
  logicalKey: string;
}>;

export type SecretReference = EnvironmentSecretReference;
export type SecretProviderKind = SecretReference['providerKind'];

const ENVIRONMENT_LOGICAL_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const RESERVED_LOGICAL_KEYS = new Set(['DATABASE_URL', 'NODE_ENV', 'PATH']);
const RESERVED_LOGICAL_KEY_PREFIXES = ['ATLAS_SECRET_', 'AUTH_', 'NEXT_PUBLIC_'] as const;

export function createEnvironmentSecretReference(logicalKey: string): EnvironmentSecretReference {
  return parseSecretReference({ providerKind: 'ENV', logicalKey });
}

export function parseSecretReference(input: unknown): SecretReference {
  const inspected = inspectReference(input);

  if (typeof inspected.providerKind !== 'string') {
    throw new SecretResolutionError('INVALID_REFERENCE');
  }

  if (inspected.providerKind !== 'ENV') {
    throw new SecretResolutionError('PROVIDER_NOT_SUPPORTED');
  }

  if (!isValidEnvironmentLogicalKey(inspected.logicalKey)) {
    throw new SecretResolutionError('INVALID_REFERENCE', 'ENV');
  }

  return Object.freeze({
    providerKind: 'ENV',
    logicalKey: inspected.logicalKey,
  });
}

function inspectReference(input: unknown): Readonly<{
  providerKind: unknown;
  logicalKey: unknown;
}> {
  if (typeof input !== 'object' || input === null) {
    throw new SecretResolutionError('INVALID_REFERENCE');
  }
  if (utilTypes.isProxy(input) || Array.isArray(input)) {
    throw new SecretResolutionError('INVALID_REFERENCE');
  }

  try {
    const prototype = Object.getPrototypeOf(input) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SecretResolutionError('INVALID_REFERENCE');
    }

    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 2 || !keys.includes('providerKind') || !keys.includes('logicalKey')) {
      throw new SecretResolutionError('INVALID_REFERENCE');
    }

    const providerDescriptor = descriptors.providerKind;
    const logicalKeyDescriptor = descriptors.logicalKey;
    if (
      !isEnumerableDataDescriptor(providerDescriptor) ||
      !isEnumerableDataDescriptor(logicalKeyDescriptor)
    ) {
      throw new SecretResolutionError('INVALID_REFERENCE');
    }

    return Object.freeze({
      providerKind: providerDescriptor.value as unknown,
      logicalKey: logicalKeyDescriptor.value as unknown,
    });
  } catch {
    throw new SecretResolutionError('INVALID_REFERENCE');
  }
}

function isValidEnvironmentLogicalKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ENVIRONMENT_LOGICAL_KEY_PATTERN.test(value) &&
    !RESERVED_LOGICAL_KEYS.has(value) &&
    !RESERVED_LOGICAL_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
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
