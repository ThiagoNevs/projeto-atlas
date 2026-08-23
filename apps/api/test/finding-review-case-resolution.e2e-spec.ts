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
import { CreateFindingReviewCaseResolutionDto } from '../src/finding-review-cases/dto/create-finding-review-case-resolution.dto';
import {
  FINDING_REVIEW_CASE_RESOLVED_EVENT,
  MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH,
  resolutionRequestFingerprint,
} from '../src/finding-review-cases/finding-review-case-resolution';
import { sha256 } from '../src/finding-review-cases/finding-review-case-creation';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import {
  FindingReviewCaseStatus,
  FindingReviewIdentityConclusion,
  FindingReviewStaleness,
  type Prisma,
} from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

type FailureStep = 'event' | 'audit';
type UnknownFunction = (...args: unknown[]) => unknown;

class ResolutionFaultInjectingPrismaService extends PrismaService {
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
        const step = property === 'findingReviewEvent'
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
                throw new Error(`TEST_RESOLUTION_TRANSACTION_FAILURE:${step}`);
              }
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }
}

interface ResolutionBody {
  idempotentReplay: boolean;
  resolution: {
    eventId: string;
    caseId: string;
    decisionId: string;
    identityConclusion: FindingReviewIdentityConclusion;
    justification: string;
    versionBefore: number;
    versionAfter: number;
    previousStatus: FindingReviewCaseStatus;
    status: FindingReviewCaseStatus;
    resolvedBy: string;
    resolvedAt: string;
  };
}

interface ErrorBody {
  statusCode: number;
  code?: string;
  message: string | string[];
}

interface CaseFixture {
  caseId: string;
  assetIds: string[];
  decisionId: string | null;
  version: number;
  activeReviewSubjectKey: string | null;
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('Finding review resolution helpers and DTO', () => {
  it('accepts structural fields and leaves justification normalization to the service', async () => {
    const dto = plainToInstance(CreateFindingReviewCaseResolutionDto, {
      expectedVersion: 2,
      justification: `  ${'x'.repeat(MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH + 1)}  `,
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.justification).toBe(
      `  ${'x'.repeat(MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH + 1)}  `,
    );
  });

  it('rejects invalid structural values without applying functional justification rules', async () => {
    const dto = plainToInstance(CreateFindingReviewCaseResolutionDto, {
      expectedVersion: 1.5,
      justification: 123,
    });
    expect((await validate(dto)).map((error) => error.property).sort()).toEqual([
      'expectedVersion',
      'justification',
    ]);
  });

  it('scopes deterministic and case-sensitive fingerprints by case', () => {
    const firstCase = randomUUID();
    const secondCase = randomUUID();
    expect(resolutionRequestFingerprint(firstCase, 'resolution-ABC')).toBe(
      resolutionRequestFingerprint(firstCase, 'resolution-ABC'),
    );
    expect(resolutionRequestFingerprint(firstCase, 'resolution-ABC')).not.toBe(
      resolutionRequestFingerprint(firstCase, 'resolution-abc'),
    );
    expect(resolutionRequestFingerprint(firstCase, 'resolution-ABC')).not.toBe(
      resolutionRequestFingerprint(secondCase, 'resolution-ABC'),
    );
  });
});

describe('POST /conflict-review-cases/:id/resolutions (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: ResolutionFaultInjectingPrismaService;
  const testRunId = randomUUID();
  const caseIds = new Set<string>();
  const assetIds = new Set<string>();
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useClass(ResolutionFaultInjectingPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<ResolutionFaultInjectingPrismaService>(PrismaService);
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
    withDecision?: boolean;
    identityConclusion?: FindingReviewIdentityConclusion;
  } = {}): Promise<CaseFixture> {
    const token = randomUUID();
    const caseId = randomUUID();
    const version = options.version ?? 2;
    const status = options.status ?? FindingReviewCaseStatus.IN_REVIEW;
    const withDecision = options.withDecision ?? true;
    const activeReviewSubjectKey = ([
      FindingReviewCaseStatus.OPEN,
      FindingReviewCaseStatus.IN_REVIEW,
      FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
    ] as FindingReviewCaseStatus[]).includes(status)
      ? sha256(`active:${testRunId}:${token}`)
      : null;
    const relatedAssetIds = [randomUUID(), randomUUID()];
    const createdAt = new Date('2026-08-23T12:00:00.000Z');

    await prisma.asset.createMany({
      data: relatedAssetIds.map((id, index) => ({
        id,
        canonicalKey: `atlas-resolution-test:${testRunId}:${token}:${index}`,
        name: `RESOLUTION-${token.slice(0, 8)}-${index}`,
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
        originalSnapshot: {
          snapshotVersion: 1,
          affectedAssets: relatedAssetIds.map((assetId) => ({ assetId, name: null })),
          reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
        },
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
            assetNameAtCreation: `RESOLUTION-${token.slice(0, 8)}-${index}`,
            role: 'AFFECTED_ASSET',
          })),
        },
        events: {
          create: {
            eventType: 'CASE_CREATED',
            versionBefore: null,
            versionAfter: 1,
            actorId: 'atlas-mvp-user',
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
          identityConclusion: options.identityConclusion
            ?? FindingReviewIdentityConclusion.SAME_ASSET,
          justification: 'Decisão de identidade registrada antes da resolução.',
          caseVersion: version,
          createdBy: 'atlas-mvp-user',
          requestFingerprint: sha256(`decision:${testRunId}:${token}`),
          createdAt,
        },
      });
      decisionId = decision.id;
    }

    return { caseId, assetIds: relatedAssetIds, decisionId, version, activeReviewSubjectKey };
  }

  function postResolution(
    caseId: string,
    key: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const call = request(server)
      .post(`/conflict-review-cases/${caseId}/resolutions`)
      .send(payload);
    return key === undefined ? call : call.set('Idempotency-Key', key);
  }

  function validPayload(
    expectedVersion = 2,
    justification = 'Investigação concluída com base nas evidências.',
  ): Record<string, unknown> {
    return { expectedVersion, justification };
  }

  async function resolutionEffects(caseId: string) {
    return {
      events: await prisma.findingReviewEvent.count({
        where: { caseId, eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT },
      }),
      audits: await prisma.auditLog.count({
        where: {
          entityType: 'FindingReviewCase',
          entityId: caseId,
          action: FINDING_REVIEW_CASE_RESOLVED_EVENT,
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
    'resolves an IN_REVIEW case with %s without mutating inventory',
    async (identityConclusion) => {
      const fixture = await createCase({
        identityConclusion,
        staleness: FindingReviewStaleness.REQUIRES_REFRESH,
      });
      const key = `resolve-${identityConclusion}-${randomUUID()}`;
      const inventoryBefore = await inventoryCounts();
      const response = await postResolution(
        fixture.caseId,
        key,
        validPayload(fixture.version, '  Linha um.\nLinha dois.  '),
      );
      const body = responseBody<ResolutionBody>(response);

      expect(response.status).toBe(201);
      expect(body).toEqual({
        idempotentReplay: false,
        resolution: expect.objectContaining({
          caseId: fixture.caseId,
          decisionId: fixture.decisionId,
          identityConclusion,
          justification: 'Linha um.\nLinha dois.',
          versionBefore: fixture.version,
          versionAfter: fixture.version + 1,
          previousStatus: FindingReviewCaseStatus.IN_REVIEW,
          status: FindingReviewCaseStatus.RESOLVED,
          resolvedBy: 'atlas-mvp-user',
        }),
      });
      expect(new Date(body.resolution.resolvedAt).toISOString()).toBe(body.resolution.resolvedAt);

      const persisted = await prisma.findingReviewCase.findUniqueOrThrow({
        where: { id: fixture.caseId },
      });
      expect(persisted).toEqual(expect.objectContaining({
        status: FindingReviewCaseStatus.RESOLVED,
        staleness: FindingReviewStaleness.REQUIRES_REFRESH,
        version: fixture.version + 1,
        activeReviewSubjectKey: null,
      }));
      expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
      expect(await inventoryCounts()).toEqual(inventoryBefore);
      expect(await prisma.findingReviewDecision.count({ where: { caseId: fixture.caseId } })).toBe(1);
    },
  );

  it('persists one canonical CASE_RESOLVED event and AuditLog without exposing the key', async () => {
    const fixture = await createCase();
    const key = `canonical-resolution-${randomUUID()}`;
    const response = await postResolution(fixture.caseId, key, validPayload());
    const body = responseBody<ResolutionBody>(response);
    expect(response.status).toBe(201);

    const fingerprint = resolutionRequestFingerprint(fixture.caseId, key);
    const event = await prisma.findingReviewEvent.findUniqueOrThrow({
      where: { caseId_requestId: { caseId: fixture.caseId, requestId: fingerprint } },
    });
    expect(event).toEqual(expect.objectContaining({
      id: body.resolution.eventId,
      eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
      versionBefore: 2,
      versionAfter: 3,
      actorId: 'atlas-mvp-user',
      previousStatus: FindingReviewCaseStatus.IN_REVIEW,
      nextStatus: FindingReviewCaseStatus.RESOLVED,
      metadata: {
        decisionId: fixture.decisionId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: body.resolution.justification,
      },
    }));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: fixture.caseId, action: FINDING_REVIEW_CASE_RESOLVED_EVENT },
    });
    expect(audit).toEqual(expect.objectContaining({
      actorType: 'USER',
      actorId: 'atlas-mvp-user',
      entityType: 'FindingReviewCase',
    }));
    expect(JSON.stringify([event.metadata, audit.metadata, response.body])).not.toContain(key);
    expect(JSON.stringify(response.body)).not.toContain(fingerprint);
    expect(JSON.stringify(response.body)).not.toMatch(/requestId|requestFingerprint|Idempotency-Key/);
  });

  it('returns a replay after RESOLVED with semantic whitespace equivalence and no writes', async () => {
    const fixture = await createCase();
    const key = `replay-resolution-${randomUUID()}`;
    const created = await postResolution(
      fixture.caseId,
      key,
      validPayload(2, '  Justificativa original.  '),
    );
    const createdBody = responseBody<ResolutionBody>(created);
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const effectsBefore = await resolutionEffects(fixture.caseId);
    const replay = await postResolution(
      fixture.caseId,
      key,
      validPayload(2, '\nJustificativa original.\t'),
    );

    expect([created.status, replay.status]).toEqual([201, 200]);
    expect(responseBody<ResolutionBody>(replay)).toEqual({
      idempotentReplay: true,
      resolution: createdBody.resolution,
    });
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(caseBefore);
    expect(await resolutionEffects(fixture.caseId)).toEqual(effectsBefore);
  });

  it.each([
    ['justification', validPayload(2, 'Outro conteúdo.')],
    ['expectedVersion', validPayload(3)],
  ] as const)('rejects reuse of the same key with different %s', async (_label, reusedPayload) => {
    const fixture = await createCase();
    const key = `reuse-resolution-${randomUUID()}`;
    await postResolution(fixture.caseId, key, validPayload()).expect(201);
    const response = await postResolution(fixture.caseId, key, reusedPayload);
    expect(response.status).toBe(409);
    expect(responseBody<ErrorBody>(response).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('allows the same Idempotency-Key independently for different cases', async () => {
    const first = await createCase();
    const second = await createCase();
    const key = `case-scoped-resolution-${randomUUID()}`;
    const [firstResponse, secondResponse] = await Promise.all([
      postResolution(first.caseId, key, validPayload()),
      postResolution(second.caseId, key, validPayload()),
    ]);
    expect([firstResponse.status, secondResponse.status]).toEqual([201, 201]);
    expect(await resolutionEffects(first.caseId)).toEqual({ events: 1, audits: 1 });
    expect(await resolutionEffects(second.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('deduplicates concurrent requests with the same key and payload', async () => {
    const fixture = await createCase();
    const key = `race-same-resolution-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postResolution(fixture.caseId, key, validPayload()),
      postResolution(fixture.caseId, key, validPayload()),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(responseBody<ResolutionBody>(first).resolution.eventId).toBe(
      responseBody<ResolutionBody>(second).resolution.eventId,
    );
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
    expect((await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } })).version)
      .toBe(3);
  });

  it('rejects concurrent different payloads that reuse the same key', async () => {
    const fixture = await createCase();
    const key = `race-reused-resolution-${randomUUID()}`;
    const [first, second] = await Promise.all([
      postResolution(fixture.caseId, key, validPayload(2, 'Primeiro conteúdo.')),
      postResolution(fixture.caseId, key, validPayload(2, 'Segundo conteúdo.')),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(responseBody<ErrorBody>(rejected).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('allows one winner for concurrent different keys at the same version', async () => {
    const fixture = await createCase();
    const [first, second] = await Promise.all([
      postResolution(fixture.caseId, `race-a-${randomUUID()}`, validPayload()),
      postResolution(fixture.caseId, `race-b-${randomUUID()}`, validPayload()),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(responseBody<ErrorBody>(rejected).code).toBe(
      'FINDING_REVIEW_CASE_VERSION_CONFLICT',
    );
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 1, audits: 1 });
  });

  it('requires the current decision after checking the current version and status', async () => {
    const fixture = await createCase({ withDecision: false });
    const before = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const response = await postResolution(
      fixture.caseId,
      `decision-required-${randomUUID()}`,
      validPayload(),
    );
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe('FINDING_REVIEW_CASE_DECISION_REQUIRED');
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(before);
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
  });

  it.each([
    FindingReviewCaseStatus.OPEN,
    FindingReviewCaseStatus.WAITING_FOR_EVIDENCE,
    FindingReviewCaseStatus.RESOLVED,
    FindingReviewCaseStatus.DISMISSED,
    FindingReviewCaseStatus.CANCELLED,
  ])('rejects a new resolution from status %s without side effects', async (status) => {
    const fixture = await createCase({ status });
    const before = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const response = await postResolution(
      fixture.caseId,
      `status-resolution-${randomUUID()}`,
      validPayload(),
    );
    expect(response.status).toBe(422);
    expect(responseBody<ErrorBody>(response).code).toBe(
      'FINDING_REVIEW_CASE_RESOLUTION_NOT_ALLOWED',
    );
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(before);
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
  });

  it.each([
    [undefined, 'FINDING_REVIEW_RESOLUTION_JUSTIFICATION_REQUIRED'],
    ['  \n\t ', 'FINDING_REVIEW_RESOLUTION_JUSTIFICATION_REQUIRED'],
    ['x'.repeat(MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH + 1), 'INVALID_FINDING_REVIEW_RESOLUTION_JUSTIFICATION'],
  ])('rejects invalid justification %p with a controlled error', async (justification, code) => {
    const fixture = await createCase();
    const payload = validPayload();
    if (justification === undefined) delete payload.justification;
    else payload.justification = justification;
    const response = await postResolution(
      fixture.caseId,
      `justification-resolution-${randomUUID()}`,
      payload,
    );
    expect(response.status).toBe(400);
    expect(responseBody<ErrorBody>(response).code).toBe(code);
    expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
  });

  it('accepts exactly 1000 characters and preserves internal whitespace', async () => {
    const fixture = await createCase();
    const justification = `  ${'x'.repeat(499)}\n${'y'.repeat(500)}  `;
    const response = await postResolution(
      fixture.caseId,
      `limit-resolution-${randomUUID()}`,
      validPayload(2, justification),
    );
    expect(response.status).toBe(201);
    expect(responseBody<ResolutionBody>(response).resolution.justification).toBe(
      `${'x'.repeat(499)}\n${'y'.repeat(500)}`,
    );
  });

  it.each([undefined, 'x'.repeat(MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH + 1)])(
    'gives a stale version precedence over invalid justification %p',
    async (justification) => {
      const fixture = await createCase({ version: 3 });
      const payload = validPayload(2);
      if (justification === undefined) delete payload.justification;
      else payload.justification = justification;
      const response = await postResolution(
        fixture.caseId,
        `precedence-resolution-${randomUUID()}`,
        payload,
      );
      expect(response.status).toBe(409);
      expect(responseBody<ErrorBody>(response).code).toBe(
        'FINDING_REVIEW_CASE_VERSION_CONFLICT',
      );
      expect(await resolutionEffects(fixture.caseId)).toEqual({ events: 0, audits: 0 });
    },
  );

  it('returns controlled errors for invalid identifiers, missing cases and invalid bodies', async () => {
    const invalidId = await postResolution('not-a-uuid', `invalid-${randomUUID()}`, validPayload());
    expect(invalidId.status).toBe(400);
    expect(responseBody<ErrorBody>(invalidId).code).toBe('INVALID_FINDING_REVIEW_CASE_ID');

    const missing = await postResolution(randomUUID(), `missing-${randomUUID()}`, validPayload());
    expect(missing.status).toBe(404);
    expect(responseBody<ErrorBody>(missing).code).toBe('FINDING_REVIEW_CASE_NOT_FOUND');

    const fixture = await createCase();
    await postResolution(fixture.caseId, `extra-${randomUUID()}`, {
      ...validPayload(),
      comment: 'campo não permitido',
    }).expect(400);
    await postResolution(fixture.caseId, `type-${randomUUID()}`, {
      expectedVersion: '2',
      justification: 'Conteúdo.',
    }).expect(400);
  });

  it('rejects absent or invalid Idempotency-Key and disables creation and replay with the feature', async () => {
    const fixture = await createCase();
    expect((await postResolution(fixture.caseId, undefined, validPayload())).status).toBe(400);
    expect((await postResolution(fixture.caseId, 'chave inválida', validPayload())).status).toBe(400);

    const key = `flag-resolution-${randomUUID()}`;
    await postResolution(fixture.caseId, key, validPayload()).expect(201);
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    const replay = await postResolution(fixture.caseId, key, validPayload());
    expect(replay.status).toBe(503);
    expect(responseBody<ErrorBody>(replay).code).toBe('FINDING_REVIEW_CASES_DISABLED');
  });

  it('exposes safe CASE_RESOLVED metadata in detail without exposing requestId', async () => {
    const fixture = await createCase();
    const key = `safe-resolution-${randomUUID()}`;
    const created = await postResolution(fixture.caseId, key, validPayload());
    const resolution = responseBody<ResolutionBody>(created).resolution;
    const detail = await request(server).get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    const resolutionEvent = responseBody<{
      events: Array<Record<string, unknown>>;
    }>(detail).events.find((event) => event.eventType === FINDING_REVIEW_CASE_RESOLVED_EVENT);

    expect(resolutionEvent).toEqual(expect.objectContaining({
      eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
      metadata: {
        decisionId: fixture.decisionId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: resolution.justification,
      },
    }));
    expect(JSON.stringify(resolutionEvent)).not.toMatch(/requestId|requestFingerprint/);
    expect(JSON.stringify(resolutionEvent)).not.toContain(
      resolutionRequestFingerprint(fixture.caseId, key),
    );
  });

  async function expectRollback(step: FailureStep) {
    const fixture = await createCase();
    const key = `rollback-resolution-${step}-${randomUUID()}`;
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } });
    const effectsBefore = await resolutionEffects(fixture.caseId);
    const inventoryBefore = await inventoryCounts();
    prisma.failNextTransactionAt(step);
    let failed: Awaited<ReturnType<typeof postResolution>>;
    try {
      failed = await postResolution(fixture.caseId, key, validPayload());
    } finally {
      prisma.clearFailure();
    }
    expect(failed.status).toBe(500);
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id: fixture.caseId } }))
      .toEqual(caseBefore);
    expect(await resolutionEffects(fixture.caseId)).toEqual(effectsBefore);
    expect(await inventoryCounts()).toEqual(inventoryBefore);
    expect(caseBefore.activeReviewSubjectKey).toBe(fixture.activeReviewSubjectKey);

    const retry = await postResolution(fixture.caseId, key, validPayload());
    expect(retry.status).toBe(201);
    expect(responseBody<ResolutionBody>(retry).idempotentReplay).toBe(false);
  }

  it.each(['event', 'audit'] as const)(
    'rolls back the complete PostgreSQL transaction when %s creation fails',
    async (step) => expectRollback(step),
  );
});
