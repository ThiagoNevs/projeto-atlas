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
import { CreateFindingReviewDecisionSupersessionDto } from '../src/finding-review-cases/dto/create-finding-review-decision-supersession.dto';
import { decisionRequestFingerprint } from '../src/finding-review-cases/finding-review-case-decision';
import {
  decisionSupersessionRequestFingerprint,
  FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
  MAX_FINDING_REVIEW_DECISION_SUPERSESSION_TEXT_LENGTH,
} from '../src/finding-review-cases/finding-review-decision-supersession';
import { sha256 } from '../src/finding-review-cases/finding-review-case-creation';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import {
  FindingReviewCaseStatus,
  FindingReviewIdentityConclusion,
  FindingReviewStaleness,
  type Prisma,
} from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_ACTOR_ID = 'human:oidc:test:actor';

type FailureStep = 'decision' | 'event' | 'audit';
type UnknownFunction = (...args: unknown[]) => unknown;

class SupersessionFaultInjectingPrismaService extends PrismaService {
  private failureStep: FailureStep | null = null;

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

  clearFailure(): void {
    this.failureStep = null;
  }

  private wrapTransaction(client: Prisma.TransactionClient): Prisma.TransactionClient {
    return new Proxy(client, {
      get: (target, property) => {
        const delegate = (target as unknown as Record<PropertyKey, unknown>)[property];
        const step =
          property === 'findingReviewDecision'
            ? 'decision'
            : property === 'findingReviewEvent'
              ? 'event'
              : property === 'auditLog'
                ? 'audit'
                : null;
        if (!step || typeof delegate !== 'object' || delegate === null) return delegate;
        return new Proxy(delegate, {
          get: (delegateTarget, method) => {
            const operation = (delegateTarget as Record<PropertyKey, unknown>)[method];
            if (typeof operation !== 'function') return operation;
            return (...args: unknown[]) => {
              if (this.failureStep === step && method === 'create') {
                this.failureStep = null;
                throw new Error(`TEST_SUPERSESSION_TRANSACTION_FAILURE:${step}`);
              }
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }
}

interface SupersessionBody {
  decision: {
    id: string;
    caseId: string;
    identityConclusion: FindingReviewIdentityConclusion;
    justification: string;
    caseVersion: number;
    createdBy: string;
    createdAt: string;
  };
  supersededDecisionId: string;
  idempotentReplay: boolean;
}

interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
}

interface CaseFixture {
  caseId: string;
  decisionId: string | null;
  assetIds: string[];
  version: number;
  activeReviewSubjectKey: string | null;
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TEST_EXPECTED_JSON_OBJECT');
  }
  return value;
}

function oppositeConclusion(
  value: FindingReviewIdentityConclusion,
): FindingReviewIdentityConclusion {
  return value === FindingReviewIdentityConclusion.SAME_ASSET
    ? FindingReviewIdentityConclusion.DIFFERENT_ASSETS
    : FindingReviewIdentityConclusion.SAME_ASSET;
}

describe('Finding review decision supersession helpers and DTO', () => {
  it.each(Object.values(FindingReviewIdentityConclusion))(
    'accepts %s and leaves text normalization to the service',
    async (identityConclusion) => {
      const longText = `  ${'x'.repeat(MAX_FINDING_REVIEW_DECISION_SUPERSESSION_TEXT_LENGTH + 1)}  `;
      const dto = plainToInstance(CreateFindingReviewDecisionSupersessionDto, {
        expectedVersion: 2,
        identityConclusion,
        justification: longText,
        correctionReason: longText,
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.justification).toBe(longText);
      expect(dto.correctionReason).toBe(longText);
    },
  );

  it('rejects structurally invalid payload fields', async () => {
    const dto = plainToInstance(CreateFindingReviewDecisionSupersessionDto, {
      expectedVersion: 1.5,
      identityConclusion: 'UNKNOWN',
      justification: 123,
      correctionReason: false,
    });
    expect((await validate(dto)).map((error) => error.property).sort()).toEqual([
      'correctionReason',
      'expectedVersion',
      'identityConclusion',
      'justification',
    ]);
  });

  it('uses a deterministic, global and case-sensitive operation fingerprint', () => {
    expect(decisionSupersessionRequestFingerprint(TEST_ACTOR_ID, 'supersede-ABC')).toBe(
      decisionSupersessionRequestFingerprint(TEST_ACTOR_ID, 'supersede-ABC'),
    );
    expect(decisionSupersessionRequestFingerprint(TEST_ACTOR_ID, 'supersede-ABC')).not.toBe(
      decisionSupersessionRequestFingerprint(TEST_ACTOR_ID, 'supersede-abc'),
    );
    expect(decisionSupersessionRequestFingerprint(TEST_ACTOR_ID, 'supersede-ABC')).not.toBe(
      decisionRequestFingerprint(TEST_ACTOR_ID, 'supersede-ABC'),
    );
  });
});

describe('POST /conflict-review-cases/:caseId/decisions/:decisionId/supersessions', () => {
  let app: INestApplication;
  let auth: TestAuthHarness;
  let api: ReturnType<typeof request.agent>;
  let prisma: SupersessionFaultInjectingPrismaService;
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
      .useClass(SupersessionFaultInjectingPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    api = await auth.createAuthenticatedAgent(app);
    prisma = app.get<SupersessionFaultInjectingPrismaService>(PrismaService);
  });

  afterEach(() => {
    prisma.clearFailure();
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
      withDecision?: boolean;
      identityConclusion?: FindingReviewIdentityConclusion;
      decisionJustification?: string;
      reviewOptions?: readonly string[];
      assetCount?: number;
      malformedSnapshot?: boolean;
      staleness?: FindingReviewStaleness;
    } = {},
  ): Promise<CaseFixture> {
    const token = randomUUID();
    const caseId = randomUUID();
    const withDecision = options.withDecision ?? true;
    const version = options.version ?? (withDecision ? 2 : 1);
    const status = options.status ?? FindingReviewCaseStatus.IN_REVIEW;
    const activeReviewSubjectKey = (
      [
        FindingReviewCaseStatus.OPEN,
        FindingReviewCaseStatus.IN_REVIEW,
        FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
      ] as FindingReviewCaseStatus[]
    ).includes(status)
      ? sha256(`active:${testRunId}:${token}`)
      : null;
    const relatedAssetIds = Array.from({ length: options.assetCount ?? 2 }, () => randomUUID());
    const createdAt = new Date('2026-08-28T12:00:00.000Z');

    await prisma.asset.createMany({
      data: relatedAssetIds.map((id, index) => ({
        id,
        canonicalKey: `atlas-supersession-test:${testRunId}:${token}:${index}`,
        name: `SUPERSESSION-${token.slice(0, 8)}-${index}`,
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
        reviewSubjectKey: sha256(`subject:${testRunId}:${token}`),
        activeReviewSubjectKey,
        creationRequestFingerprint: sha256(`request:${testRunId}:${token}`),
        status,
        staleness: options.staleness ?? FindingReviewStaleness.CURRENT,
        originalSnapshot: options.malformedSnapshot
          ? { snapshotVersion: 1, reviewOptions: 'SAME_ASSET' }
          : {
              snapshotVersion: 1,
              affectedAssets: relatedAssetIds.map((assetId) => ({ assetId, name: null })),
              reviewOptions: options.reviewOptions ?? ['SAME_ASSET', 'DIFFERENT_ASSETS'],
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
            assetNameAtCreation: `SUPERSESSION-${token.slice(0, 8)}-${index}`,
            role: 'AFFECTED_ASSET',
          })),
        },
        events: {
          create: {
            eventType: 'CASE_CREATED',
            versionBefore: null,
            versionAfter: 1,
            actorId: auth.actor.id,
            nextStatus: FindingReviewCaseStatus.OPEN,
            after: { status: FindingReviewCaseStatus.OPEN, version: 1 },
            occurredAt: createdAt,
            createdAt,
          },
        },
      },
    });
    caseIds.add(caseId);

    let decisionId: string | null = null;
    if (withDecision) {
      const decision = await prisma.findingReviewDecision.create({
        data: {
          caseId,
          identityConclusion:
            options.identityConclusion ?? FindingReviewIdentityConclusion.SAME_ASSET,
          justification: options.decisionJustification ?? 'Decisão original.',
          caseVersion: version,
          createdBy: auth.actor.id,
          requestFingerprint: sha256(`decision:${testRunId}:${token}`),
          createdAt,
        },
      });
      decisionId = decision.id;
    }
    return { caseId, decisionId, assetIds: relatedAssetIds, version, activeReviewSubjectKey };
  }

  function postSupersession(
    fixture: Pick<CaseFixture, 'caseId' | 'decisionId'>,
    key: string | undefined,
    payload: Record<string, unknown>,
    decisionId = fixture.decisionId ?? randomUUID(),
  ) {
    const call = api
      .post(`/conflict-review-cases/${fixture.caseId}/decisions/${decisionId}/supersessions`)
      .send(payload);
    return key === undefined ? call : call.set('Idempotency-Key', key);
  }

  function validPayload(
    expectedVersion = 2,
    identityConclusion: FindingReviewIdentityConclusion = FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
    justification = 'A revisão das evidências corrigiu a conclusão de identidade.',
    correctionReason = 'A decisão anterior interpretou incorretamente a evidência histórica.',
  ): Record<string, unknown> {
    return { expectedVersion, identityConclusion, justification, correctionReason };
  }

  async function effects(caseId: string) {
    return {
      decisions: await prisma.findingReviewDecision.count({ where: { caseId } }),
      events: await prisma.findingReviewEvent.count({
        where: { caseId, eventType: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT },
      }),
      audits: await prisma.auditLog.count({
        where: {
          entityType: 'FindingReviewCase',
          entityId: caseId,
          action: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
        },
      }),
    };
  }

  async function inventoryCounts() {
    const [assets, attributes, interfaces, evidence, assetEvents, conflicts, conflictValues] =
      await Promise.all([
        prisma.asset.count(),
        prisma.assetAttribute.count(),
        prisma.networkInterface.count(),
        prisma.assetEvidence.count(),
        prisma.assetEvent.count(),
        prisma.conflict.count(),
        prisma.conflictValue.count(),
      ]);
    return { assets, attributes, interfaces, evidence, assetEvents, conflicts, conflictValues };
  }

  it.each([
    [FindingReviewIdentityConclusion.SAME_ASSET, FindingReviewIdentityConclusion.DIFFERENT_ASSETS],
    [FindingReviewIdentityConclusion.DIFFERENT_ASSETS, FindingReviewIdentityConclusion.SAME_ASSET],
    [FindingReviewIdentityConclusion.SAME_ASSET, FindingReviewIdentityConclusion.SAME_ASSET],
    [
      FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
      FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
    ],
  ])('supersedes %s with %s append-only and preserves operational state', async (from, to) => {
    const fixture = await createCase({
      identityConclusion: from,
      decisionJustification: 'Justificativa anterior.',
      staleness: FindingReviewStaleness.REQUIRES_REFRESH,
    });
    const original = await prisma.findingReviewDecision.findUniqueOrThrow({
      where: { id: fixture.decisionId! },
    });
    const inventoryBefore = await inventoryCounts();
    const justification =
      to === from ? 'Justificativa materialmente corrigida.' : 'Nova conclusão.';
    const response = await postSupersession(
      fixture,
      `success-${from}-${to}-${randomUUID()}`,
      validPayload(
        fixture.version,
        to,
        `  ${justification}\nLinha preservada.  `,
        '  Erro humano.  ',
      ),
    );
    const body = responseBody<SupersessionBody>(response);

    expect(response.status).toBe(201);
    expect(body).toEqual({
      decision: expect.objectContaining({
        caseId: fixture.caseId,
        identityConclusion: to,
        justification: `${justification}\nLinha preservada.`,
        caseVersion: fixture.version + 1,
        createdBy: auth.actor.id,
      }),
      supersededDecisionId: fixture.decisionId,
      idempotentReplay: false,
    });
    expect(
      await prisma.findingReviewDecision.findUniqueOrThrow({
        where: { id: fixture.decisionId! },
      }),
    ).toEqual(original);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(
      expect.objectContaining({
        status: FindingReviewCaseStatus.IN_REVIEW,
        staleness: FindingReviewStaleness.REQUIRES_REFRESH,
        version: fixture.version + 1,
        activeReviewSubjectKey: fixture.activeReviewSubjectKey,
      }),
    );
    expect(await effects(fixture.caseId)).toEqual({ decisions: 2, events: 1, audits: 1 });
    expect(await inventoryCounts()).toEqual(inventoryBefore);
  });

  it('persists canonical event and AuditLog and exposes safe history without raw key', async () => {
    const fixture = await createCase();
    const rawKey = `canonical-supersession-${randomUUID()}`;
    const response = await postSupersession(fixture, rawKey, validPayload());
    const body = responseBody<SupersessionBody>(response);
    const fingerprint = decisionSupersessionRequestFingerprint(auth.actor.id, rawKey);
    expect(response.status).toBe(201);

    const decision = await prisma.findingReviewDecision.findUniqueOrThrow({
      where: { id: body.decision.id },
    });
    expect(decision.requestFingerprint).toBe(fingerprint);
    const event = await prisma.findingReviewEvent.findUniqueOrThrow({
      where: { caseId_requestId: { caseId: fixture.caseId, requestId: fingerprint } },
    });
    expect(event).toEqual(
      expect.objectContaining({
        eventType: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
        versionBefore: 2,
        versionAfter: 3,
        previousStatus: null,
        nextStatus: null,
        before: {
          version: 2,
          decisionId: fixture.decisionId,
          identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        },
        after: {
          version: 3,
          decisionId: decision.id,
          identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
        },
        metadata: {
          previousDecisionId: fixture.decisionId,
          previousIdentityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          decisionId: decision.id,
          identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
          correctionReason: validPayload().correctionReason,
          expectedVersion: 2,
        },
      }),
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: 'FindingReviewCase',
        entityId: fixture.caseId,
        action: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
      },
    });
    expect(audit).toEqual(
      expect.objectContaining({
        actorType: 'USER',
        actorId: auth.actor.id,
        before: event.before,
        after: event.after,
        metadata: expect.objectContaining({
          caseId: fixture.caseId,
          eventId: event.id,
          previousDecisionId: fixture.decisionId,
          decisionId: decision.id,
          versionBefore: 2,
          versionAfter: 3,
        }),
      }),
    );
    expect(JSON.stringify([decision, event, audit, response.body])).not.toContain(rawKey);

    const detail = await api.get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    const detailBody = responseBody<{
      currentDecision: { id: string };
      decisionHistory: Array<{ id: string }>;
      events: Array<{ eventType: string; metadata: Record<string, string> | null }>;
    }>(detail);
    expect(detailBody.currentDecision.id).toBe(decision.id);
    expect(detailBody.decisionHistory.map((item) => item.id)).toEqual([
      fixture.decisionId,
      decision.id,
    ]);
    expect(
      detailBody.events.find((item) => item.eventType === FINDING_REVIEW_DECISION_SUPERSEDED_EVENT)
        ?.metadata,
    ).toEqual(
      expect.objectContaining({
        previousDecisionId: fixture.decisionId,
        previousIdentityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        decisionId: decision.id,
        identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
        correctionReason: validPayload().correctionReason,
      }),
    );
    expect(JSON.stringify(detail.body)).not.toContain(fingerprint);
  });

  it.each([
    ['justification', 'justification'],
    ['correctionReason', 'correctionReason'],
  ] as const)('accepts 1 and 1000 normalized characters for %s', async (_label, field) => {
    for (const value of ['x', 'x'.repeat(1_000)]) {
      const fixture = await createCase();
      const payload = validPayload();
      payload[field] = ` ${value} `;
      const response = await postSupersession(
        fixture,
        `boundary-${field}-${value.length}-${randomUUID()}`,
        payload,
      );
      expect(response.status).toBe(201);
      const body = responseBody<SupersessionBody>(response);
      if (field === 'justification') expect(body.decision.justification).toBe(value);
    }
  });

  it.each([
    ['empty justification', { justification: '   ' }],
    ['long justification', { justification: 'x'.repeat(1_001) }],
    ['empty correction reason', { correctionReason: '\n\t' }],
    ['long correction reason', { correctionReason: 'x'.repeat(1_001) }],
  ])('rejects semantic text error: %s', async (_label, override) => {
    const fixture = await createCase();
    const response = await postSupersession(fixture, `invalid-text-${randomUUID()}`, {
      ...validPayload(),
      ...override,
    });
    expect(response.status).toBe(422);
    expect(await effects(fixture.caseId)).toEqual({ decisions: 1, events: 0, audits: 0 });
  });

  it('returns stale 409 before validating 1001-character semantic text', async () => {
    const fixture = await createCase({ version: 3 });
    const response = await postSupersession(
      fixture,
      `stale-long-${randomUUID()}`,
      validPayload(2, FindingReviewIdentityConclusion.DIFFERENT_ASSETS, 'x'.repeat(1_001)),
    );
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_CASE_VERSION_CONFLICT');
    expect(await effects(fixture.caseId)).toEqual({ decisions: 1, events: 0, audits: 0 });
  });

  it('rejects an effective no-op even when correctionReason changes', async () => {
    const fixture = await createCase({ decisionJustification: 'Conteúdo canônico.' });
    const response = await postSupersession(
      fixture,
      `no-op-${randomUUID()}`,
      validPayload(
        2,
        FindingReviewIdentityConclusion.SAME_ASSET,
        '  Conteúdo canônico.  ',
        'Outro motivo.',
      ),
    );
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe(
      'FINDING_REVIEW_DECISION_SUPERSESSION_NO_CHANGE',
    );
    expect(await effects(fixture.caseId)).toEqual({ decisions: 1, events: 0, audits: 0 });
  });

  it.each([
    FindingReviewCaseStatus.OPEN,
    FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
    FindingReviewCaseStatus.RESOLVED,
    FindingReviewCaseStatus.DISMISSED,
    FindingReviewCaseStatus.CANCELLED,
  ])('rejects supersession while case is %s', async (status) => {
    const fixture = await createCase({ status });
    const response = await postSupersession(
      fixture,
      `state-${status}-${randomUUID()}`,
      validPayload(),
    );
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe(
      'FINDING_REVIEW_DECISION_SUPERSESSION_NOT_ALLOWED',
    );
  });

  it('requires an existing current decision', async () => {
    const fixture = await createCase({ withDecision: false, version: 2 });
    const response = await postSupersession(fixture, `no-decision-${randomUUID()}`, validPayload());
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_CASE_DECISION_REQUIRED');
  });

  it('returns the public structural and lookup errors without writes', async () => {
    const fixture = await createCase();
    const effectsBefore = await effects(fixture.caseId);
    const missingHeader = await postSupersession(fixture, undefined, validPayload());
    expect(missingHeader.status).toBe(400);
    expect(responseBody<ErrorBody>(missingHeader).code).toBe('INVALID_IDEMPOTENCY_KEY');

    const extraField = await postSupersession(fixture, `extra-${randomUUID()}`, {
      ...validPayload(),
      unexpected: true,
    });
    expect(extraField.status).toBe(400);

    const outOfRange = await postSupersession(
      fixture,
      `range-${randomUUID()}`,
      validPayload(2_147_483_647),
    );
    expect(outOfRange.status).toBe(400);

    const missingCase = await postSupersession(
      { caseId: randomUUID(), decisionId: randomUUID() },
      `missing-case-${randomUUID()}`,
      validPayload(),
    );
    expect(missingCase.status).toBe(404);
    expect(responseBody<ErrorBody>(missingCase).code).toBe('FINDING_REVIEW_CASE_NOT_FOUND');
    expect(await effects(fixture.caseId)).toEqual(effectsBefore);
  });

  it('rejects a historical or unrelated path decision with 409', async () => {
    const fixture = await createCase({ version: 3 });
    const historical = await prisma.findingReviewDecision.create({
      data: {
        caseId: fixture.caseId,
        identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
        justification: 'Decisão histórica.',
        caseVersion: 2,
        createdBy: auth.actor.id,
        requestFingerprint: sha256(`historical:${randomUUID()}`),
      },
    });
    const response = await postSupersession(
      fixture,
      `historical-path-${randomUUID()}`,
      validPayload(3),
      historical.id,
    );
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_DECISION_NOT_CURRENT');
  });

  it.each([
    ['malformed snapshot', { malformedSnapshot: true }],
    ['unsupported option', { reviewOptions: ['SAME_ASSET'] }],
    ['one historical asset', { assetCount: 1 }],
  ] as const)('rejects incompatible frozen context: %s', async (_label, options) => {
    const fixture = await createCase(options);
    const response = await postSupersession(fixture, `snapshot-${randomUUID()}`, validPayload());
    expect(response.status).toBe(422);
    expect(await effects(fixture.caseId)).toEqual({ decisions: 1, events: 0, audits: 0 });
  });

  it('does not require the derived finding to still exist', async () => {
    const fixture = await createCase();
    const response = await postSupersession(
      fixture,
      `no-current-finding-${randomUUID()}`,
      validPayload(),
    );
    expect(response.status).toBe(201);
  });

  it('replays exactly after case status and version later advance without writes', async () => {
    const fixture = await createCase();
    const key = `replay-advanced-${randomUUID()}`;
    const created = await postSupersession(fixture, key, validPayload());
    const createdBody = responseBody<SupersessionBody>(created);
    await prisma.findingReviewCase.update({
      where: { id: fixture.caseId },
      data: { version: { increment: 1 }, status: FindingReviewCaseStatus.OPEN },
    });
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const effectsBefore = await effects(fixture.caseId);
    const replay = await postSupersession(fixture, key, validPayload());
    expect(replay.status).toBe(200);
    expect(responseBody<SupersessionBody>(replay)).toEqual({
      ...createdBody,
      idempotentReplay: true,
    });
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(caseBefore);
    expect(await effects(fixture.caseId)).toEqual(effectsBefore);
  });

  it.each([
    'versionBefore versus expectedVersion',
    'versionAfter versus D2 caseVersion',
    'event after versus D2',
    'metadata current conclusion versus D2',
    'event before versus previous metadata',
    'previous decision from another case',
  ] as const)('rejects corrupted persisted replay: %s', async (corruption) => {
    const fixture = await createCase();
    const key = `corrupted-replay-${randomUUID()}`;
    const payload = validPayload();
    const created = await postSupersession(fixture, key, payload);
    const createdBody = responseBody<SupersessionBody>(created);
    expect(created.status).toBe(201);

    const fingerprint = decisionSupersessionRequestFingerprint(auth.actor.id, key);
    const event = await prisma.findingReviewEvent.findUniqueOrThrow({
      where: { caseId_requestId: { caseId: fixture.caseId, requestId: fingerprint } },
    });
    const metadata = jsonObject(event.metadata);
    const before = jsonObject(event.before);
    const after = jsonObject(event.after);

    if (corruption === 'versionBefore versus expectedVersion') {
      await prisma.findingReviewEvent.update({
        where: { id: event.id },
        data: { versionBefore: event.versionBefore! - 1 },
      });
    } else if (corruption === 'versionAfter versus D2 caseVersion') {
      await prisma.findingReviewEvent.update({
        where: { id: event.id },
        data: { versionAfter: 999 },
      });
    } else if (corruption === 'event after versus D2') {
      await prisma.findingReviewEvent.update({
        where: { id: event.id },
        data: {
          after: {
            ...after,
            identityConclusion: oppositeConclusion(createdBody.decision.identityConclusion),
          },
        },
      });
    } else if (corruption === 'metadata current conclusion versus D2') {
      await prisma.findingReviewEvent.update({
        where: { id: event.id },
        data: {
          metadata: {
            ...metadata,
            identityConclusion: oppositeConclusion(createdBody.decision.identityConclusion),
          },
        },
      });
    } else if (corruption === 'event before versus previous metadata') {
      await prisma.findingReviewEvent.update({
        where: { id: event.id },
        data: {
          before: {
            ...before,
            identityConclusion: oppositeConclusion(
              metadata.previousIdentityConclusion as FindingReviewIdentityConclusion,
            ),
          },
        },
      });
    } else {
      const otherCase = await createCase();
      await prisma.findingReviewEvent.update({
        where: { id: event.id },
        data: {
          before: {
            ...before,
            decisionId: otherCase.decisionId!,
            identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          },
          metadata: {
            ...metadata,
            previousDecisionId: otherCase.decisionId!,
            previousIdentityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          },
        },
      });
    }

    const caseBeforeReplay = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const effectsBeforeReplay = await effects(fixture.caseId);
    const replay = await postSupersession(fixture, key, payload);

    expect(replay.status).not.toBe(200);
    expect(replay.status).toBe(500);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
    ).toEqual(caseBeforeReplay);
    expect(await effects(fixture.caseId)).toEqual(effectsBeforeReplay);
    expect(await prisma.findingReviewDecision.count({ where: { caseId: fixture.caseId } })).toBe(2);
    expect(
      await prisma.findingReviewDecision.findUniqueOrThrow({
        where: { id: createdBody.decision.id },
      }),
    ).toEqual(
      expect.objectContaining({
        id: createdBody.decision.id,
        caseVersion: createdBody.decision.caseVersion,
      }),
    );
  });

  it.each([
    ['caseId', 'case'],
    ['decisionId', 'decision'],
    ['expectedVersion', 'version'],
    ['identityConclusion', 'conclusion'],
    ['justification', 'justification'],
    ['correctionReason', 'reason'],
  ] as const)('rejects global key reuse with different %s', async (_label, dimension) => {
    const first = await createCase();
    const second = dimension === 'case' ? await createCase() : first;
    const key = `reuse-${dimension}-${randomUUID()}`;
    const originalPayload = validPayload();
    await postSupersession(first, key, originalPayload).expect(201);
    let targetDecision = second.decisionId!;
    const payload = { ...originalPayload };
    if (dimension === 'decision') targetDecision = randomUUID();
    if (dimension === 'version') payload.expectedVersion = 3;
    if (dimension === 'conclusion')
      payload.identityConclusion = FindingReviewIdentityConclusion.SAME_ASSET;
    if (dimension === 'justification') payload.justification = 'Outro conteúdo.';
    if (dimension === 'reason') payload.correctionReason = 'Outro motivo.';
    const response = await postSupersession(second, key, payload, targetDecision);
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('allows only one of two concurrent supersessions from the same version', async () => {
    const fixture = await createCase();
    const [first, second] = await Promise.all([
      postSupersession(
        fixture,
        `concurrent-a-${randomUUID()}`,
        validPayload(2, FindingReviewIdentityConclusion.DIFFERENT_ASSETS, 'Conclusão A.'),
      ),
      postSupersession(
        fixture,
        `concurrent-b-${randomUUID()}`,
        validPayload(2, FindingReviewIdentityConclusion.SAME_ASSET, 'Justificativa B.'),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await effects(fixture.caseId)).toEqual({ decisions: 2, events: 1, audits: 1 });
  });

  it('serializes concurrent supersession and resolution deterministically by CAS', async () => {
    const fixture = await createCase();
    const supersession = postSupersession(
      fixture,
      `race-supersession-${randomUUID()}`,
      validPayload(),
    );
    const resolution = api
      .post(`/conflict-review-cases/${fixture.caseId}/resolutions`)
      .set('Idempotency-Key', `race-resolution-${randomUUID()}`)
      .send({ expectedVersion: 2, justification: 'Encerramento concorrente.' });
    const [supersessionResponse, resolutionResponse] = await Promise.all([
      supersession,
      resolution,
    ]);
    expect([supersessionResponse.status, resolutionResponse.status].sort()).toEqual([201, 409]);
    const persistedCase = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    expect(persistedCase.version).toBe(3);
    const operationEvents = await prisma.findingReviewEvent.count({
      where: {
        caseId: fixture.caseId,
        eventType: { in: [FINDING_REVIEW_DECISION_SUPERSEDED_EVENT, 'CASE_RESOLVED'] },
      },
    });
    expect(operationEvents).toBe(1);
  });

  it.each(['decision', 'event', 'audit'] as const)(
    'rolls back fully when %s persistence fails and permits retry',
    async (step) => {
      const fixture = await createCase();
      const key = `rollback-${step}-${randomUUID()}`;
      const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({
        where: { id: fixture.caseId },
      });
      const effectsBefore = await effects(fixture.caseId);
      const inventoryBefore = await inventoryCounts();
      prisma.failNextTransactionAt(step);

      await postSupersession(fixture, key, validPayload()).expect(500);
      expect(
        await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
      ).toEqual(caseBefore);
      expect(await effects(fixture.caseId)).toEqual(effectsBefore);
      expect(await inventoryCounts()).toEqual(inventoryBefore);
      expect(
        await prisma.findingReviewDecision.findUnique({
          where: { requestFingerprint: decisionSupersessionRequestFingerprint(auth.actor.id, key) },
        }),
      ).toBeNull();

      await postSupersession(fixture, key, validPayload()).expect(201);
      expect(await effects(fixture.caseId)).toEqual({ decisions: 2, events: 1, audits: 1 });
    },
  );

  it('supports D1 -> D2 -> D3 and derives the latest decision by caseVersion', async () => {
    const fixture = await createCase();
    const secondResponse = await postSupersession(
      fixture,
      `chain-d2-${randomUUID()}`,
      validPayload(),
    );
    const second = responseBody<SupersessionBody>(secondResponse).decision;
    const thirdResponse = await postSupersession(
      { ...fixture, decisionId: second.id },
      `chain-d3-${randomUUID()}`,
      validPayload(
        3,
        FindingReviewIdentityConclusion.SAME_ASSET,
        'Terceira decisão canônica.',
        'Nova revisão das evidências históricas.',
      ),
    );
    const third = responseBody<SupersessionBody>(thirdResponse).decision;
    expect([secondResponse.status, thirdResponse.status]).toEqual([201, 201]);
    expect(third.caseVersion).toBe(4);
    const detail = await api.get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    expect(
      responseBody<{
        currentDecision: { id: string };
        decisionHistory: Array<{ caseVersion: number }>;
      }>(detail),
    ).toEqual(
      expect.objectContaining({
        currentDecision: expect.objectContaining({ id: third.id }),
        decisionHistory: expect.arrayContaining([
          expect.objectContaining({ caseVersion: 2 }),
          expect.objectContaining({ caseVersion: 3 }),
          expect.objectContaining({ caseVersion: 4 }),
        ]),
      }),
    );
  });

  it('rejects direct supersession after resolution and allows it after explicit reopen', async () => {
    const fixture = await createCase({ status: FindingReviewCaseStatus.RESOLVED, version: 3 });
    await postSupersession(fixture, `resolved-direct-${randomUUID()}`, validPayload(3)).expect(422);
    await api
      .post(`/conflict-review-cases/${fixture.caseId}/reopens`)
      .set('Idempotency-Key', `reopen-before-supersession-${randomUUID()}`)
      .send({ expectedVersion: 3, justification: 'Reabrir para corrigir a decisão.' })
      .expect(201);
    await postSupersession(fixture, `after-reopen-${randomUUID()}`, validPayload(4)).expect(201);
  });

  it('keeps the original decision endpoint first-only', async () => {
    const fixture = await createCase();
    const response = await api
      .post(`/conflict-review-cases/${fixture.caseId}/decisions`)
      .set('Idempotency-Key', `initial-second-${randomUUID()}`)
      .send({
        expectedVersion: 2,
        identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
        justification: 'Tentativa de segunda decisão pelo endpoint inicial.',
      });
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe(
      'FINDING_REVIEW_CASE_DECISION_ALREADY_RECORDED',
    );
  });

  it('returns 503 while the Finding Review feature is disabled', async () => {
    const fixture = await createCase();
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    const response = await postSupersession(fixture, `disabled-${randomUUID()}`, validPayload());
    expect(response.status).toBe(503);
    expect(await effects(fixture.caseId)).toEqual({ decisions: 1, events: 0, audits: 0 });
  });

  it('blocks an otherwise valid replay while the feature is disabled', async () => {
    const fixture = await createCase();
    const key = `disabled-replay-${randomUUID()}`;
    await postSupersession(fixture, key, validPayload()).expect(201);
    const effectsBefore = await effects(fixture.caseId);
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    await postSupersession(fixture, key, validPayload()).expect(503);
    expect(await effects(fixture.caseId)).toEqual(effectsBefore);
  });
});
