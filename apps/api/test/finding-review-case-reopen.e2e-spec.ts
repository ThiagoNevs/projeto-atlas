import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { startTestAuthHarness, type TestAuthHarness } from './auth-test-harness';
import { ConflictFindingsService } from '../src/conflict-analysis/conflict-findings.service';
import { CreateFindingReviewCaseReopenDto } from '../src/finding-review-cases/dto/create-finding-review-case-reopen.dto';
import {
  FINDING_REVIEW_CASE_REOPENED_EVENT,
  MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH,
  reopenRequestFingerprint,
} from '../src/finding-review-cases/finding-review-case-reopen';
import { FINDING_REVIEW_CASE_RESOLVED_EVENT } from '../src/finding-review-cases/finding-review-case-resolution';
import { reviewSubjectKey, sha256 } from '../src/finding-review-cases/finding-review-case-creation';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import {
  FindingReviewCaseStatus,
  FindingReviewIdentityConclusion,
  FindingReviewStaleness,
  type Prisma,
} from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_ACTOR_ID = 'human:oidc:test:actor';

type FailureStep = 'event' | 'audit';
type UnknownFunction = (...args: unknown[]) => unknown;
type ProtectedDelegate =
  | 'asset'
  | 'assetAttribute'
  | 'networkInterface'
  | 'assetEvidence'
  | 'assetEvent'
  | 'conflict'
  | 'conflictValue';

const PROTECTED_DELEGATES = new Set<ProtectedDelegate>([
  'asset',
  'assetAttribute',
  'networkInterface',
  'assetEvidence',
  'assetEvent',
  'conflict',
  'conflictValue',
]);
const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

class ReopenTestPrismaService extends PrismaService {
  private failureStep: FailureStep | null = null;
  private inventoryWriteGuard = false;

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

  failNextTransactionAt(step: FailureStep): void {
    this.failureStep = step;
  }

  guardInventoryWrites(enabled: boolean): void {
    this.inventoryWriteGuard = enabled;
  }

  clearTestControls(): void {
    this.failureStep = null;
    this.inventoryWriteGuard = false;
  }

  private wrapTransaction(client: Prisma.TransactionClient): Prisma.TransactionClient {
    return new Proxy(client, {
      get: (target, property) => {
        const delegate = (target as unknown as Record<PropertyKey, unknown>)[property];
        const failureStep =
          property === 'findingReviewEvent' ? 'event' : property === 'auditLog' ? 'audit' : null;
        const protectedDelegate =
          typeof property === 'string' && PROTECTED_DELEGATES.has(property as ProtectedDelegate);
        if ((!failureStep && !protectedDelegate) || typeof delegate !== 'object' || !delegate) {
          return delegate;
        }
        return new Proxy(delegate, {
          get: (delegateTarget, method) => {
            const operation = (delegateTarget as Record<PropertyKey, unknown>)[method];
            if (typeof operation !== 'function') return operation;
            return (...args: unknown[]) => {
              if (this.failureStep === failureStep && method === 'create') {
                this.failureStep = null;
                throw new Error(`TEST_REOPEN_TRANSACTION_FAILURE:${failureStep}`);
              }
              if (
                this.inventoryWriteGuard &&
                protectedDelegate &&
                typeof method === 'string' &&
                WRITE_METHODS.has(method)
              ) {
                throw new Error(`TEST_REOPEN_INVENTORY_WRITE:${String(property)}.${method}`);
              }
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }
}

interface ReopenBody {
  idempotentReplay: boolean;
  reopen: {
    eventId: string;
    caseId: string;
    justification: string;
    versionBefore: number;
    versionAfter: number;
    previousStatus: FindingReviewCaseStatus;
    status: FindingReviewCaseStatus;
    reopenedBy: string;
    reopenedAt: string;
  };
}

interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
  existingCaseId?: string;
}

interface CaseFixture {
  caseId: string;
  decisionId: string;
  reviewSubjectKey: string;
  version: number;
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('Finding review reopen helpers and DTO', () => {
  it('keeps functional justification validation in the service', async () => {
    const justification = `  ${'x'.repeat(MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH + 1)}  `;
    const dto = plainToInstance(CreateFindingReviewCaseReopenDto, {
      expectedVersion: 3,
      justification,
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.justification).toBe(justification);
  });

  it('rejects invalid structural values', async () => {
    const dto = plainToInstance(CreateFindingReviewCaseReopenDto, {
      expectedVersion: 1.5,
      justification: 123,
    });
    expect((await validate(dto)).map((error) => error.property).sort()).toEqual([
      'expectedVersion',
      'justification',
    ]);
  });

  it('creates deterministic, case-sensitive and case-scoped fingerprints', () => {
    const firstCase = randomUUID();
    const secondCase = randomUUID();
    expect(reopenRequestFingerprint(TEST_ACTOR_ID, firstCase, 'reopen-ABC')).toBe(
      reopenRequestFingerprint(TEST_ACTOR_ID, firstCase, 'reopen-ABC'),
    );
    expect(reopenRequestFingerprint(TEST_ACTOR_ID, firstCase, 'reopen-ABC')).not.toBe(
      reopenRequestFingerprint(TEST_ACTOR_ID, firstCase, 'reopen-abc'),
    );
    expect(reopenRequestFingerprint(TEST_ACTOR_ID, firstCase, 'reopen-ABC')).not.toBe(
      reopenRequestFingerprint(TEST_ACTOR_ID, secondCase, 'reopen-ABC'),
    );
  });
});

describe('POST /conflict-review-cases/:id/reopens (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let auth: TestAuthHarness;
  let api: ReturnType<typeof request.agent>;
  let prisma: ReopenTestPrismaService;
  let findings: ConflictFindingsService;
  const testRunId = randomUUID();
  const caseIds = new Set<string>();
  const assetIds = new Set<string>();
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

    auth = await startTestAuthHarness();
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useClass(ReopenTestPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    api = await auth.createAuthenticatedAgent(app);
    prisma = app.get<ReopenTestPrismaService>(PrismaService);
    findings = app.get(ConflictFindingsService);
  });

  afterEach(() => {
    prisma.clearTestControls();
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
  });

  afterAll(async () => {
    if (prisma) {
      const trackedCases = [...caseIds];
      await prisma.auditLog.deleteMany({
        where: { entityType: 'FindingReviewCase', entityId: { in: trackedCases } },
      });
      await prisma.findingReviewDecision.deleteMany({ where: { caseId: { in: trackedCases } } });
      await prisma.findingReviewEvent.deleteMany({ where: { caseId: { in: trackedCases } } });
      await prisma.findingReviewCase.deleteMany({ where: { id: { in: trackedCases } } });
      await prisma.asset.deleteMany({ where: { id: { in: [...assetIds] } } });
    }
    if (previousFlag === undefined) delete process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
    else process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = previousFlag;
    if (app) await app.close();
    if (auth) await auth.close();
  });

  async function createCase(
    options: {
      status?: FindingReviewCaseStatus;
      version?: number;
      reviewSubjectKey?: string;
    } = {},
  ): Promise<CaseFixture> {
    const token = randomUUID();
    const caseId = randomUUID();
    const version = options.version ?? 3;
    const status = options.status ?? FindingReviewCaseStatus.RESOLVED;
    const reviewSubjectKey = options.reviewSubjectKey ?? sha256(`subject:${testRunId}:${token}`);
    const activeReviewSubjectKey = (
      [
        FindingReviewCaseStatus.OPEN,
        FindingReviewCaseStatus.IN_REVIEW,
        FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
      ] as FindingReviewCaseStatus[]
    ).includes(status)
      ? reviewSubjectKey
      : null;
    const relatedAssetIds = [randomUUID(), randomUUID()];
    const createdAt = new Date('2026-08-24T12:00:00.000Z');

    await prisma.asset.createMany({
      data: relatedAssetIds.map((id, index) => ({
        id,
        canonicalKey: `atlas-reopen-test:${testRunId}:${token}:${index}`,
        name: `REOPEN-${token.slice(0, 8)}-${index}`,
        kind: 'SERVER',
      })),
    });
    relatedAssetIds.forEach((id) => assetIds.add(id));

    await prisma.findingReviewCase.create({
      data: {
        id: caseId,
        findingId: `finding_${sha256(token).slice(0, 24)}`,
        findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        policyVersion: '2026-07-conflict-v1',
        reviewSubjectKey,
        activeReviewSubjectKey,
        creationRequestFingerprint: sha256(`request:${testRunId}:${token}`),
        status,
        staleness: FindingReviewStaleness.CURRENT,
        originalSnapshot: {
          snapshotVersion: 1,
          affectedAssets: relatedAssetIds.map((assetId) => ({ assetId, name: null })),
          reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
        },
        originalSnapshotHash: sha256(`snapshot:${testRunId}:${token}`),
        version,
        createdBy: auth.actor.id,
        findingGeneratedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        assets: {
          create: relatedAssetIds.map((assetId, index) => ({
            assetId,
            assetIdAtCreation: assetId,
            assetNameAtCreation: `REOPEN-${token.slice(0, 8)}-${index}`,
            role: 'AFFECTED_ASSET',
          })),
        },
        events: {
          create: [
            {
              eventType: 'CASE_CREATED',
              versionBefore: null,
              versionAfter: 1,
              actorId: auth.actor.id,
              nextStatus: FindingReviewCaseStatus.OPEN,
              after: { status: FindingReviewCaseStatus.OPEN, version: 1 },
              occurredAt: createdAt,
              createdAt,
            },
            ...(status === FindingReviewCaseStatus.RESOLVED
              ? [
                  {
                    eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
                    versionBefore: version - 1,
                    versionAfter: version,
                    actorId: auth.actor.id,
                    previousStatus: FindingReviewCaseStatus.IN_REVIEW,
                    nextStatus: FindingReviewCaseStatus.RESOLVED,
                    before: { status: FindingReviewCaseStatus.IN_REVIEW, version: version - 1 },
                    after: { status: FindingReviewCaseStatus.RESOLVED, version },
                    metadata: { justification: 'Resolução histórica da fixture.' },
                    occurredAt: createdAt,
                    createdAt,
                  },
                ]
              : []),
          ],
        },
      },
    });
    caseIds.add(caseId);

    const decision = await prisma.findingReviewDecision.create({
      data: {
        caseId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Decisão de identidade histórica preservada.',
        caseVersion: Math.max(1, version - 1),
        createdBy: auth.actor.id,
        requestFingerprint: sha256(`decision:${testRunId}:${token}`),
        createdAt,
      },
    });

    return { caseId, decisionId: decision.id, reviewSubjectKey, version };
  }

  async function createDuplicateHostnameFindingForSubject(): Promise<{
    findingId: string;
    reviewSubjectKey: string;
  }> {
    const token = randomUUID();
    const hostname = `reopen-create-race-${token}`.toLowerCase();
    const relatedAssetIds = [randomUUID(), randomUUID()];
    await prisma.asset.createMany({
      data: relatedAssetIds.map((id, index) => ({
        id,
        canonicalKey: `atlas-reopen-create-race:${testRunId}:${token}:${index}`,
        name: hostname,
        kind: 'SERVER',
      })),
    });
    relatedAssetIds.forEach((id) => assetIds.add(id));

    const response = await api
      .get('/conflict-analysis/findings')
      .query({ hostname, pageSize: 100 })
      .expect(200);
    const items = responseBody<{
      items: Array<{ findingId: string; type: string }>;
    }>(response).items;
    const match = items.find((item) => item.type === 'DUPLICATE_HOSTNAME_ACROSS_ASSETS');
    if (!match) throw new Error('A fixture concorrente não produziu o finding esperado.');

    const current = await findings.findCurrentById(match.findingId);
    if (!current) throw new Error('O finding concorrente deixou de existir durante a fixture.');
    return {
      findingId: match.findingId,
      reviewSubjectKey: reviewSubjectKey(current.finding),
    };
  }

  function postReopen(caseId: string, key: string | undefined, payload: Record<string, unknown>) {
    const call = api.post(`/conflict-review-cases/${caseId}/reopens`).send(payload);
    return key === undefined ? call : call.set('Idempotency-Key', key);
  }

  function postResolution(caseId: string, key: string, expectedVersion: number) {
    return api
      .post(`/conflict-review-cases/${caseId}/resolutions`)
      .set('Idempotency-Key', key)
      .send({ expectedVersion, justification: 'Nova conclusão após a reabertura.' });
  }

  function postCaseCreation(findingId: string, key: string) {
    return api.post('/conflict-review-cases').set('Idempotency-Key', key).send({ findingId });
  }

  function validPayload(
    expectedVersion = 3,
    justification = 'Novas evidências exigem reavaliação.',
  ): Record<string, unknown> {
    return { expectedVersion, justification };
  }

  async function reopenEffects(caseId: string) {
    return {
      events: await prisma.findingReviewEvent.count({
        where: { caseId, eventType: FINDING_REVIEW_CASE_REOPENED_EVENT },
      }),
      audits: await prisma.auditLog.count({
        where: {
          entityType: 'FindingReviewCase',
          entityId: caseId,
          action: FINDING_REVIEW_CASE_REOPENED_EVENT,
        },
      }),
    };
  }

  async function inventorySnapshot(): Promise<string> {
    const [assets, attributes, interfaces, evidence, events, conflicts, values] = await Promise.all(
      [
        prisma.asset.findMany({ orderBy: { id: 'asc' } }),
        prisma.assetAttribute.findMany({ orderBy: { id: 'asc' } }),
        prisma.networkInterface.findMany({ orderBy: { id: 'asc' } }),
        prisma.assetEvidence.findMany({ orderBy: { id: 'asc' } }),
        prisma.assetEvent.findMany({ orderBy: { id: 'asc' } }),
        prisma.conflict.findMany({ orderBy: { id: 'asc' } }),
        prisma.conflictValue.findMany({ orderBy: { id: 'asc' } }),
      ],
    );
    return JSON.stringify({ assets, attributes, interfaces, evidence, events, conflicts, values });
  }

  it('reopens RESOLVED to IN_REVIEW and preserves decision/history/inventory', async () => {
    const fixture = await createCase();
    const rawKey = 'SUPER-SECRET-RAW-REOPEN-KEY-123';
    const inventoryBefore = await inventorySnapshot();
    const decisionBefore = await prisma.findingReviewDecision.findMany({
      where: { caseId: fixture.caseId },
      orderBy: { caseVersion: 'asc' },
    });
    prisma.guardInventoryWrites(true);
    const response = await postReopen(
      fixture.caseId,
      rawKey,
      validPayload(fixture.version, '  Linha um.\nLinha  dois.  '),
    );
    prisma.guardInventoryWrites(false);
    const body = responseBody<ReopenBody>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({
      idempotentReplay: false,
      reopen: expect.objectContaining({
        caseId: fixture.caseId,
        justification: 'Linha um.\nLinha  dois.',
        versionBefore: fixture.version,
        versionAfter: fixture.version + 1,
        previousStatus: FindingReviewCaseStatus.RESOLVED,
        status: FindingReviewCaseStatus.IN_REVIEW,
        reopenedBy: auth.actor.id,
      }),
    });
    expect(new Date(body.reopen.reopenedAt).toISOString()).toBe(body.reopen.reopenedAt);

    const persisted = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    expect(persisted).toEqual(
      expect.objectContaining({
        status: FindingReviewCaseStatus.IN_REVIEW,
        version: fixture.version + 1,
        activeReviewSubjectKey: fixture.reviewSubjectKey,
      }),
    );
    expect(
      await prisma.findingReviewDecision.findMany({
        where: { caseId: fixture.caseId },
        orderBy: { caseVersion: 'asc' },
      }),
    ).toEqual(decisionBefore);
    expect(
      await prisma.findingReviewEvent.count({
        where: { caseId: fixture.caseId, eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT },
      }),
    ).toBe(1);
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
    expect(await inventorySnapshot()).toBe(inventoryBefore);

    const event = await prisma.findingReviewEvent.findUniqueOrThrow({
      where: {
        caseId_requestId: {
          caseId: fixture.caseId,
          requestId: reopenRequestFingerprint(auth.actor.id, fixture.caseId, rawKey),
        },
      },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: fixture.caseId, action: FINDING_REVIEW_CASE_REOPENED_EVENT },
    });
    expect(event).toEqual(
      expect.objectContaining({
        id: body.reopen.eventId,
        versionBefore: fixture.version,
        versionAfter: fixture.version + 1,
        previousStatus: FindingReviewCaseStatus.RESOLVED,
        nextStatus: FindingReviewCaseStatus.IN_REVIEW,
        metadata: { justification: 'Linha um.\nLinha  dois.' },
      }),
    );
    expect(audit).toEqual(
      expect.objectContaining({
        action: FINDING_REVIEW_CASE_REOPENED_EVENT,
        entityType: 'FindingReviewCase',
        entityId: fixture.caseId,
        before: { status: FindingReviewCaseStatus.RESOLVED, version: fixture.version },
        after: { status: FindingReviewCaseStatus.IN_REVIEW, version: fixture.version + 1 },
      }),
    );
    expect(JSON.stringify([event.metadata, audit.metadata, response.body])).not.toContain(rawKey);
    expect(JSON.stringify(response.body)).not.toMatch(
      /requestId|requestFingerprint|Idempotency-Key/,
    );
  });

  it('keeps currentDecision and decisionHistory in the public detail after reopen', async () => {
    const fixture = await createCase();
    await postReopen(
      fixture.caseId,
      `detail-reopen-${randomUUID()}`,
      validPayload(fixture.version),
    ).expect(201);
    const detail = await api.get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    const body = responseBody<{
      status: FindingReviewCaseStatus;
      version: number;
      currentDecision: { id: string };
      decisionHistory: Array<{ id: string }>;
      events: Array<{ eventType: string; metadata: unknown }>;
    }>(detail);
    expect(body.status).toBe(FindingReviewCaseStatus.IN_REVIEW);
    expect(body.version).toBe(fixture.version + 1);
    expect(body.currentDecision.id).toBe(fixture.decisionId);
    expect(body.decisionHistory).toHaveLength(1);
    expect(body.decisionHistory[0]).toEqual(expect.objectContaining({ id: fixture.decisionId }));
    expect(body.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        FINDING_REVIEW_CASE_RESOLVED_EVENT,
        FINDING_REVIEW_CASE_REOPENED_EVENT,
      ]),
    );
    expect(JSON.stringify(body.events)).not.toMatch(/requestId|requestFingerprint/);
  });

  it.each([
    FindingReviewCaseStatus.OPEN,
    FindingReviewCaseStatus.IN_REVIEW,
    FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
    FindingReviewCaseStatus.DISMISSED,
    FindingReviewCaseStatus.CANCELLED,
  ])('rejects reopen from %s without side effects', async (status) => {
    const fixture = await createCase({ status });
    const before = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const response = await postReopen(
      fixture.caseId,
      `status-reopen-${randomUUID()}`,
      validPayload(fixture.version),
    );
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_CASE_REOPEN_NOT_ALLOWED');
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(before);
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
  });

  it.each([
    [undefined, 'FINDING_REVIEW_REOPEN_JUSTIFICATION_REQUIRED'],
    [' \n\t ', 'FINDING_REVIEW_REOPEN_JUSTIFICATION_REQUIRED'],
    [
      'x'.repeat(MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH + 1),
      'INVALID_FINDING_REVIEW_REOPEN_JUSTIFICATION',
    ],
  ])('rejects invalid justification %p with a controlled error', async (justification, code) => {
    const fixture = await createCase();
    const payload = validPayload(fixture.version);
    if (justification === undefined) delete payload.justification;
    else payload.justification = justification;
    const response = await postReopen(
      fixture.caseId,
      `justification-reopen-${randomUUID()}`,
      payload,
    );
    expect(response.status).toBe(400);
    expect(responseBody<ErrorBody>(response).code).toBe(code);
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
  });

  it('accepts exactly 1000 characters with internal newline', async () => {
    const fixture = await createCase();
    const justification = `  ${'x'.repeat(499)}\n${'y'.repeat(500)}  `;
    const response = await postReopen(
      fixture.caseId,
      `limit-reopen-${randomUUID()}`,
      validPayload(fixture.version, justification),
    );
    expect(response.status).toBe(201);
    expect(responseBody<ReopenBody>(response).reopen.justification).toBe(
      `${'x'.repeat(499)}\n${'y'.repeat(500)}`,
    );
  });

  it('gives stale version precedence over invalid functional justification', async () => {
    const fixture = await createCase({ version: 4 });
    const response = await postReopen(
      fixture.caseId,
      `precedence-reopen-${randomUUID()}`,
      validPayload(3, 'x'.repeat(MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH + 1)),
    );
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_CASE_VERSION_CONFLICT');
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
  });

  it('returns controlled errors for invalid ids, missing cases, bodies and keys', async () => {
    const invalidId = await postReopen('not-a-uuid', `invalid-${randomUUID()}`, validPayload());
    expect(invalidId.status).toBe(400);
    expect(responseBody<ErrorBody>(invalidId).code).toBe('INVALID_FINDING_REVIEW_CASE_ID');
    const missing = await postReopen(randomUUID(), `missing-${randomUUID()}`, validPayload());
    expect(missing.status).toBe(404);
    expect(responseBody<ErrorBody>(missing).code).toBe('FINDING_REVIEW_CASE_NOT_FOUND');

    const fixture = await createCase();
    expect((await postReopen(fixture.caseId, undefined, validPayload())).status).toBe(400);
    expect((await postReopen(fixture.caseId, 'chave inválida', validPayload())).status).toBe(400);
    await postReopen(fixture.caseId, `extra-${randomUUID()}`, {
      ...validPayload(),
      comment: 'campo não permitido',
    }).expect(400);
  });

  it('returns a stable replay before checking current state and without writes', async () => {
    const fixture = await createCase();
    const key = `replay-reopen-${randomUUID()}`;
    const created = await postReopen(
      fixture.caseId,
      key,
      validPayload(fixture.version, '  Justificativa original.  '),
    );
    const createdBody = responseBody<ReopenBody>(created);
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const effectsBefore = await reopenEffects(fixture.caseId);
    const replay = await postReopen(
      fixture.caseId,
      key,
      validPayload(fixture.version, '\nJustificativa original.\t'),
    );
    expect([created.status, replay.status]).toEqual([201, 200]);
    expect(responseBody<ReopenBody>(replay)).toEqual({
      idempotentReplay: true,
      reopen: createdBody.reopen,
    });
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(caseBefore);
    expect(await reopenEffects(fixture.caseId)).toEqual(effectsBefore);
  });

  it.each([
    ['justification', validPayload(3, 'Outro conteúdo.')],
    ['expectedVersion', validPayload(4)],
  ] as const)('rejects reuse of the same key with different %s', async (_label, reusedPayload) => {
    const fixture = await createCase();
    const key = `reuse-reopen-${randomUUID()}`;
    await postReopen(fixture.caseId, key, validPayload()).expect(201);
    const response = await postReopen(fixture.caseId, key, reusedPayload);
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('deduplicates concurrent equal requests', async () => {
    const fixture = await createCase();
    const key = `race-same-reopen-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postReopen(fixture.caseId, key, validPayload()),
      postReopen(fixture.caseId, key, validPayload()),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(responseBody<ReopenBody>(first).reopen.eventId).toBe(
      responseBody<ReopenBody>(second).reopen.eventId,
    );
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('rejects concurrent divergent payloads with the same key', async () => {
    const fixture = await createCase();
    const key = `race-reused-reopen-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postReopen(fixture.caseId, key, validPayload(3, 'Primeiro conteúdo.')),
      postReopen(fixture.caseId, key, validPayload(3, 'Segundo conteúdo.')),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(responseBody<ErrorBody>(rejected).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('allows only one different key to update the same version', async () => {
    const fixture = await createCase();
    const [first, second] = await Promise.all([
      postReopen(fixture.caseId, `race-a-${randomUUID()}`, validPayload()),
      postReopen(fixture.caseId, `race-b-${randomUUID()}`, validPayload()),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(responseBody<ErrorBody>(rejected).code).toBe('FINDING_REVIEW_CASE_VERSION_CONFLICT');
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('keeps reopen as the only command that can reactivate a RESOLVED case', async () => {
    const fixture = await createCase();
    const [reopen, genericTransition] = await Promise.all([
      postReopen(
        fixture.caseId,
        `race-generic-reopen-${randomUUID()}`,
        validPayload(fixture.version),
      ),
      api.patch(`/conflict-review-cases/${fixture.caseId}/status`).send({
        expectedVersion: fixture.version,
        status: FindingReviewCaseStatus.IN_REVIEW,
      }),
    ]);
    expect(reopen.status).toBe(201);
    expect([400, 409]).toContain(genericTransition.status);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(
      expect.objectContaining({
        status: FindingReviewCaseStatus.IN_REVIEW,
        version: fixture.version + 1,
      }),
    );
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('scopes the same Idempotency-Key independently by case', async () => {
    const first = await createCase();
    const second = await createCase();
    const key = `case-scoped-reopen-${randomUUID()}`;
    const [firstResponse, secondResponse] = await Promise.all([
      postReopen(first.caseId, key, validPayload(first.version)),
      postReopen(second.caseId, key, validPayload(second.version)),
    ]);
    expect([firstResponse.status, secondResponse.status]).toEqual([201, 201]);
    expect(await reopenEffects(first.caseId)).toEqual({ events: 1, audits: 1 });
    expect(await reopenEffects(second.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('rejects reopen while another case owns the active subject', async () => {
    const subject = sha256(`shared-subject:${testRunId}:${randomUUID()}`);
    const resolved = await createCase({ reviewSubjectKey: subject });
    const active = await createCase({
      status: FindingReviewCaseStatus.IN_REVIEW,
      reviewSubjectKey: subject,
    });
    const resolvedBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: resolved.caseId },
    });
    const activeBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: active.caseId },
    });
    const response = await postReopen(
      resolved.caseId,
      `active-subject-${randomUUID()}`,
      validPayload(resolved.version),
    );
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response)).toEqual(
      expect.objectContaining({
        code: 'ACTIVE_REVIEW_CASE_EXISTS',
        existingCaseId: active.caseId,
      }),
    );
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: resolved.caseId } }),
    ).toEqual(resolvedBefore);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: active.caseId } }),
    ).toEqual(activeBefore);
  });

  it('uses the database unique constraint for concurrent reopen and case creation', async () => {
    const finding = await createDuplicateHostnameFindingForSubject();
    const resolved = await createCase({ reviewSubjectKey: finding.reviewSubjectKey });
    const resolvedBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: resolved.caseId },
    });
    const creationEventsBefore = await prisma.findingReviewEvent.count({
      where: { eventType: 'CASE_CREATED' },
    });
    const creationAuditsBefore = await prisma.auditLog.count({
      where: { entityType: 'FindingReviewCase', action: 'CASE_CREATED' },
    });

    const [reopenResponse, createResponse] = await Promise.all([
      postReopen(
        resolved.caseId,
        `concurrent-subject-${randomUUID()}`,
        validPayload(resolved.version),
      ),
      postCaseCreation(finding.findingId, `concurrent-create-${randomUUID()}`),
    ]);

    expect([reopenResponse.status, createResponse.status].sort()).toEqual([201, 409]);
    if (reopenResponse.status === 201) {
      expect(responseBody<ErrorBody>(createResponse)).toEqual(
        expect.objectContaining({
          code: 'ACTIVE_REVIEW_CASE_EXISTS',
          existingCaseId: resolved.caseId,
        }),
      );
      expect(
        await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: resolved.caseId } }),
      ).toEqual(
        expect.objectContaining({
          status: FindingReviewCaseStatus.IN_REVIEW,
          version: resolved.version + 1,
          activeReviewSubjectKey: finding.reviewSubjectKey,
        }),
      );
      expect(await reopenEffects(resolved.caseId)).toEqual({ events: 1, audits: 1 });
      expect(
        await prisma.findingReviewCase.count({
          where: { reviewSubjectKey: finding.reviewSubjectKey },
        }),
      ).toBe(1);
      expect(
        await prisma.findingReviewEvent.count({
          where: { eventType: 'CASE_CREATED' },
        }),
      ).toBe(creationEventsBefore);
      expect(
        await prisma.auditLog.count({
          where: { entityType: 'FindingReviewCase', action: 'CASE_CREATED' },
        }),
      ).toBe(creationAuditsBefore);
    } else {
      const created = responseBody<{ id: string; reviewSubjectKey: string }>(createResponse);
      caseIds.add(created.id);
      expect(responseBody<ErrorBody>(reopenResponse)).toEqual(
        expect.objectContaining({
          code: 'ACTIVE_REVIEW_CASE_EXISTS',
          existingCaseId: created.id,
        }),
      );
      expect(created.reviewSubjectKey).toBe(finding.reviewSubjectKey);
      expect(
        await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: resolved.caseId } }),
      ).toEqual(resolvedBefore);
      expect(await reopenEffects(resolved.caseId)).toEqual({ events: 0, audits: 0 });
      expect(
        await prisma.findingReviewEvent.count({
          where: { caseId: created.id, eventType: 'CASE_CREATED' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { entityType: 'FindingReviewCase', entityId: created.id, action: 'CASE_CREATED' },
        }),
      ).toBe(1);
    }
    expect(
      await prisma.findingReviewCase.count({
        where: { activeReviewSubjectKey: finding.reviewSubjectKey },
      }),
    ).toBe(1);
  });

  it('supports resolve/reopen cycles with the same current decision', async () => {
    const fixture = await createCase();
    const firstReopen = await postReopen(
      fixture.caseId,
      `cycle-reopen-1-${randomUUID()}`,
      validPayload(3),
    );
    expect(firstReopen.status).toBe(201);
    expect(
      (await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
        .activeReviewSubjectKey,
    ).toBe(fixture.reviewSubjectKey);

    await postResolution(fixture.caseId, `cycle-resolution-1-${randomUUID()}`, 4).expect(201);
    expect(
      (await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
        .activeReviewSubjectKey,
    ).toBeNull();

    const secondReopen = await postReopen(
      fixture.caseId,
      `cycle-reopen-2-${randomUUID()}`,
      validPayload(5, 'Segunda revisão do mesmo caso.'),
    );
    expect(secondReopen.status).toBe(201);
    expect(
      (await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
        .activeReviewSubjectKey,
    ).toBe(fixture.reviewSubjectKey);

    await postResolution(fixture.caseId, `cycle-resolution-2-${randomUUID()}`, 6).expect(201);
    const finalCase = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    expect(finalCase).toEqual(
      expect.objectContaining({
        status: FindingReviewCaseStatus.RESOLVED,
        version: 7,
        activeReviewSubjectKey: null,
      }),
    );
    expect(await prisma.findingReviewDecision.count({ where: { caseId: fixture.caseId } })).toBe(1);
    expect(await reopenEffects(fixture.caseId)).toEqual({ events: 2, audits: 2 });
  });

  it('replays a historical reopen after later cycles without changing current state', async () => {
    const fixture = await createCase();
    const historicalKey = `historical-reopen-${randomUUID()}`;
    const first = await postReopen(fixture.caseId, historicalKey, validPayload(3));
    const firstBody = responseBody<ReopenBody>(first);
    await postResolution(fixture.caseId, `historical-resolution-${randomUUID()}`, 4).expect(201);
    const beforeReplay = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const replay = await postReopen(fixture.caseId, historicalKey, validPayload(3));
    expect(replay.status).toBe(200);
    expect(responseBody<ReopenBody>(replay)).toEqual({
      idempotentReplay: true,
      reopen: firstBody.reopen,
    });
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(beforeReplay);
  });

  it('disables new reopens and replay with the shared feature flag', async () => {
    const fixture = await createCase();
    const key = `flag-reopen-${randomUUID()}`;
    await postReopen(fixture.caseId, key, validPayload()).expect(201);
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    const replay = await postReopen(fixture.caseId, key, validPayload());
    expect(replay.status).toBe(503);
    expect(responseBody<ErrorBody>(replay).code).toBe('FINDING_REVIEW_CASES_DISABLED');

    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'invalid';
    const invalidFlag = await postReopen(
      (await createCase()).caseId,
      `invalid-flag-reopen-${randomUUID()}`,
      validPayload(),
    );
    expect(invalidFlag.status).toBe(503);
    expect(responseBody<ErrorBody>(invalidFlag).code).toBe(
      'FINDING_REVIEW_CASES_CONFIGURATION_INVALID',
    );
  });

  async function expectRollback(step: FailureStep) {
    const fixture = await createCase();
    const key = `rollback-reopen-${step}-${randomUUID()}`;
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const effectsBefore = await reopenEffects(fixture.caseId);
    const inventoryBefore = await inventorySnapshot();
    prisma.failNextTransactionAt(step);
    let failed: Awaited<ReturnType<typeof postReopen>>;
    try {
      failed = await postReopen(fixture.caseId, key, validPayload());
    } finally {
      prisma.clearTestControls();
    }
    expect(failed.status).toBe(500);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(caseBefore);
    expect(await reopenEffects(fixture.caseId)).toEqual(effectsBefore);
    expect(await inventorySnapshot()).toBe(inventoryBefore);

    const retry = await postReopen(fixture.caseId, key, validPayload());
    expect(retry.status).toBe(201);
    expect(responseBody<ReopenBody>(retry).idempotentReplay).toBe(false);
  }

  it.each(['event', 'audit'] as const)(
    'rolls back status, version and active subject when %s creation fails',
    async (step) => expectRollback(step),
  );
});
