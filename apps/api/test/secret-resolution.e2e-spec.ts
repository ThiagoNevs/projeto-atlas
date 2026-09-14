import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { inspect } from 'node:util';

import { RequestContextService } from '../src/operational-context/request-context.service';
import { OperationalContextModule } from '../src/operational-context/operational-context.module';
import { ResolvedSecret } from '../src/secrets/resolved-secret';
import { SecretResolutionError } from '../src/secrets/secret-resolution.errors';
import type { SecretProvider } from '../src/secrets/secret-provider.interface';
import { SecretProviderRegistry } from '../src/secrets/secret-provider.registry';
import {
  createEnvironmentSecretReference,
  type EnvironmentSecretReference,
} from '../src/secrets/secret-reference.types';
import { SecretResolver } from '../src/secrets/secret-resolver.service';
import { SecretsModule } from '../src/secrets/secrets.module';

const SECRET_SENTINEL = 'SUPER_SECRET_TEST_VALUE_DO_NOT_LEAK_45';
const PROVIDER_GETTER_MARKER = 'RAW_PROVIDER_GETTER_MARKER_45';
const LOCATOR_GETTER_MARKER = 'RAW_LOCATOR_GETTER_MARKER_45';
const PROXY_MARKER = 'RAW_PROXY_MARKER_45';
const PRIVATE_LOCATOR_MARKER = 'ULTRA_PRIVATE_LOCATOR_MARKER_45';
const ENVIRONMENT_PREFIX = 'ATLAS_SECRET_';
const touchedEnvironment = new Map<string, string | undefined>();

describe('secret reference resolution foundation', () => {
  let module: TestingModule;
  let resolver: SecretResolver;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [OperationalContextModule, SecretsModule],
    }).compile();
    resolver = module.get(SecretResolver);
  });

  afterEach(() => {
    for (const [name, originalValue] of touchedEnvironment) {
      if (originalValue === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = originalValue;
      }
    }
    touchedEnvironment.clear();
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves only the derived ENV namespace and preserves the exact secret value', async () => {
    const value = ` ${SECRET_SENTINEL}\ncom Unicode: ação `;
    setSecretEnvironment('AD_PROD_BIND_PASSWORD', value);

    const reference = createEnvironmentSecretReference('AD_PROD_BIND_PASSWORD');
    const secret = await resolver.resolve(reference);

    expect(Object.isFrozen(reference)).toBe(true);
    expect(secret.use((resolved) => resolved)).toBe(value);
    await expect(secret.use(async (resolved) => Promise.resolve(resolved))).resolves.toBe(value);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('returns SECRET_NOT_FOUND for an %s environment value', async (_label, value) => {
    setSecretEnvironment('MISSING_TEST_SECRET', value);

    await expect(
      resolver.resolve(createEnvironmentSecretReference('MISSING_TEST_SECRET')),
    ).rejects.toMatchObject({
      code: 'SECRET_NOT_FOUND',
      providerKind: 'ENV',
    });
  });

  it.each([
    ['lowercase', 'foo'],
    ['hyphen', 'FOO-BAR'],
    ['leading whitespace', ' FOO'],
    ['trailing whitespace', 'FOO '],
    ['control character', 'FOO\nBAR'],
    ['Unicode', 'SEGREDO_Ç'],
    ['too long', `A${'B'.repeat(128)}`],
    ['database configuration', 'DATABASE_URL'],
    ['auth configuration', 'AUTH_ISSUER'],
    ['public browser configuration', 'NEXT_PUBLIC_API_URL'],
    ['full provider key', 'ATLAS_SECRET_FOO'],
    ['process configuration', 'NODE_ENV'],
    ['process path', 'PATH'],
  ])('rejects %s as an ENV logical key', async (_label, logicalKey) => {
    await expect(resolver.resolve({ providerKind: 'ENV', logicalKey })).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      providerKind: 'ENV',
    });
  });

  it('rejects additional reference properties instead of carrying arbitrary payloads', async () => {
    await expect(
      resolver.resolve({ providerKind: 'ENV', logicalKey: 'VALID_KEY', secret: SECRET_SENTINEL }),
    ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'ENV'],
    ['number', 1],
    ['boolean', true],
    ['bigint', BigInt(1)],
    ['symbol', Symbol('ENV')],
    ['function', () => undefined],
    ['array', ['ENV', 'VALID_KEY']],
  ] as const)('rejects the primitive/basic %s shape', async (_label, input) => {
    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it('rejects inherited reference properties and non-plain objects', async () => {
    const inherited = Object.create({
      providerKind: 'ENV',
      logicalKey: 'INHERITED_KEY',
    }) as unknown;

    await expect(resolver.resolve(inherited)).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
    });
    await expect(resolver.resolve(new Date())).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
    });
    await expect(resolver.resolve(new ReferenceClassFixture())).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
    });
  });

  it('rejects providerKind accessors without invoking their getter or reflecting its marker', async () => {
    let getterCalled = false;
    const input = Object.defineProperties(
      {},
      {
        providerKind: {
          enumerable: true,
          get: () => {
            getterCalled = true;
            throw new Error(PROVIDER_GETTER_MARKER);
          },
        },
        logicalKey: { enumerable: true, value: 'VALID_KEY' },
      },
    );

    const error = await captureRejection(resolver.resolve(input));

    expect(getterCalled).toBe(false);
    expect(error).toBeInstanceOf(SecretResolutionError);
    expect(error).toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(serializeDiagnostic(error)).not.toContain(PROVIDER_GETTER_MARKER);
  });

  it('rejects logicalKey accessors without invoking or reflecting a sensitive locator', async () => {
    let getterCalled = false;
    const input = Object.defineProperties(
      {},
      {
        providerKind: { enumerable: true, value: 'ENV' },
        logicalKey: {
          enumerable: true,
          get: () => {
            getterCalled = true;
            throw new Error(`${LOCATOR_GETTER_MARKER}:${PRIVATE_LOCATOR_MARKER}`);
          },
        },
      },
    );

    const error = await captureRejection(resolver.resolve(input));

    expect(getterCalled).toBe(false);
    expect(error).toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(serializeDiagnostic(error)).not.toContain(LOCATOR_GETTER_MARKER);
    expect(serializeDiagnostic(error)).not.toContain(PRIVATE_LOCATOR_MARKER);
  });

  it('rejects a valid-looking accessor by contract without invoking it', async () => {
    let getterCalled = false;
    const input = Object.defineProperties(
      {},
      {
        providerKind: {
          enumerable: true,
          get: () => {
            getterCalled = true;
            return 'ENV';
          },
        },
        logicalKey: { enumerable: true, value: 'VALID_KEY' },
      },
    );

    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(getterCalled).toBe(false);
  });

  it('rejects Proxy input before any introspection trap executes', async () => {
    let trapCalls = 0;
    const throwFromTrap = (): never => {
      trapCalls += 1;
      throw new Error(PROXY_MARKER);
    };
    const input = new Proxy(
      { providerKind: 'ENV', logicalKey: 'VALID_KEY' },
      {
        get: throwFromTrap,
        getPrototypeOf: throwFromTrap,
        ownKeys: throwFromTrap,
        getOwnPropertyDescriptor: throwFromTrap,
      },
    );

    const error = await captureRejection(resolver.resolve(input));

    expect(trapCalls).toBe(0);
    expect(error).toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(serializeDiagnostic(error)).not.toContain(PROXY_MARKER);
  });

  it('accepts ordinary and null-prototype objects with enumerable own data properties', async () => {
    setSecretEnvironment('ORDINARY_OBJECT', 'ordinary-value');
    setSecretEnvironment('NULL_PROTOTYPE', 'null-prototype-value');
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(nullPrototype, {
      providerKind: { enumerable: true, value: 'ENV' },
      logicalKey: { enumerable: true, value: 'NULL_PROTOTYPE' },
    });

    const ordinary = await resolver.resolve({
      providerKind: 'ENV',
      logicalKey: 'ORDINARY_OBJECT',
    });
    const withoutPrototype = await resolver.resolve(nullPrototype);

    expect(ordinary.use((value) => value)).toBe('ordinary-value');
    expect(withoutPrototype.use((value) => value)).toBe('null-prototype-value');
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects the special own field %s',
    async (field) => {
      const input = { providerKind: 'ENV', logicalKey: 'VALID_KEY' };
      Object.defineProperty(input, field, { enumerable: true, value: 'unexpected' });

      await expect(resolver.resolve(input)).rejects.toMatchObject({
        code: 'INVALID_REFERENCE',
      });
    },
  );

  it('rejects an additional symbol field', async () => {
    const input = { providerKind: 'ENV', logicalKey: 'VALID_KEY' };
    Object.defineProperty(input, Symbol('extra'), { enumerable: true, value: 'unexpected' });

    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it('rejects an unknown provider without reflecting its raw identifier', async () => {
    const rawProvider = `UNKNOWN_${SECRET_SENTINEL}`;
    let captured: unknown;

    try {
      await resolver.resolve({ providerKind: rawProvider, logicalKey: 'VALID_KEY' });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(SecretResolutionError);
    expect(captured).toMatchObject({ code: 'PROVIDER_NOT_SUPPORTED' });
    expect(serializeDiagnostic(captured)).not.toContain(rawProvider);
    expect(serializeDiagnostic(captured)).not.toContain(SECRET_SENTINEL);
  });

  it('fails deterministically when the same provider kind is registered twice', () => {
    const first = new FixedEnvironmentProvider();
    const second = new FixedEnvironmentProvider();

    expect(() => new SecretProviderRegistry([first, second])).toThrow(
      'A configuração de provedores de segredo contém tipos duplicados.',
    );
  });

  it('sanitizes an unexpected provider failure without retaining its raw error', async () => {
    const failingProvider: SecretProvider<EnvironmentSecretReference> = {
      kind: 'ENV',
      resolve: () => Promise.reject(new Error(`provider raw response ${SECRET_SENTINEL}`)),
    };
    const isolatedResolver = new SecretResolver(new SecretProviderRegistry([failingProvider]));
    let captured: unknown;

    try {
      await isolatedResolver.resolve(createEnvironmentSecretReference('PROVIDER_FAILURE'));
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(SecretResolutionError);
    expect(captured).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', providerKind: 'ENV' });
    expect(serializeDiagnostic(captured)).not.toContain(SECRET_SENTINEL);
    expect((captured as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('redacts the wrapper from string, JSON, inspection and property enumeration', () => {
    const secret = ResolvedSecret.from(SECRET_SENTINEL);

    expect(String(secret)).toBe('[REDACTED_SECRET]');
    expect(JSON.stringify(secret)).toBe('"[REDACTED_SECRET]"');
    expect(inspect(secret)).toBe('[REDACTED_SECRET]');
    expect(Object.keys(secret)).toEqual([]);
    expect(Object.getOwnPropertyNames(secret)).toEqual([]);
    expect('value' in secret).toBe(false);
    expect('raw' in secret).toBe(false);
    expect('unwrap' in secret).toBe(false);
    expect(serializeDiagnostic(secret)).not.toContain(SECRET_SENTINEL);
  });

  it('preserves the existing operational context throughout asynchronous resolution', async () => {
    const contextService = module.get(RequestContextService);
    const observed: unknown[] = [];
    const provider = new ContextObservingProvider(contextService, observed);
    const isolatedResolver = new SecretResolver(new SecretProviderRegistry([provider]));
    const context = Object.freeze({
      requestId: '1c121fd5-a889-48d3-a2c4-f3a0ca0b0d22',
      correlationId: '826efcf7-04ae-4573-8441-960115401bf5',
    });

    await contextService.runWithContext(context, async () => {
      observed.push(contextService.getContext());
      const secret = await isolatedResolver.resolve(
        createEnvironmentSecretReference('CONTEXT_TEST_SECRET'),
      );
      observed.push(contextService.getContext());
      expect(secret.use((value) => value)).toBe('context-test-value');
    });

    expect(observed).toEqual([context, context, context]);
    expect(contextService.getContext()).toBeUndefined();
  });
});

class FixedEnvironmentProvider implements SecretProvider<EnvironmentSecretReference> {
  readonly kind = 'ENV' as const;

  resolve(): Promise<ResolvedSecret> {
    return Promise.resolve(ResolvedSecret.from('fixed-test-value'));
  }
}

class ContextObservingProvider implements SecretProvider<EnvironmentSecretReference> {
  readonly kind = 'ENV' as const;

  constructor(
    private readonly contextService: RequestContextService,
    private readonly observed: unknown[],
  ) {}

  async resolve(): Promise<ResolvedSecret> {
    await Promise.resolve();
    this.observed.push(this.contextService.getContext());
    return ResolvedSecret.from('context-test-value');
  }
}

class ReferenceClassFixture {
  readonly providerKind = 'ENV';
  readonly logicalKey = 'CLASS_INSTANCE';
}

function setSecretEnvironment(logicalKey: string, value: string | undefined): void {
  const name = `${ENVIRONMENT_PREFIX}${logicalKey}`;
  if (!touchedEnvironment.has(name)) {
    touchedEnvironment.set(name, process.env[name]);
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function serializeDiagnostic(value: unknown): string {
  return `${String(value)}\n${JSON.stringify(value)}\n${inspect(value)}`;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('A operação de teste deveria ter sido rejeitada.');
}
