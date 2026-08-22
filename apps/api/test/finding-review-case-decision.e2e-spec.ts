import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { CreateFindingReviewDecisionDto } from '../src/finding-review-cases/dto/create-finding-review-decision.dto';
import {
  decisionRequestFingerprint,
  FINDING_REVIEW_DECISION_RECORDED_EVENT,
  MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH,
} from '../src/finding-review-cases/finding-review-case-decision';
import { sha256 } from '../src/finding-review-cases/finding-review-case-creation';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import {
  FindingReviewCaseStatus,
  FindingReviewIdentityConclusion,
  FindingReviewStaleness,
  type Prisma,
} from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

type FailureStep = 'decision' | 'event' | 'audit';
type UnknownFunction = (...args: unknown[]) => unknown;

class DecisionFaultInjectingPrismaService extends PrismaService {
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
        const step = property === 'findingReviewDecision'
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
                throw new Error(`TEST_DECISION_TRANSACTION_FAILURE:${step}`);
              }
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }
}

interface DecisionBody {
  decision: {
    id: string;
    caseId: string;
    identityConclusion: FindingReviewIdentityConclusion;
    justification: string;
    caseVersion: number;
    createdBy: string;
    createdAt: string;
  };
  idempotentReplay: boolean;
}

interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
}

interface CaseFixture {
  caseId: string;
  assetIds: string[];
  version: number;
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('Finding review decision helpers and DTO', () => {
  it.each(Object.values(FindingReviewIdentityConclusion))(
    'accepts identity conclusion %s with structural fields',
    async (identityConclusion) => {
      const dto = plainToInstance(CreateFindingReviewDecisionDto, {
        identityConclusion,
        justification: 'Justificativa estrutural.',
        expectedVersion: 1,
      });
      expect(await validate(dto)).toEqual([]);
    },
  );

  it('rejects invalid conclusion, non-string justification and non-persistible versions', async () => {
    const dto = plainToInstance(CreateFindingReviewDecisionDto, {
      identityConclusion: 'NOT_A_CONCLUSION',
      justification: 123,
      expectedVersion: 2_147_483_647,
    });
    const properties = (await validate(dto)).map((error) => error.property).sort();
    expect(properties).toEqual(['expectedVersion', 'identityConclusion', 'justification']);
  });

  it('keeps the decision fingerprint independent from payload and sensitive to key casing', () => {
    expect(decisionRequestFingerprint('atlas-decision-ABC')).toBe(
      decisionRequestFingerprint('atlas-decision-ABC'),
    );
    expect(decisionRequestFingerprint('atlas-decision-ABC')).not.toBe(
      decisionRequestFingerprint('atlas-decision-abc'),
    );
  });
});

describe('POST /conflict-review-cases/:id/decisions (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: DecisionFaultInjectingPrismaService;
  const testRunId = randomUUID();
  const caseIds = new Set<string>();
  const assetIds = new Set<string>();
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useClass(DecisionFaultInjectingPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<DecisionFaultInjectingPrismaService>(PrismaService);
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
  });

  async function createCase(options: {
    status?: FindingReviewCaseStatus;
    staleness?: FindingReviewStaleness;
    version?: number;
    reviewOptions?: string[];
    assetCount?: number;
    malformedSnapshot?: boolean;
  } = {}): Promise<CaseFixture> {
    const token = randomUUID();
    const caseId = randomUUID();
    const version = options.version ?? 1;
    const status = options.status ?? FindingReviewCaseStatus.IN_REVIEW;
    const createdAt = new Date('2026-08-20T12:00:00.000Z');
    const relatedAssetIds = Array.from({ length: options.assetCount ?? 2 }, () => randomUUID());

    await prisma.asset.createMany({
      data: relatedAssetIds.map((id, index) => ({
        id,
        canonicalKey: `atlas-decision-test:${testRunId}:${token}:${index}`,
        name: `DECISION-${token.slice(0, 8)}-${index}`,
        kind: 'SERVER',
      })),
    });
    relatedAssetIds.forEach((id) => assetIds.add(id));

    const originalSnapshot = options.malformedSnapshot
      ? { snapshotVersion: 1, reviewOptions: 'SAME_ASSET' }
      : {
          snapshotVersion: 1,
          findingId: `finding_${sha256(token).slice(0, 24)}`,
          affectedAssets: relatedAssetIds.map((id) => ({ assetId: id, name: null })),
          reviewOptions: options.reviewOptions ?? ['SAME_ASSET', 'DIFFERENT_ASSETS'],
        };

    await prisma.findingReviewCase.create({
      data: {
        id: caseId,
        findingId: `finding_${sha256(token).slice(0, 24)}`,
        findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        policyVersion: '2026-07-conflict-v1',
        reviewSubjectKey: sha256(`subject:${testRunId}:${token}`),
        activeReviewSubjectKey: ([
          FindingReviewCaseStatus.OPEN,
          FindingReviewCaseStatus.IN_REVIEW,
          FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
        ] as FindingReviewCaseStatus[]).includes(status)
          ? sha256(`active:${testRunId}:${token}`)
          : null,
        creationRequestFingerprint: sha256(`request:${testRunId}:${token}`),
        status,
        staleness: options.staleness ?? FindingReviewStaleness.CURRENT,
        originalSnapshot,
        originalSnapshotHash: sha256(`snapshot:${testRunId}:${token}`),
        version,
        createdBy: 'atlas-mvp-user',
        findingGeneratedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        assets: {
          create: relatedAssetIds.map((assetId, index) => ({
            assetId,
            assetIdAtCreation: assetId,
            assetNameAtCreation: `DECISION-${token.slice(0, 8)}-${index}`,
            role: 'AFFECTED_ASSET',
          })),
        },
        events: {
          create: {
            eventType: 'CASE_CREATED',
            versionBefore: null,
            versionAfter: version,
            actorId: 'atlas-mvp-user',
            nextStatus: status,
            after: { status, version },
            occurredAt: createdAt,
            createdAt,
          },
        },
      },
    });
    caseIds.add(caseId);
    return { caseId, assetIds: relatedAssetIds, version };
  }

  function postDecision(
    caseId: string,
    key: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const call = request(server)
      .post(`/conflict-review-cases/${caseId}/decisions`)
      .send(payload);
    return key === undefined ? call : call.set('Idempotency-Key', key);
  }

  function validPayload(
    expectedVersion: number,
    identityConclusion: FindingReviewIdentityConclusion = FindingReviewIdentityConclusion.SAME_ASSET,
    justification = 'As evidências indicam que os registros representam o mesmo equipamento.',
  ): Record<string, unknown> {
    return { identityConclusion, justification, expectedVersion };
  }

  async function decisionEffects(caseId: string) {
    return {
      decisions: await prisma.findingReviewDecision.count({ where: { caseId } }),
      events: await prisma.findingReviewEvent.count({
        where: { caseId, eventType: FINDING_REVIEW_DECISION_RECORDED_EVENT },
      }),
      audits: await prisma.auditLog.count({
        where: {
          entityType: 'FindingReviewCase',
          entityId: caseId,
          action: FINDING_REVIEW_DECISION_RECORDED_EVENT,
        },
      }),
    };
  }

  async function inventoryCounts() {
    const [assets, attributes, interfaces, evidence, events, conflicts, values] = await Promise.all([
      prisma.asset.count(),
      prisma.assetAttribute.count(),
      prisma.networkInterface.count(),
      prisma.assetEvidence.count(),
      prisma.assetEvent.count(),
      prisma.conflict.count(),
      prisma.conflictValue.count(),
    ]);
    return { assets, attributes, interfaces, evidence, events, conflicts, values };
  }

  it.each(Object.values(FindingReviewIdentityConclusion))(
    'records %s with versionAfter while preserving case status and staleness',
    async (identityConclusion) => {
      const fixture = await createCase({ staleness: FindingReviewStaleness.REQUIRES_REFRESH });
      const key = `create-${identityConclusion}-${randomUUID()}`;
      const inventoryBefore = await inventoryCounts();
      const response = await postDecision(
        fixture.caseId,
        key,
        validPayload(1, identityConclusion, '  Linha um.\nLinha dois.  '),
      );
      const body = responseBody<DecisionBody>(response);

      expect(response.status).toBe(201);
      expect(body).toEqual({
        decision: expect.objectContaining({
          caseId: fixture.caseId,
          identityConclusion,
          justification: 'Linha um.\nLinha dois.',
          caseVersion: 2,
          createdBy: 'atlas-mvp-user',
        }),
        idempotentReplay: false,
      });
      expect(new Date(body.decision.createdAt).toISOString()).toBe(body.decision.createdAt);

      const persistedCase = await prisma.findingReviewCase.findUniqueOrThrow({
        where: { id: fixture.caseId },
      });
      expect(persistedCase).toEqual(expect.objectContaining({
        status: FindingReviewCaseStatus.IN_REVIEW,
        staleness: FindingReviewStaleness.REQUIRES_REFRESH,
        version: 2,
      }));
      expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 1, events: 1, audits: 1 });
      expect(await inventoryCounts()).toEqual(inventoryBefore);
    },
  );

  it('persists one canonical decision, event and AuditLog without duplicating justification', async () => {
    const fixture = await createCase();
    const rawKey = `canonical-${randomUUID()}`;
    const response = await postDecision(fixture.caseId, rawKey, validPayload(1));
    const body = responseBody<DecisionBody>(response);
    expect(response.status).toBe(201);

    const decision = await prisma.findingReviewDecision.findUniqueOrThrow({
      where: { id: body.decision.id },
    });
    expect(decision).toEqual(expect.objectContaining({
      caseId: fixture.caseId,
      identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
      justification: body.decision.justification,
      caseVersion: 2,
      createdBy: 'atlas-mvp-user',
      requestFingerprint: decisionRequestFingerprint(rawKey),
    }));

    const event = await prisma.findingReviewEvent.findFirstOrThrow({
      where: { caseId: fixture.caseId, eventType: FINDING_REVIEW_DECISION_RECORDED_EVENT },
    });
    expect(event).toEqual(expect.objectContaining({
      versionBefore: 1,
      versionAfter: 2,
      actorId: 'atlas-mvp-user',
      requestId: decision.requestFingerprint,
      previousStatus: null,
      nextStatus: null,
      metadata: {
        decisionId: decision.id,
        identityConclusion: decision.identityConclusion,
      },
    }));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: fixture.caseId, action: FINDING_REVIEW_DECISION_RECORDED_EVENT },
    });
    expect(audit).toEqual(expect.objectContaining({
      actorType: 'USER',
      actorId: 'atlas-mvp-user',
      entityType: 'FindingReviewCase',
    }));
    expect(JSON.stringify([event.metadata, audit.metadata, response.body])).not.toContain(rawKey);
    expect(JSON.stringify([event.metadata, audit.metadata])).not.toContain(decision.justification);
    expect(JSON.stringify(response.body)).not.toContain(decision.requestFingerprint);
  });

  it('rejects a second new decision while preserving the original operation', async () => {
    const fixture = await createCase();
    await postDecision(fixture.caseId, `original-${randomUUID()}`, validPayload(1)).expect(201);
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const effectsBefore = await decisionEffects(fixture.caseId);

    const response = await postDecision(
      fixture.caseId,
      `second-${randomUUID()}`,
      validPayload(2, FindingReviewIdentityConclusion.DIFFERENT_ASSETS),
    );
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe(
      'FINDING_REVIEW_CASE_DECISION_ALREADY_RECORDED',
    );
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(caseBefore);
    expect(await decisionEffects(fixture.caseId)).toEqual(effectsBefore);
  });

  it('returns a replay with outer whitespace equivalence and no additional writes', async () => {
    const fixture = await createCase();
    const key = `replay-${randomUUID()}`;
    const created = await postDecision(
      fixture.caseId,
      key,
      validPayload(1, FindingReviewIdentityConclusion.SAME_ASSET, '  Justificativa original.  '),
    );
    const createdBody = responseBody<DecisionBody>(created);
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const effectsBefore = await decisionEffects(fixture.caseId);
    const replay = await postDecision(
      fixture.caseId,
      key,
      validPayload(1, FindingReviewIdentityConclusion.SAME_ASSET, '\nJustificativa original.\t'),
    );
    const replayBody = responseBody<DecisionBody>(replay);

    expect([created.status, replay.status]).toEqual([201, 200]);
    expect(replayBody.decision).toEqual(createdBody.decision);
    expect(replayBody.idempotentReplay).toBe(true);
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(caseBefore);
    expect(await decisionEffects(fixture.caseId)).toEqual(effectsBefore);
  });

  it('replays the original decision after the case version and status advance', async () => {
    const fixture = await createCase();
    const key = `advanced-replay-${randomUUID()}`;
    const created = await postDecision(fixture.caseId, key, validPayload(1));
    const createdBody = responseBody<DecisionBody>(created);
    await request(server)
      .patch(`/conflict-review-cases/${fixture.caseId}/status`)
      .send({ status: 'OPEN', expectedVersion: 2 })
      .expect(200);
    const stateBeforeReplay = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
    });
    const effectsBefore = await decisionEffects(fixture.caseId);

    const replay = await postDecision(fixture.caseId, key, validPayload(1));
    expect(replay.status).toBe(200);
    expect(responseBody<DecisionBody>(replay).decision).toEqual(createdBody.decision);
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(stateBeforeReplay);
    expect(await decisionEffects(fixture.caseId)).toEqual(effectsBefore);
  });

  it.each([
    ['conclusion', (payload: Record<string, unknown>) => ({ ...payload, identityConclusion: 'DIFFERENT_ASSETS' })],
    ['justification', (payload: Record<string, unknown>) => ({ ...payload, justification: 'Outro conteúdo.' })],
    ['expectedVersion', (payload: Record<string, unknown>) => ({ ...payload, expectedVersion: 2 })],
  ] as const)('rejects reuse of the same key with different %s', async (_label, mutate) => {
    const fixture = await createCase();
    const key = `reuse-${randomUUID()}`;
    const payload = validPayload(1);
    await postDecision(fixture.caseId, key, payload).expect(201);
    const response = await postDecision(fixture.caseId, key, mutate(payload));
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 1, events: 1, audits: 1 });
  });

  it('rejects reuse of the same key for another case', async () => {
    const first = await createCase();
    const second = await createCase();
    const key = `cross-case-${randomUUID()}`;
    await postDecision(first.caseId, key, validPayload(1)).expect(201);
    const secondBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: second.caseId } });
    const response = await postDecision(second.caseId, key, validPayload(1));
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: second.caseId } }))
      .toEqual(secondBefore);
    expect(await decisionEffects(second.caseId)).toEqual({ decisions: 0, events: 0, audits: 0 });
  });

  it('gives idempotency reuse precedence over the current stale version', async () => {
    const fixture = await createCase();
    const key = `precedence-${randomUUID()}`;
    await postDecision(fixture.caseId, key, validPayload(1)).expect(201);
    await request(server)
      .patch(`/conflict-review-cases/${fixture.caseId}/status`)
      .send({ status: 'OPEN', expectedVersion: 2 })
      .expect(200);
    const response = await postDecision(
      fixture.caseId,
      key,
      validPayload(1, FindingReviewIdentityConclusion.SAME_ASSET, 'Payload diferente.'),
    );
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it.each([
    ['same conclusion', FindingReviewIdentityConclusion.SAME_ASSET, FindingReviewIdentityConclusion.SAME_ASSET],
    ['different conclusions', FindingReviewIdentityConclusion.SAME_ASSET, FindingReviewIdentityConclusion.DIFFERENT_ASSETS],
  ] as const)('allows one winner for concurrent different keys with %s', async (_label, firstConclusion, secondConclusion) => {
    const fixture = await createCase();
    const [first, second] = await Promise.all([
      postDecision(fixture.caseId, `race-a-${randomUUID()}`, validPayload(1, firstConclusion)),
      postDecision(fixture.caseId, `race-b-${randomUUID()}`, validPayload(1, secondConclusion)),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 1, events: 1, audits: 1 });
    expect((await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } })).version)
      .toBe(2);
  });

  it('deduplicates concurrent requests with the same key and payload', async () => {
    const fixture = await createCase();
    const key = `race-same-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postDecision(fixture.caseId, key, validPayload(1)),
      postDecision(fixture.caseId, key, validPayload(1)),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(responseBody<DecisionBody>(first).decision.id).toBe(
      responseBody<DecisionBody>(second).decision.id,
    );
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 1, events: 1, audits: 1 });
  });

  it('rejects concurrent different payloads that reuse the same key', async () => {
    const fixture = await createCase();
    const key = `race-different-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postDecision(fixture.caseId, key, validPayload(1, FindingReviewIdentityConclusion.SAME_ASSET)),
      postDecision(fixture.caseId, key, validPayload(1, FindingReviewIdentityConclusion.DIFFERENT_ASSETS)),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(responseBody<ErrorBody>(rejected).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 1, events: 1, audits: 1 });
  });

  it('returns controlled errors for missing case and stale version', async () => {
    const missing = await postDecision(randomUUID(), `missing-${randomUUID()}`, validPayload(1));
    expect(missing.status).toBe(404);
    expect(responseBody<ErrorBody>(missing).code).toBe('FINDING_REVIEW_CASE_NOT_FOUND');

    const fixture = await createCase({ version: 2 });
    const stale = await postDecision(fixture.caseId, `stale-${randomUUID()}`, validPayload(1));
    expect(stale.status).toBe(409);
    expect(responseBody<ErrorBody>(stale).code).toBe('FINDING_REVIEW_CASE_VERSION_CONFLICT');
  });

  it.each([
    FindingReviewCaseStatus.OPEN,
    FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
    FindingReviewCaseStatus.RESOLVED,
  ])('rejects ineligible status %s without side effects', async (status) => {
    const fixture = await createCase({ status });
    const response = await postDecision(fixture.caseId, `status-${randomUUID()}`, validPayload(1));
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_CASE_DECISION_NOT_ALLOWED');
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 0, events: 0, audits: 0 });
  });

  it('rejects conclusions absent from reviewOptions and cases with one historical asset', async () => {
    const incompatible = await createCase({ reviewOptions: ['NEEDS_MORE_EVIDENCE'] });
    const oneAsset = await createCase({ assetCount: 1 });
    for (const fixture of [incompatible, oneAsset]) {
      const response = await postDecision(fixture.caseId, `eligibility-${randomUUID()}`, validPayload(1));
      expect(response.status).toBe(422);
      expect(responseBody<ErrorBody>(response).code).toBe(
        'FINDING_REVIEW_IDENTITY_CONCLUSION_NOT_ALLOWED',
      );
      expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 0, events: 0, audits: 0 });
    }
  });

  it('rejects an incompatible snapshot without writes', async () => {
    const fixture = await createCase({ malformedSnapshot: true });
    const response = await postDecision(fixture.caseId, `snapshot-${randomUUID()}`, validPayload(1));
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe(
      'FINDING_REVIEW_CASE_SNAPSHOT_INCOMPATIBLE',
    );
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 0, events: 0, audits: 0 });
  });

  it.each([
    [undefined, 'FINDING_REVIEW_DECISION_JUSTIFICATION_REQUIRED'],
    ['   \n\t', 'FINDING_REVIEW_DECISION_JUSTIFICATION_REQUIRED'],
    ['x'.repeat(MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH + 1), 'INVALID_FINDING_REVIEW_DECISION_JUSTIFICATION'],
  ])('rejects invalid justification %p with controlled error', async (justification, code) => {
    const fixture = await createCase();
    const payload = validPayload(1);
    if (justification === undefined) delete payload.justification;
    else payload.justification = justification;
    const response = await postDecision(fixture.caseId, `justification-${randomUUID()}`, payload);
    expect(response.status).toBe(400);
    expect(responseBody<ErrorBody>(response).code).toBe(code);
    expect(await decisionEffects(fixture.caseId)).toEqual({ decisions: 0, events: 0, audits: 0 });
  });

  it('accepts exactly 1000 characters and rejects additional fields and invalid conclusions', async () => {
    const accepted = await createCase();
    await postDecision(
      accepted.caseId,
      `limit-${randomUUID()}`,
      validPayload(1, FindingReviewIdentityConclusion.SAME_ASSET, 'x'.repeat(1_000)),
    ).expect(201);

    const extra = await createCase();
    await postDecision(extra.caseId, `extra-${randomUUID()}`, {
      ...validPayload(1),
      comment: 'não permitido',
    }).expect(400);

    const invalid = await createCase();
    await postDecision(invalid.caseId, `enum-${randomUUID()}`, {
      ...validPayload(1),
      identityConclusion: 'NOT_A_CONCLUSION',
    }).expect(400);
  });

  it('rejects absent or invalid Idempotency-Key and disables creation and replay with the feature', async () => {
    const fixture = await createCase();
    expect((await postDecision(fixture.caseId, undefined, validPayload(1))).status).toBe(400);
    expect((await postDecision(fixture.caseId, 'chave inválida', validPayload(1))).status).toBe(400);

    const key = `flag-${randomUUID()}`;
    await postDecision(fixture.caseId, key, validPayload(1)).expect(201);
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    const replay = await postDecision(fixture.caseId, key, validPayload(1));
    expect(replay.status).toBe(503);
    expect(responseBody<ErrorBody>(replay).code).toBe('FINDING_REVIEW_CASES_DISABLED');
  });

  async function expectRollback(step: FailureStep) {
    const fixture = await createCase();
    const key = `rollback-${step}-${randomUUID()}`;
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const effectsBefore = await decisionEffects(fixture.caseId);
    const inventoryBefore = await inventoryCounts();
    prisma.failNextTransactionAt(step);
    let failed: Awaited<ReturnType<typeof postDecision>>;
    try {
      failed = await postDecision(fixture.caseId, key, validPayload(1));
    } finally {
      prisma.clearFailure();
    }
    expect(failed.status).toBe(500);
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(caseBefore);
    expect(await decisionEffects(fixture.caseId)).toEqual(effectsBefore);
    expect(await inventoryCounts()).toEqual(inventoryBefore);

    const retry = await postDecision(fixture.caseId, key, validPayload(1));
    expect(retry.status).toBe(201);
    expect(responseBody<DecisionBody>(retry).idempotentReplay).toBe(false);
  }

  it.each(['decision', 'event', 'audit'] as const)(
    'rolls back the complete PostgreSQL transaction when %s creation fails',
    async (step) => expectRollback(step),
  );

  it('adds currentDecision and ordered decisionHistory without exposing fingerprints', async () => {
    const empty = await createCase();
    const emptyDetail = await request(server).get(`/conflict-review-cases/${empty.caseId}`).expect(200);
    expect(responseBody<{ currentDecision: unknown; decisionHistory: unknown[] }>(emptyDetail))
      .toEqual(expect.objectContaining({ currentDecision: null, decisionHistory: [] }));

    const historical = await createCase({ version: 3 });
    const first = await prisma.findingReviewDecision.create({
      data: {
        caseId: historical.caseId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Primeira decisão histórica.',
        caseVersion: 2,
        createdBy: 'atlas-mvp-user',
        requestFingerprint: sha256(`history-2:${testRunId}:${historical.caseId}`),
      },
    });
    const second = await prisma.findingReviewDecision.create({
      data: {
        caseId: historical.caseId,
        identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
        justification: 'Segunda decisão histórica.',
        caseVersion: 3,
        createdBy: 'atlas-mvp-user',
        requestFingerprint: sha256(`history-3:${testRunId}:${historical.caseId}`),
      },
    });
    const detail = await request(server)
      .get(`/conflict-review-cases/${historical.caseId}`)
      .expect(200);
    const body = responseBody<{
      currentDecision: { id: string; caseVersion: number };
      decisionHistory: Array<{ id: string; caseVersion: number }>;
    }>(detail);
    expect(body.currentDecision).toEqual(expect.objectContaining({ id: second.id, caseVersion: 3 }));
    expect(body.decisionHistory.map((decision) => [decision.id, decision.caseVersion])).toEqual([
      [first.id, 2],
      [second.id, 3],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/requestFingerprint|request_fingerprint/);
  });

  it('exposes only safe decision metadata in the case history', async () => {
    const fixture = await createCase();
    const key = `safe-history-${randomUUID()}`;
    const created = await postDecision(fixture.caseId, key, validPayload(1));
    const decision = responseBody<DecisionBody>(created).decision;
    const detail = await request(server).get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    const decisionEvent = responseBody<{
      events: Array<{ eventType: string; metadata: Record<string, string> | null }>;
    }>(detail).events.find((event) => event.eventType === FINDING_REVIEW_DECISION_RECORDED_EVENT);
    expect(decisionEvent?.metadata).toEqual({
      decisionId: decision.id,
      identityConclusion: decision.identityConclusion,
    });
    expect(JSON.stringify(decisionEvent)).not.toContain(decisionRequestFingerprint(key));
    expect(JSON.stringify(decisionEvent)).not.toContain(decision.justification);
  });
});
