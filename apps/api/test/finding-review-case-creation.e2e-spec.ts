import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { oidcActorId } from '../src/auth/actor-id';
import { startTestAuthHarness, type TestAuthHarness } from './auth-test-harness';
import type { ConflictFinding } from '../src/conflict-analysis/types/conflict-analysis';
import type { Prisma } from '../src/generated/prisma/client';
import {
  buildFindingReviewSnapshot,
  canonicalSerialize,
  compareCanonicalStrings,
  creationRequestFingerprint,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  normalizeIdempotencyKey,
  reviewSubjectKey,
  sha256,
  snapshotHash,
} from '../src/finding-review-cases/finding-review-case-creation';
import {
  FINDING_REVIEW_CASES_FEATURE_FLAG,
  parseFindingReviewCasesEnabled,
} from '../src/finding-review-cases/finding-review-cases.feature';
import { PrismaService } from '../src/prisma/prisma.service';

const NOW = '2026-07-19T12:00:00.000Z';

const TEST_ACTOR_ID = 'human:oidc:test:actor';

type TransactionFailureStep = 'relations' | 'event' | 'audit';
type UnknownFunction = (...args: unknown[]) => unknown;

class FaultInjectingPrismaService extends PrismaService {
  private transactionFailure: TransactionFailureStep | null = null;

  constructor() {
    super();
    const realTransaction = this.$transaction.bind(this) as unknown as UnknownFunction;
    this.$transaction = ((input: unknown, ...options: unknown[]) => {
      if (typeof input !== 'function') {
        return Reflect.apply(realTransaction, this, [input, ...options]);
      }

      const callback = input as (client: Prisma.TransactionClient) => Promise<unknown>;
      return Reflect.apply(realTransaction, this, [
        (client: Prisma.TransactionClient) => callback(this.wrapTransaction(client)),
        ...options,
      ]);
    }) as typeof this.$transaction;
  }

  failNextTransactionAt(step: TransactionFailureStep): void {
    this.transactionFailure = step;
  }

  clearTransactionFailure(): void {
    this.transactionFailure = null;
  }

  private wrapTransaction(client: Prisma.TransactionClient): Prisma.TransactionClient {
    return new Proxy(client, {
      get: (target, property) => {
        const delegate = (target as unknown as Record<PropertyKey, unknown>)[property];
        const step = this.delegateFailureStep(property);
        if (!step || typeof delegate !== 'object' || delegate === null) return delegate;

        return new Proxy(delegate, {
          get: (delegateTarget, method) => {
            const operation = (delegateTarget as Record<PropertyKey, unknown>)[method];
            if (typeof operation !== 'function') return operation;
            return (...args: unknown[]) => {
              if (this.shouldFail(step, method)) {
                this.transactionFailure = null;
                throw new Error(`TEST_TRANSACTION_FAILURE:${step}`);
              }
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }

  private delegateFailureStep(property: string | symbol): TransactionFailureStep | null {
    if (property === 'findingReviewCaseAsset') return 'relations';
    if (property === 'findingReviewEvent') return 'event';
    if (property === 'auditLog') return 'audit';
    return null;
  }

  private shouldFail(step: TransactionFailureStep, method: string | symbol): boolean {
    if (this.transactionFailure !== step) return false;
    if (step === 'relations') return method === 'createMany';
    return method === 'create';
  }
}

interface CaseResponseBody {
  id: string;
  findingId: string;
  findingType: string;
  policyVersion: string;
  reviewSubjectKey: string;
  status: string;
  staleness: string;
  version: number;
  createdBy: string;
  idempotentReplay: boolean;
  affectedAssets: Array<{ assetId: string; assetName: string | null; role: string }>;
}

interface ErrorResponseBody {
  code?: string;
  message?: string;
  existingCaseId?: string;
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

function finding(overrides: Partial<ConflictFinding> = {}): ConflictFinding {
  return {
    findingId: 'finding_0123456789abcdef01234567',
    type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    mode: 'SHADOW',
    requiresHumanReview: true,
    affectedAssetIds: [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ],
    normalizedHostname: 'srv-app-01',
    normalizedIp: null,
    observations: [],
    temporalContext: {
      firstObservedAt: null,
      lastObservedAt: null,
      differenceMilliseconds: null,
      relationship: 'NO_TEMPORAL_CONTEXT',
    },
    explanation: ['Revisão humana necessária.'],
    limitations: ['Contexto temporal indisponível.'],
    reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
    ...overrides,
  };
}

describe('Finding review case creation primitives', () => {
  it('keeps object serialization deterministic while preserving meaningful array order', () => {
    expect(canonicalSerialize({ z: 1, a: { y: 2, x: 3 } })).toBe(
      canonicalSerialize({ a: { x: 3, y: 2 }, z: 1 }),
    );
    expect(canonicalSerialize({ values: ['a', 'b'] })).not.toBe(
      canonicalSerialize({ values: ['b', 'a'] }),
    );
  });

  it('uses locale-independent canonical ordering for ASCII, case and accented strings', () => {
    expect(['é', 'a', 'Z', 'z'].sort(compareCanonicalStrings)).toEqual(['Z', 'a', 'z', 'é']);
    expect(canonicalSerialize({ é: 1, a: 2, Z: 3 })).toBe(canonicalSerialize({ Z: 3, a: 2, é: 1 }));
  });

  it('pins the locale-independent canonical serialization contract with a fixed vector', () => {
    const expected =
      '{"ascii":"Atlas","nested":{"A":"primeiro","z":"último"},"ordered":["Árvore","Zulu"],"set":["Zulu","Árvore"],"unicode":"ação"}';
    const expectedHash = '6d8d18572cb6e4c4a2d7dddc0efb624f6764f00c5edb5444a3828eb4be42c809';
    const first = {
      unicode: 'ação',
      set: ['Árvore', 'Zulu'].sort(compareCanonicalStrings),
      ordered: ['Árvore', 'Zulu'],
      nested: { z: 'último', A: 'primeiro' },
      ascii: 'Atlas',
    };
    const second = {
      ascii: 'Atlas',
      nested: { A: 'primeiro', z: 'último' },
      ordered: ['Árvore', 'Zulu'],
      set: ['Zulu', 'Árvore'].sort(compareCanonicalStrings),
      unicode: 'ação',
    };

    expect(canonicalSerialize(first)).toBe(expected);
    expect(canonicalSerialize(second)).toBe(expected);
    expect(sha256(expected)).toBe(expectedHash);
    expect(canonicalSerialize({ ...first, ordered: ['Zulu', 'Árvore'] })).not.toBe(expected);
  });

  it('hashes equivalent snapshot sets identically regardless of insertion order', () => {
    const observations: ConflictFinding['observations'] = [
      {
        assetId: '00000000-0000-4000-8000-000000000001',
        value: 'Servidor Árvore',
        normalizedValue: 'servidor-arvore',
        attribute: 'HOSTNAME',
        source: 'Fonte Á',
        sourceType: 'MANUAL',
        evidenceId: null,
        observedAt: NOW,
        ingestedAt: NOW,
        current: true,
      },
      {
        assetId: '00000000-0000-4000-8000-000000000002',
        value: 'Servidor Z',
        normalizedValue: 'servidor-z',
        attribute: 'HOSTNAME',
        source: 'Fonte Z',
        sourceType: 'TECHNICAL',
        evidenceId: null,
        observedAt: NOW,
        ingestedAt: NOW,
        current: true,
      },
    ];
    const affectedAssets = [
      { assetId: '00000000-0000-4000-8000-000000000002', name: 'Z' },
      { assetId: '00000000-0000-4000-8000-000000000001', name: 'Á' },
    ];
    const first = buildFindingReviewSnapshot({
      finding: finding({ observations, limitations: ['Zulu', 'Árvore'] }),
      policyVersion: '2026-07-conflict-v1',
      generatedAt: NOW,
      affectedAssets,
    });
    const second = buildFindingReviewSnapshot({
      finding: finding({
        observations: [...observations].reverse(),
        limitations: ['Árvore', 'Zulu'],
      }),
      policyVersion: '2026-07-conflict-v1',
      generatedAt: NOW,
      affectedAssets: [...affectedAssets].reverse(),
    });
    expect(canonicalSerialize(first)).toBe(canonicalSerialize(second));
    expect(snapshotHash(first)).toBe(snapshotHash(second));
  });

  it('pins the binary snapshotVersion 1 serialization and hash with a realistic Unicode vector', () => {
    const observations: ConflictFinding['observations'] = [
      {
        assetId: '00000000-0000-4000-8000-000000000001',
        value: 'Servidor Árvore',
        normalizedValue: 'servidor-arvore',
        attribute: 'HOSTNAME',
        source: 'Árvore',
        sourceType: 'MANUAL',
        evidenceId: null,
        observedAt: NOW,
        ingestedAt: NOW,
        current: true,
      },
      {
        assetId: '00000000-0000-4000-8000-000000000002',
        value: 'Servidor Z',
        normalizedValue: 'servidor-z',
        attribute: 'HOSTNAME',
        source: 'Zulu',
        sourceType: 'MANUAL',
        evidenceId: null,
        observedAt: NOW,
        ingestedAt: NOW,
        current: true,
      },
    ];
    const snapshot = buildFindingReviewSnapshot({
      finding: finding({
        observations,
        limitations: ['Árvore', 'Zulu'],
      }),
      policyVersion: '2026-07-conflict-v1',
      generatedAt: NOW,
      affectedAssets: [
        { assetId: '00000000-0000-4000-8000-000000000002', name: 'Z' },
        { assetId: '00000000-0000-4000-8000-000000000001', name: 'Á' },
      ],
    });
    const expected =
      '{"affectedAssets":[{"assetId":"00000000-0000-4000-8000-000000000001","name":"Á"},{"assetId":"00000000-0000-4000-8000-000000000002","name":"Z"}],"explanation":["Revisão humana necessária."],"findingId":"finding_0123456789abcdef01234567","findingType":"DUPLICATE_HOSTNAME_ACROSS_ASSETS","generatedAt":"2026-07-19T12:00:00.000Z","limitations":["Zulu","Árvore"],"normalizedHostname":"srv-app-01","normalizedIp":null,"observations":[{"assetId":"00000000-0000-4000-8000-000000000001","attribute":"HOSTNAME","current":true,"evidenceId":null,"ingestedAt":"2026-07-19T12:00:00.000Z","normalizedValue":"servidor-arvore","observedAt":"2026-07-19T12:00:00.000Z","source":"Árvore","sourceType":"MANUAL","value":"Servidor Árvore"},{"assetId":"00000000-0000-4000-8000-000000000002","attribute":"HOSTNAME","current":true,"evidenceId":null,"ingestedAt":"2026-07-19T12:00:00.000Z","normalizedValue":"servidor-z","observedAt":"2026-07-19T12:00:00.000Z","source":"Zulu","sourceType":"MANUAL","value":"Servidor Z"}],"policyVersion":"2026-07-conflict-v1","reviewOptions":["SAME_ASSET","DIFFERENT_ASSETS"],"snapshotVersion":1,"sources":[{"identifier":"Zulu","type":"MANUAL"},{"identifier":"Árvore","type":"MANUAL"}],"temporalContext":{"differenceMilliseconds":null,"firstObservedAt":null,"lastObservedAt":null,"relationship":"NO_TEMPORAL_CONTEXT"}}';
    const expectedHash = '637c77692340fdd261fb47be257febc9c884f7a222993eb2a7d8b4d4107fd1b7';

    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.limitations).toEqual(['Zulu', 'Árvore']);
    expect(snapshot.sources.map((source) => source.identifier)).toEqual(['Zulu', 'Árvore']);
    expect(canonicalSerialize(snapshot)).toBe(expected);
    expect(snapshotHash(snapshot)).toBe(expectedHash);
    expect(sha256(expected)).toBe(expectedHash);
  });

  it('creates the same subject for equivalent hostnames and a different subject for another type', () => {
    const first = reviewSubjectKey(finding({ normalizedHostname: 'srv-app-01' }));
    const equivalent = reviewSubjectKey(finding({ normalizedHostname: 'srv-app-01' }));
    const otherType = reviewSubjectKey(
      finding({
        type: 'HOSTNAME_DIVERGENCE_ON_ASSET',
        normalizedHostname: null,
        affectedAssetIds: ['00000000-0000-4000-8000-000000000001'],
      }),
    );
    expect(first).toBe(equivalent);
    expect(first).not.toBe(otherType);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['10.20.0.15', '2001:db8::1'])(
    'uses the canonical IP as the shared-IP subject: %s',
    (ip) => {
      const key = reviewSubjectKey(
        finding({
          type: 'SHARED_IP_DIFFERENT_HOSTNAMES',
          normalizedHostname: null,
          normalizedIp: ip,
        }),
      );
      expect(key).toBe(
        reviewSubjectKey(
          finding({
            type: 'SHARED_IP_DIFFERENT_HOSTNAMES',
            normalizedHostname: null,
            normalizedIp: ip,
          }),
        ),
      );
    },
  );

  it('builds a typed deterministic snapshot and a 64-character hash', () => {
    const input = {
      finding: finding(),
      policyVersion: '2026-07-conflict-v1',
      generatedAt: NOW,
      affectedAssets: [
        { assetId: '00000000-0000-4000-8000-000000000002', name: 'B' },
        { assetId: '00000000-0000-4000-8000-000000000001', name: 'A' },
      ],
    };
    const snapshot = buildFindingReviewSnapshot(input);
    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.affectedAssets.map((asset) => asset.name)).toEqual(['A', 'B']);
    expect(snapshotHash(snapshot)).toBe(snapshotHash(buildFindingReviewSnapshot(input)));
    expect(snapshotHash(snapshot)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fingerprints operation, provisional actor and the exact validated key without exposing it', () => {
    const key = normalizeIdempotencyKey('review:123e4567-e89b-12d3-a456-426614174000');
    const fingerprint = creationRequestFingerprint(TEST_ACTOR_ID, key);
    const expectedSerialization =
      '{"actorId":"human:oidc:test:actor","idempotencyKey":"review:123e4567-e89b-12d3-a456-426614174000","operation":"CREATE_FINDING_REVIEW_CASE"}';
    const expectedFingerprint = '4d0f8fcfb4a161c0ec354c0a9c5fd20e1b8905009902a0490df821fa1e9821b3';
    expect(key).toBe('review:123e4567-e89b-12d3-a456-426614174000');
    expect(
      canonicalSerialize({
        operation: 'CREATE_FINDING_REVIEW_CASE',
        actorId: TEST_ACTOR_ID,
        idempotencyKey: key,
      }),
    ).toBe(expectedSerialization);
    expect(sha256(expectedSerialization)).toBe(expectedFingerprint);
    expect(fingerprint).toBe(expectedFingerprint);
    expect(fingerprint).not.toContain(key);
    expect(creationRequestFingerprint(TEST_ACTOR_ID, key)).toBe(fingerprint);
  });

  it('keeps idempotency keys case-sensitive', () => {
    expect(normalizeIdempotencyKey('123e4567-e89b-12d3-a456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
    expect(normalizeIdempotencyKey('AtlasReview123')).toBe('AtlasReview123');
    expect(normalizeIdempotencyKey('ABC')).toBe('ABC');
    expect(normalizeIdempotencyKey('abc')).toBe('abc');
    expect(creationRequestFingerprint(TEST_ACTOR_ID, 'ABC')).not.toBe(
      creationRequestFingerprint(TEST_ACTOR_ID, 'abc'),
    );
  });

  it.each([
    undefined,
    null,
    123,
    ['key'],
    '',
    ' ',
    ' key',
    'key ',
    'key with space',
    '\t',
    '\r',
    '\n',
    '\u0000',
    'key\u0007control',
    'é',
    `e\u0301`,
    '😀',
    'key,other',
  ])('rejects an absent or non-ASCII idempotency key: %p', (value) => {
    expect(() => normalizeIdempotencyKey(value)).toThrow(/obrigatório|vazio|não permitidos/);
  });

  it('rejects an oversized idempotency key', () => {
    expect(() => normalizeIdempotencyKey(undefined)).toThrow('obrigatório');
    expect(normalizeIdempotencyKey('x'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH))).toHaveLength(
      MAX_IDEMPOTENCY_KEY_LENGTH,
    );
    expect(() => normalizeIdempotencyKey('x'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1))).toThrow(
      'no máximo',
    );
  });

  it.each([
    'A',
    'a',
    '0',
    '123e4567-e89b-12d3-a456-426614174000',
    'ABC',
    'abc',
    '._~:+/=-',
    'Abc123._~:+/=-',
  ])('preserves an allowed opaque idempotency key exactly: %s', (value) => {
    expect(normalizeIdempotencyKey(value)).toBe(value);
  });

  it('keeps the feature disabled by default and validates explicit values', () => {
    expect(parseFindingReviewCasesEnabled(undefined)).toBe(false);
    expect(parseFindingReviewCasesEnabled('false')).toBe(false);
    expect(parseFindingReviewCasesEnabled(' TRUE ')).toBe(true);
    expect(() => parseFindingReviewCasesEnabled('yes')).toThrow('true ou false');
  });
});

describe('POST /conflict-review-cases (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let auth: TestAuthHarness;
  let api: ReturnType<typeof request.agent>;
  let prisma: FaultInjectingPrismaService;
  let receivedIdempotencyHeader: string | string[] | undefined;
  const testRunId = randomUUID();
  const assetIds: string[] = [];
  const caseIds = new Set<string>();
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

    auth = await startTestAuthHarness();
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useClass(FaultInjectingPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.use(
      (
        request: { headers: Record<string, string | string[] | undefined> },
        _response: unknown,
        next: () => void,
      ) => {
        receivedIdempotencyHeader = request.headers['idempotency-key'];
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    api = await auth.createAuthenticatedAgent(app);
    prisma = app.get<FaultInjectingPrismaService>(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      const trackedCases = [
        ...new Set([
          ...caseIds,
          ...(
            await prisma.findingReviewCase.findMany({
              where: {
                findingId: { startsWith: 'finding_' },
                assets: { some: { assetId: { in: assetIds } } },
              },
              select: { id: true },
            })
          ).map((item) => item.id),
        ]),
      ];
      await prisma.auditLog.deleteMany({
        where: { entityType: 'FindingReviewCase', entityId: { in: trackedCases } },
      });
      await prisma.findingReviewEvent.deleteMany({ where: { caseId: { in: trackedCases } } });
      await prisma.findingReviewCaseAsset.deleteMany({ where: { caseId: { in: trackedCases } } });
      await prisma.findingReviewCase.deleteMany({ where: { id: { in: trackedCases } } });
      await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    }
    if (previousFlag === undefined) delete process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
    else process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = previousFlag;
    if (app) await app.close();
    if (auth) await auth.close();
  });

  async function createDuplicateHostnameFindingFixture(label: string): Promise<{
    findingId: string;
    hostname: string;
    firstAssetId: string;
    secondAssetId: string;
  }> {
    const hostname = `pr18-${label}-${testRunId.slice(0, 8)}`.toLowerCase();
    const firstId = randomUUID();
    const secondId = randomUUID();
    assetIds.push(firstId, secondId);
    await prisma.asset.createMany({
      data: [
        {
          id: firstId,
          canonicalKey: `pr18:${label}:a:${testRunId}`,
          name: hostname,
          kind: 'SERVER',
        },
        {
          id: secondId,
          canonicalKey: `pr18:${label}:b:${testRunId}`,
          name: hostname,
          kind: 'SERVER',
        },
      ],
    });
    const response = await api
      .get('/conflict-analysis/findings')
      .query({ hostname, pageSize: 100 })
      .expect(200);
    const items = responseBody<{ items: Array<{ findingId: string; type: string }> }>(
      response,
    ).items;
    const match = items.find((item) => item.type === 'DUPLICATE_HOSTNAME_ACROSS_ASSETS');
    if (!match) throw new Error(`Fixture ${label} did not produce a finding.`);
    return { findingId: match.findingId, hostname, firstAssetId: firstId, secondAssetId: secondId };
  }

  async function createDuplicateHostnameFinding(label: string): Promise<string> {
    return (await createDuplicateHostnameFindingFixture(label)).findingId;
  }

  async function postCase(findingId: string, key: string) {
    const response = await api
      .post('/conflict-review-cases')
      .set('Idempotency-Key', key)
      .send({ findingId });
    const body = responseBody<Partial<CaseResponseBody>>(response);
    if (body.id) caseIds.add(body.id);
    return response;
  }

  async function reviewPersistenceCounts() {
    const [cases, relations, events, audits] = await Promise.all([
      prisma.findingReviewCase.count(),
      prisma.findingReviewCaseAsset.count(),
      prisma.findingReviewEvent.count(),
      prisma.auditLog.count({ where: { entityType: 'FindingReviewCase' } }),
    ]);
    return { cases, relations, events, audits };
  }

  it('keeps the endpoint disabled by default/configuration and writes nothing', async () => {
    const findingId = await createDuplicateHostnameFinding('disabled');
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    const before = await prisma.findingReviewCase.count();
    const response = await postCase(findingId, `disabled-${testRunId}`);
    const body = responseBody<ErrorResponseBody>(response);
    expect(response.status).toBe(503);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'FINDING_REVIEW_CASES_DISABLED',
        message: expect.stringContaining('desabilitada'),
      }),
    );
    expect(await prisma.findingReviewCase.count()).toBe(before);

    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'enabled';
    const invalidConfiguration = await postCase(findingId, `invalid-config-${testRunId}`);
    expect(invalidConfiguration.status).toBe(503);
    expect(responseBody<ErrorResponseBody>(invalidConfiguration).code).toBe(
      'FINDING_REVIEW_CASES_CONFIGURATION_INVALID',
    );
    expect(await prisma.findingReviewCase.count()).toBe(before);
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
  });

  it.each([
    [{}, 'valid-key'],
    [{ findingId: 'not-a-finding' }, 'valid-key'],
    [{ findingId: 'finding_0123456789abcdef01234567', unknown: true }, 'valid-key'],
    [
      {
        findingId: 'finding_0123456789abcdef01234567',
        createdBy: 'spoofed',
        actorId: 'spoofed',
        roles: ['admin'],
        permissions: ['atlas:access'],
      },
      'valid-key',
    ],
    [{ findingId: 'finding_0123456789abcdef01234567' }, ''],
  ])('rejects an invalid body or header without internal details', async (body, key) => {
    const call = api.post('/conflict-review-cases').send(body);
    if (key) call.set('Idempotency-Key', key);
    const response = await call.expect(400);
    expect(JSON.stringify(response.body)).not.toMatch(/Prisma|SQL|stack/i);
  });

  it('recognizes the header name case-insensitively and preserves its value', async () => {
    const findingId = await createDuplicateHostnameFinding('header-name-case');
    const key = `Header-Case-${testRunId}`;
    const created = await api
      .post('/conflict-review-cases')
      .set('iDeMpOtEnCy-KeY', key)
      .send({ findingId });
    const createdBody = responseBody<CaseResponseBody>(created);
    expect(created.status).toBe(201);
    expect(receivedIdempotencyHeader).toBe(key);

    const replay = await api
      .post('/conflict-review-cases')
      .set('IDEMPOTENCY-KEY', key)
      .send({ findingId });
    expect(replay.status).toBe(200);
    expect(responseBody<CaseResponseBody>(replay).id).toBe(createdBody.id);
    expect(receivedIdempotencyHeader).toBe(key);
  });

  it('rejects a missing Idempotency-Key with a stable safe error and no writes', async () => {
    const persistenceBefore = await reviewPersistenceCounts();
    const response = await api
      .post('/conflict-review-cases')
      .send({ findingId: 'finding_0123456789abcdef01234567' });
    const body = responseBody<ErrorResponseBody>(response);
    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(body.message).toBe('Idempotency-Key é obrigatório.');
    expect(JSON.stringify(body)).not.toMatch(/Prisma|SQL|stack|0123456789abcdef/i);
    expect(await reviewPersistenceCounts()).toEqual(persistenceBefore);
  });

  it('rejects duplicated Idempotency-Key headers after Node combines their values', async () => {
    const persistenceBefore = await reviewPersistenceCounts();
    receivedIdempotencyHeader = undefined;
    const response = await api
      .post('/conflict-review-cases')
      .set('Idempotency-Key', ['duplicate-a', 'duplicate-b'] as unknown as string)
      .send({ findingId: 'finding_0123456789abcdef01234567' });
    const body = responseBody<ErrorResponseBody>(response);
    expect(receivedIdempotencyHeader).toBe('duplicate-a, duplicate-b');
    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(body.message).toBe('Idempotency-Key contém caracteres não permitidos.');
    expect(JSON.stringify(body)).not.toMatch(/duplicate-a|duplicate-b|Prisma|SQL|stack/i);
    expect(await reviewPersistenceCounts()).toEqual(persistenceBefore);
  });

  it('treats different value casing as a different key instead of a replay', async () => {
    const findingId = await createDuplicateHostnameFinding('header-value-case');
    const upperKey = `VALUE-CASE-${testRunId}`;
    const lowerKey = upperKey.toLowerCase();
    const created = await postCase(findingId, upperKey);
    const response = await postCase(findingId, lowerKey);
    expect(created.status).toBe(201);
    expect(response.status).toBe(409);
    expect(responseBody<ErrorResponseBody>(response).code).toBe('ACTIVE_REVIEW_CASE_EXISTS');
    expect(creationRequestFingerprint(auth.actor.id, upperKey)).not.toBe(
      creationRequestFingerprint(auth.actor.id, lowerKey),
    );
  });

  it('returns a controlled 404 when the recalculated finding no longer exists', async () => {
    const response = await postCase('finding_0123456789abcdef01234567', `missing-${testRunId}`);
    const body = responseBody<ErrorResponseBody>(response);
    expect(response.status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'FINDING_NOT_FOUND',
        message: expect.stringContaining('não existe'),
      }),
    );
  });

  it('creates the case, all asset relations, initial event and AuditLog atomically', async () => {
    const findingId = await createDuplicateHostnameFinding('success');
    const inventoryBefore = await inventoryCounts();
    const auditBefore = await prisma.auditLog.count();
    const response = await postCase(findingId, `success-${testRunId}`);
    const body = responseBody<CaseResponseBody>(response);
    expect(response.status).toBe(201);
    expect(body).toEqual(
      expect.objectContaining({
        findingId,
        findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        policyVersion: '2026-07-conflict-v1',
        status: 'OPEN',
        staleness: 'CURRENT',
        version: 1,
        createdBy: auth.actor.id,
        idempotentReplay: false,
      }),
    );
    expect(body.affectedAssets).toHaveLength(2);

    const stored = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: body.id },
      include: { assets: true, events: true },
    });
    expect(stored.creationRequestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.originalSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.originalSnapshotHash).toBe(snapshotHash(stored.originalSnapshot as never));
    expect(stored.assets).toHaveLength(2);
    expect(stored.events).toEqual([
      expect.objectContaining({
        eventType: 'CASE_CREATED',
        versionBefore: null,
        versionAfter: 1,
        actorId: auth.actor.id,
      }),
    ]);
    expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
    expect(await inventoryCounts()).toEqual(inventoryBefore);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'FindingReviewCase', entityId: stored.id },
    });
    const serializedAudit = JSON.stringify(audit);
    expect(audit).toEqual(expect.objectContaining({ actorType: 'USER', actorId: auth.actor.id }));
    expect(serializedAudit).toContain('requestFingerprint');
    expect(serializedAudit).not.toContain(`success-${testRunId}`);
    expect(serializedAudit).not.toContain('originalSnapshot');
  });

  it('returns the same case on replay and creates no additional event or AuditLog', async () => {
    const findingId = await createDuplicateHostnameFinding('replay');
    const key = `replay-${testRunId}`;
    const created = await postCase(findingId, key);
    const createdBody = responseBody<CaseResponseBody>(created);
    const auditBefore = await prisma.auditLog.count({ where: { entityId: createdBody.id } });
    const replayed = await postCase(findingId, key);
    const replayedBody = responseBody<CaseResponseBody>(replayed);
    expect(created.status).toBe(201);
    expect(replayed.status).toBe(200);
    expect(replayedBody.id).toBe(createdBody.id);
    expect(replayedBody.idempotentReplay).toBe(true);
    expect(await prisma.findingReviewEvent.count({ where: { caseId: createdBody.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: createdBody.id } })).toBe(auditBefore);
  });

  it('never replays another actor response when the Idempotency-Key is reused cross-actor', async () => {
    const findingId = await createDuplicateHostnameFinding('cross-actor');
    const key = `cross-actor-${testRunId}`;
    const created = await postCase(findingId, key);
    expect(created.status).toBe(201);
    const original = responseBody<CaseResponseBody>(created);
    const before = await reviewPersistenceCounts();

    const actorB = await auth.createAuthenticatedAgent(
      app,
      await auth.issueToken({ subject: 'atlas-test-user-b', name: 'Atlas Test User B' }),
    );
    const response = await actorB
      .post('/conflict-review-cases')
      .set('Idempotency-Key', key)
      .send({ findingId });

    expect(response.status).toBe(409);
    expect(responseBody<ErrorResponseBody>(response)).toEqual(
      expect.objectContaining({
        code: 'ACTIVE_REVIEW_CASE_EXISTS',
        existingCaseId: original.id,
      }),
    );
    expect(await reviewPersistenceCounts()).toEqual(before);
    expect(creationRequestFingerprint(auth.actor.id, key)).not.toBe(
      creationRequestFingerprint(oidcActorId('HUMAN', auth.issuer, 'atlas-test-user-b'), key),
    );
  });

  it('replays the original case after the finding is no longer detected', async () => {
    const fixture = await createDuplicateHostnameFindingFixture('replay-missing-finding');
    const key = `replay-missing-finding-${testRunId}`;
    const created = await postCase(fixture.findingId, key);
    const createdBody = responseBody<CaseResponseBody>(created);
    expect(created.status).toBe(201);

    await prisma.asset.update({
      where: { id: fixture.secondAssetId },
      data: { name: `${fixture.hostname}-renamed` },
    });
    const findingsAfterChange = await api
      .get('/conflict-analysis/findings')
      .query({ hostname: fixture.hostname, pageSize: 100 })
      .expect(200);
    expect(
      responseBody<{ items: Array<{ findingId: string }> }>(findingsAfterChange).items.some(
        (item) => item.findingId === fixture.findingId,
      ),
    ).toBe(false);

    const persistenceBefore = await reviewPersistenceCounts();
    const inventoryBefore = await inventoryCounts();
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: createdBody.id },
      select: { updatedAt: true, originalSnapshot: true, originalSnapshotHash: true },
    });
    const changedAssetBefore = await prisma.asset.findUniqueOrThrow({
      where: { id: fixture.secondAssetId },
      select: { name: true, updatedAt: true },
    });

    const replayed = await postCase(fixture.findingId, key);
    const replayedBody = responseBody<CaseResponseBody>(replayed);
    expect(replayed.status).toBe(200);
    expect(replayedBody.id).toBe(createdBody.id);
    expect(replayedBody.idempotentReplay).toBe(true);
    expect(await reviewPersistenceCounts()).toEqual(persistenceBefore);
    expect(await inventoryCounts()).toEqual(inventoryBefore);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({
        where: { id: createdBody.id },
        select: { updatedAt: true, originalSnapshot: true, originalSnapshotHash: true },
      }),
    ).toEqual(caseBefore);
    expect(
      await prisma.asset.findUniqueOrThrow({
        where: { id: fixture.secondAssetId },
        select: { name: true, updatedAt: true },
      }),
    ).toEqual(changedAssetBefore);
  });

  it('blocks replay while the feature flag is disabled and restores it without writes', async () => {
    const findingId = await createDuplicateHostnameFinding('replay-disabled');
    const key = `replay-disabled-${testRunId}`;
    const created = await postCase(findingId, key);
    const createdBody = responseBody<CaseResponseBody>(created);
    expect(created.status).toBe(201);
    const persistenceBefore = await reviewPersistenceCounts();
    const inventoryBefore = await inventoryCounts();

    let disabledReplay: Awaited<ReturnType<typeof postCase>>;
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    try {
      disabledReplay = await postCase(findingId, key);
    } finally {
      process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    }

    expect(disabledReplay.status).toBe(503);
    expect(responseBody<ErrorResponseBody>(disabledReplay).code).toBe(
      'FINDING_REVIEW_CASES_DISABLED',
    );
    expect(await reviewPersistenceCounts()).toEqual(persistenceBefore);
    expect(await inventoryCounts()).toEqual(inventoryBefore);

    const enabledReplay = await postCase(findingId, key);
    expect(enabledReplay.status).toBe(200);
    expect(responseBody<CaseResponseBody>(enabledReplay).id).toBe(createdBody.id);
    expect(await reviewPersistenceCounts()).toEqual(persistenceBefore);
  });

  async function expectDatabaseRollback(step: TransactionFailureStep, label: string) {
    const findingId = await createDuplicateHostnameFinding(label);
    const key = `${label}-${testRunId}`;
    const persistenceBefore = await reviewPersistenceCounts();
    const inventoryBefore = await inventoryCounts();

    prisma.failNextTransactionAt(step);
    let failed: Awaited<ReturnType<typeof postCase>>;
    try {
      failed = await postCase(findingId, key);
    } finally {
      prisma.clearTransactionFailure();
    }

    expect(failed.status).toBe(500);
    expect(await reviewPersistenceCounts()).toEqual(persistenceBefore);
    expect(await inventoryCounts()).toEqual(inventoryBefore);

    const retry = await postCase(findingId, key);
    const retryBody = responseBody<CaseResponseBody>(retry);
    expect(retry.status).toBe(201);
    expect(retryBody.idempotentReplay).toBe(false);
    expect(await prisma.findingReviewCaseAsset.count({ where: { caseId: retryBody.id } })).toBe(2);
    expect(await prisma.findingReviewEvent.count({ where: { caseId: retryBody.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: retryBody.id } })).toBe(1);
  }

  it('rolls back the PostgreSQL transaction when an asset relation fails', async () => {
    await expectDatabaseRollback('relations', 'rollback-relations');
  });

  it('rolls back the PostgreSQL transaction when the case event fails', async () => {
    await expectDatabaseRollback('event', 'rollback-event');
  });

  it('rolls back the PostgreSQL transaction when the AuditLog fails', async () => {
    await expectDatabaseRollback('audit', 'rollback-audit');
  });

  it('rejects reuse of the same key with another semantic payload', async () => {
    const firstFinding = await createDuplicateHostnameFinding('payload-a');
    const secondFinding = await createDuplicateHostnameFinding('payload-b');
    const key = `payload-conflict-${testRunId}`;
    const created = await postCase(firstFinding, key);
    const auditBefore = await prisma.auditLog.count();
    const response = await postCase(secondFinding, key);
    const body = responseBody<ErrorResponseBody>(response);
    expect(created.status).toBe(201);
    expect(response.status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.auditLog.count()).toBe(auditBefore);
  });

  it('rejects another request for an already active subject', async () => {
    const findingId = await createDuplicateHostnameFinding('active');
    const created = await postCase(findingId, `active-a-${testRunId}`);
    const response = await postCase(findingId, `active-b-${testRunId}`);
    const createdBody = responseBody<CaseResponseBody>(created);
    const body = responseBody<ErrorResponseBody>(response);
    expect(created.status).toBe(201);
    expect(response.status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'ACTIVE_REVIEW_CASE_EXISTS',
        existingCaseId: createdBody.id,
      }),
    );
  });

  it('lets PostgreSQL arbitrate concurrent requests for the same subject with different keys', async () => {
    const findingId = await createDuplicateHostnameFinding('race-subject');
    const [first, second] = await Promise.all([
      postCase(findingId, `race-subject-a-${testRunId}`),
      postCase(findingId, `race-subject-b-${testRunId}`),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const created = first.status === 201 ? first : second;
    const createdBody = responseBody<CaseResponseBody>(created);
    expect(
      await prisma.findingReviewCase.count({
        where: { reviewSubjectKey: createdBody.reviewSubjectKey },
      }),
    ).toBe(1);
    expect(await prisma.findingReviewEvent.count({ where: { caseId: createdBody.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: createdBody.id } })).toBe(1);
  });

  it('deduplicates concurrent requests with the same key and payload', async () => {
    const findingId = await createDuplicateHostnameFinding('race-replay');
    const key = `race-replay-${testRunId}`;
    const [first, second] = await Promise.all([postCase(findingId, key), postCase(findingId, key)]);
    const firstBody = responseBody<CaseResponseBody>(first);
    const secondBody = responseBody<CaseResponseBody>(second);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(firstBody.id).toBe(secondBody.id);
    expect(await prisma.findingReviewEvent.count({ where: { caseId: firstBody.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: firstBody.id } })).toBe(1);
  });

  it('rejects concurrent reuse of the same key with different payloads without extra writes', async () => {
    const firstFinding = await createDuplicateHostnameFinding('race-payload-a');
    const secondFinding = await createDuplicateHostnameFinding('race-payload-b');
    const key = `race-payload-${testRunId}`;
    const auditBefore = await prisma.auditLog.count();
    const [first, second] = await Promise.all([
      postCase(firstFinding, key),
      postCase(secondFinding, key),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const created = first.status === 201 ? first : second;
    const createdBody = responseBody<CaseResponseBody>(created);
    expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
    expect(await prisma.findingReviewEvent.count({ where: { caseId: createdBody.id } })).toBe(1);
  });

  it.each([
    ['patch', '/conflict-review-cases'],
    ['patch', `/conflict-review-cases/${randomUUID()}`],
    ['put', `/conflict-review-cases/${randomUUID()}`],
    ['delete', `/conflict-review-cases/${randomUUID()}`],
    ['post', `/conflict-review-cases/${randomUUID()}`],
  ] as const)('does not expose out-of-scope %s endpoint', async (method, path) => {
    await api[method](path).expect(404);
  });

  async function inventoryCounts() {
    const [assets, attributes, interfaces, evidence, conflicts, conflictValues, events] =
      await Promise.all([
        prisma.asset.count(),
        prisma.assetAttribute.count(),
        prisma.networkInterface.count(),
        prisma.assetEvidence.count(),
        prisma.conflict.count(),
        prisma.conflictValue.count(),
        prisma.assetEvent.count(),
      ]);
    return { assets, attributes, interfaces, evidence, conflicts, conflictValues, events };
  }
});
