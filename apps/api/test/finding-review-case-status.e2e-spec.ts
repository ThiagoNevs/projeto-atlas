import { createHash, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { UpdateFindingReviewCaseStatusDto } from '../src/finding-review-cases/dto/update-finding-review-case-status.dto';
import {
  ACTIVE_FINDING_REVIEW_CASE_STATUSES,
  FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
  MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION,
  isAllowedFindingReviewCaseStatusTransition,
  type ActiveFindingReviewCaseStatus,
} from '../src/finding-review-cases/finding-review-case-status-transition';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import { FindingReviewCasesService } from '../src/finding-review-cases/finding-review-cases.service';
import {
  FindingReviewCaseStatus,
  FindingReviewStaleness,
  type Prisma,
} from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

type FailureStep = 'event' | 'audit';
type UnknownFunction = (...args: unknown[]) => unknown;

class StatusFaultInjectingPrismaService extends PrismaService {
  private failureStep: FailureStep | null = null;
  private transactionCalls = 0;

  constructor() {
    super();
    const realTransaction = this.$transaction.bind(this) as unknown as UnknownFunction;
    this.$transaction = ((input: unknown, ...options: unknown[]) => {
      this.transactionCalls += 1;
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

  getTransactionCalls(): number {
    return this.transactionCalls;
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
                throw new Error(`TEST_STATUS_TRANSACTION_FAILURE:${step}`);
              }
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('Finding review case status transition contract', () => {
  it.each(ACTIVE_FINDING_REVIEW_CASE_STATUSES)('accepts active status %s', async (status) => {
    const dto = plainToInstance(UpdateFindingReviewCaseStatusDto, { status, expectedVersion: 1 });
    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    [{}, ['status', 'expectedVersion']],
    [{ status: 'OPEN' }, ['expectedVersion']],
    [{ expectedVersion: 1 }, ['status']],
    [{ status: 'UNKNOWN', expectedVersion: 1 }, ['status']],
    [{ status: 'RESOLVED', expectedVersion: 1 }, ['status']],
    [{ status: 'DISMISSED', expectedVersion: 1 }, ['status']],
    [{ status: 'CANCELLED', expectedVersion: 1 }, ['status']],
    [{ status: 'OPEN', expectedVersion: 0 }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: -1 }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: 1.5 }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: '1' }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: null }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: Number.NaN }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: Number.POSITIVE_INFINITY }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: 2_147_483_647 }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: 2_147_483_648 }, ['expectedVersion']],
    [{ status: 'OPEN', expectedVersion: Number.MAX_SAFE_INTEGER }, ['expectedVersion']],
  ])('rejects invalid body %p', async (input, properties) => {
    const errors = await validate(plainToInstance(UpdateFindingReviewCaseStatusDto, input));
    for (const property of properties) {
      expect(errors.some((error) => error.property === property)).toBe(true);
    }
  });

  it('accepts the largest expectedVersion whose increment remains persistible as INT4', async () => {
    const dto = plainToInstance(UpdateFindingReviewCaseStatusDto, {
      status: 'IN_REVIEW',
      expectedVersion: MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION,
    });
    expect(await validate(dto)).toEqual([]);
    expect(MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION).toBe(2_147_483_646);
  });

  it('allows exactly the six transitions between distinct active states', () => {
    const allowed = ACTIVE_FINDING_REVIEW_CASE_STATUSES.flatMap((current) =>
      ACTIVE_FINDING_REVIEW_CASE_STATUSES.filter((next) =>
        isAllowedFindingReviewCaseStatusTransition(current, next),
      ).map((next) => `${current}->${next}`),
    );
    expect(allowed).toEqual([
      'OPEN->IN_REVIEW',
      'OPEN->WAITING_FOR_EVIDENCE',
      'IN_REVIEW->OPEN',
      'IN_REVIEW->WAITING_FOR_EVIDENCE',
      'WAITING_FOR_EVIDENCE->OPEN',
      'WAITING_FOR_EVIDENCE->IN_REVIEW',
    ]);
  });
});

describe('PATCH /conflict-review-cases/:id/status (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: StatusFaultInjectingPrismaService;
  let cases: FindingReviewCasesService;
  const testRunId = randomUUID();
  const caseIds = new Set<string>();
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useClass(StatusFaultInjectingPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get<StatusFaultInjectingPrismaService>(PrismaService);
    cases = app.get(FindingReviewCasesService);
  });

  afterAll(async () => {
    if (prisma) {
      const tracked = [...caseIds];
      await prisma.auditLog.deleteMany({
        where: { entityType: 'FindingReviewCase', entityId: { in: tracked } },
      });
      await prisma.findingReviewEvent.deleteMany({ where: { caseId: { in: tracked } } });
      await prisma.findingReviewCase.deleteMany({ where: { id: { in: tracked } } });
    }
    if (previousFlag === undefined) delete process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
    else process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = previousFlag;
    if (app) await app.close();
  });

  async function createCase(
    status: FindingReviewCaseStatus = FindingReviewCaseStatus.OPEN,
    version = 1,
  ) {
    const token = randomUUID();
    const id = randomUUID();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await prisma.findingReviewCase.create({
      data: {
        id,
        findingId: `finding_${sha256(token).slice(0, 24)}`,
        findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        policyVersion: '2026-07-conflict-v1',
        reviewSubjectKey: sha256(`subject:${testRunId}:${token}`),
        activeReviewSubjectKey: ACTIVE_FINDING_REVIEW_CASE_STATUSES.includes(
          status as ActiveFindingReviewCaseStatus,
        ) ? sha256(`active:${testRunId}:${token}`) : null,
        creationRequestFingerprint: sha256(`request:${testRunId}:${token}`),
        status,
        staleness: FindingReviewStaleness.CURRENT,
        originalSnapshot: { testRunId, token },
        originalSnapshotHash: sha256(`snapshot:${testRunId}:${token}`),
        version,
        createdBy: 'atlas-mvp-user',
        findingGeneratedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await prisma.findingReviewEvent.create({
      data: {
        caseId: id,
        eventType: 'CASE_CREATED',
        versionBefore: null,
        versionAfter: version,
        actorId: 'atlas-mvp-user',
        nextStatus: status,
        after: { status, version },
        occurredAt: createdAt,
        createdAt,
      },
    });
    caseIds.add(id);
    return id;
  }

  function patchStatus(
    id: string,
    status: string,
    expectedVersion: unknown,
    extra: Record<string, unknown> = {},
  ) {
    return request(server)
      .patch(`/conflict-review-cases/${id}/status`)
      .send({ status, expectedVersion, ...extra });
  }

  async function persistenceCounts(id: string) {
    return {
      events: await prisma.findingReviewEvent.count({ where: { caseId: id } }),
      audits: await prisma.auditLog.count({
        where: { entityType: 'FindingReviewCase', entityId: id },
      }),
    };
  }

  async function inventoryCounts() {
    const [assets, attributes, interfaces, evidence, conflicts, values, events] = await Promise.all([
      prisma.asset.count(),
      prisma.assetAttribute.count(),
      prisma.networkInterface.count(),
      prisma.assetEvidence.count(),
      prisma.conflict.count(),
      prisma.conflictValue.count(),
      prisma.assetEvent.count(),
    ]);
    return { assets, attributes, interfaces, evidence, conflicts, values, events };
  }

  it.each([
    [FindingReviewCaseStatus.OPEN, FindingReviewCaseStatus.IN_REVIEW],
    [FindingReviewCaseStatus.OPEN, FindingReviewCaseStatus.WAITING_FOR_EVIDENCE],
    [FindingReviewCaseStatus.IN_REVIEW, FindingReviewCaseStatus.OPEN],
    [FindingReviewCaseStatus.IN_REVIEW, FindingReviewCaseStatus.WAITING_FOR_EVIDENCE],
    [FindingReviewCaseStatus.WAITING_FOR_EVIDENCE, FindingReviewCaseStatus.OPEN],
    [FindingReviewCaseStatus.WAITING_FOR_EVIDENCE, FindingReviewCaseStatus.IN_REVIEW],
  ])('persists %s -> %s with event and AuditLog', async (current, next) => {
    const id = await createCase(current);
    const before = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
    const response = await patchStatus(id, next, 1);
    const body = responseBody<{ id: string; status: string; version: number; updatedAt: string }>(
      response,
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({
      id,
      status: next,
      version: 2,
      updatedAt: expect.any(String),
    });
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(before.updatedAt.getTime());

    const persisted = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
    expect(persisted.status).toBe(next);
    expect(persisted.version).toBe(2);

    const event = await prisma.findingReviewEvent.findFirstOrThrow({
      where: { caseId: id, eventType: FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT },
    });
    expect(event).toMatchObject({
      versionBefore: 1,
      versionAfter: 2,
      previousStatus: current,
      nextStatus: next,
      actorId: 'atlas-mvp-user',
      requestId: null,
      metadata: { statusBefore: current, statusAfter: next },
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'FindingReviewCase', entityId: id },
    });
    expect(audit).toMatchObject({
      actorType: 'USER',
      actorId: 'atlas-mvp-user',
      action: FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
      before: { status: current, version: 1 },
      after: { status: next, version: 2 },
    });
  });

  it('rejects same status and terminal destinations without writes', async () => {
    const id = await createCase();
    const before = await persistenceCounts(id);
    expect((await patchStatus(id, FindingReviewCaseStatus.OPEN, 1)).status).toBe(400);
    for (const terminal of ['RESOLVED', 'DISMISSED', 'CANCELLED']) {
      expect((await patchStatus(id, terminal, 1)).status).toBe(400);
    }
    expect(await persistenceCounts(id)).toEqual(before);
  });

  it('rejects an unknown case, stale version and additional field safely', async () => {
    const id = await createCase();
    const stale = await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 2);
    expect(stale.status).toBe(409);
    expect(responseBody<{ code: string }>(stale).code).toBe(
      'FINDING_REVIEW_CASE_VERSION_CONFLICT',
    );
    expect((await patchStatus(randomUUID(), FindingReviewCaseStatus.IN_REVIEW, 1)).status).toBe(404);
    expect((await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 1, { comment: 'x' })).status)
      .toBe(400);
    expect(await persistenceCounts(id)).toEqual({ events: 1, audits: 0 });
  });

  it.each([0, -1, 1.5, '1', null])(
    'rejects invalid expectedVersion %p through HTTP',
    async (expectedVersion) => {
      const id = await createCase();
      expect((await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, expectedVersion)).status)
        .toBe(400);
      expect(await persistenceCounts(id)).toEqual({ events: 1, audits: 0 });
    },
  );

  it.each([2_147_483_647, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    'rejects non-persistible expectedVersion %p before starting a transaction',
    async (expectedVersion) => {
      const id = await createCase();
      const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
      const persistenceBefore = await persistenceCounts(id);
      const transactionCallsBefore = prisma.getTransactionCalls();

      const response = await patchStatus(
        id,
        FindingReviewCaseStatus.IN_REVIEW,
        expectedVersion,
      );

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toMatch(/P2020|Prisma|out of range/i);
      expect(prisma.getTransactionCalls()).toBe(transactionCallsBefore);
      expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } })).toEqual(caseBefore);
      expect(await persistenceCounts(id)).toEqual(persistenceBefore);
    },
  );

  it('increments the largest accepted expectedVersion to the INT4 maximum', async () => {
    const id = await createCase(
      FindingReviewCaseStatus.OPEN,
      MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION,
    );

    const response = await patchStatus(
      id,
      FindingReviewCaseStatus.IN_REVIEW,
      MAX_UPDATABLE_FINDING_REVIEW_CASE_VERSION,
    );

    expect(response.status).toBe(200);
    expect(responseBody<{ version: number }>(response).version).toBe(2_147_483_647);
    const persisted = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
    expect(persisted.version).toBe(2_147_483_647);
    expect(await persistenceCounts(id)).toEqual({ events: 2, audits: 1 });
  });

  it('defensively rejects a non-persistible version when the service is called directly', async () => {
    const id = await createCase();
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
    const persistenceBefore = await persistenceCounts(id);
    const transactionCallsBefore = prisma.getTransactionCalls();

    await expect(cases.updateStatus(id, {
      status: FindingReviewCaseStatus.IN_REVIEW,
      expectedVersion: 2_147_483_647,
    })).rejects.toMatchObject({ status: 400 });

    expect(prisma.getTransactionCalls()).toBe(transactionCallsBefore);
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } })).toEqual(caseBefore);
    expect(await persistenceCounts(id)).toEqual(persistenceBefore);
  });

  it('returns 503 while the feature is disabled without writes', async () => {
    const id = await createCase();
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    let response: Awaited<ReturnType<typeof patchStatus>>;
    try {
      response = await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 1);
    } finally {
      process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    }
    expect(response.status).toBe(503);
    expect(await persistenceCounts(id)).toEqual({ events: 1, audits: 0 });
  });

  it('exposes the updated status, version and safe event through reads', async () => {
    const id = await createCase();
    expect((await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 1)).status).toBe(200);

    const detail = await request(server).get(`/conflict-review-cases/${id}`);
    expect(detail.status).toBe(200);
    expect(responseBody<{ status: string; version: number; events: Array<Record<string, unknown>> }>(
      detail,
    )).toMatchObject({
      status: 'IN_REVIEW',
      version: 2,
      events: expect.arrayContaining([
        expect.objectContaining({
          eventType: FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
          versionBefore: 1,
          versionAfter: 2,
          metadata: { statusBefore: 'OPEN', statusAfter: 'IN_REVIEW' },
        }),
      ]),
    });

    const list = await request(server).get(`/conflict-review-cases?findingId=${
      responseBody<{ findingId: string }>(detail).findingId
    }`);
    const item = responseBody<{ items: Array<Record<string, unknown>> }>(list).items[0];
    expect(item).toMatchObject({ id, status: 'IN_REVIEW', version: 2, eventCount: 2 });
  });

  it.each([1, 2])('allows only one real concurrent update with the same version (run %s)', async () => {
    const id = await createCase();
    const [first, second] = await Promise.all([
      patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 1),
      patchStatus(id, FindingReviewCaseStatus.WAITING_FOR_EVIDENCE, 1),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const persisted = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
    expect(persisted.version).toBe(2);
    expect([FindingReviewCaseStatus.IN_REVIEW, FindingReviewCaseStatus.WAITING_FOR_EVIDENCE])
      .toContain(persisted.status);
    expect(await persistenceCounts(id)).toEqual({ events: 2, audits: 1 });
  });

  async function expectRollback(step: FailureStep) {
    const id = await createCase();
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } });
    const persistenceBefore = await persistenceCounts(id);
    const inventoryBefore = await inventoryCounts();
    prisma.failNextTransactionAt(step);
    let response: Awaited<ReturnType<typeof patchStatus>>;
    try {
      response = await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 1);
    } finally {
      prisma.clearFailure();
    }
    expect(response.status).toBe(500);
    expect(await prisma.findingReviewCase.findUniqueOrThrow({ where: { id } })).toEqual(caseBefore);
    expect(await persistenceCounts(id)).toEqual(persistenceBefore);
    expect(await inventoryCounts()).toEqual(inventoryBefore);
    const retry = await patchStatus(id, FindingReviewCaseStatus.IN_REVIEW, 1);
    expect(retry.status).toBe(200);
    expect(await persistenceCounts(id)).toEqual({ events: 2, audits: 1 });
  }

  it('rolls back status and version when event creation fails', async () => {
    await expectRollback('event');
  });

  it('rolls back status, version and event when AuditLog creation fails', async () => {
    await expectRollback('audit');
  });
});
