import { createHash, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  CONFLICT_FINDING_ID_PATTERN,
  createConflictFindingId,
} from '../src/conflict-analysis/conflict-finding-id';
import { ConflictFindingsService } from '../src/conflict-analysis/conflict-findings.service';
import {
  FindingReviewCaseStatus,
  FindingReviewStaleness,
  type Prisma,
} from '../src/generated/prisma/client';
import {
  CANONICAL_POSITIVE_DECIMAL_PATTERN,
  FINDING_REVIEW_TIMESTAMP_PATTERN,
  isFindingReviewTimestamp,
  parseFindingReviewTimestamp,
  QueryFindingReviewCasesDto,
} from '../src/finding-review-cases/dto/query-finding-review-cases.dto';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import { FindingReviewCasesService } from '../src/finding-review-cases/finding-review-cases.service';
import { PrismaService } from '../src/prisma/prisma.service';

const FINDING_TYPES = [
  'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  'SHARED_IP_DIFFERENT_HOSTNAMES',
  'HOSTNAME_DIVERGENCE_ON_ASSET',
] as const;

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('Finding review case read contracts', () => {
  it('applies pagination and sorting defaults', async () => {
    const dto = plainToInstance(QueryFindingReviewCasesDto, {});
    expect(await validate(dto)).toEqual([]);
    expect(dto).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }),
    );
  });

  it('keeps the canonical finding id generator and validator on the same fixed contract', () => {
    const findingId = createConflictFindingId('atlas-finding-contract');
    expect(findingId).toBe('finding_d94982d9d5954aab33ea09a0');
    expect(CONFLICT_FINDING_ID_PATTERN.test(findingId)).toBe(true);
  });

  it.each([
    [{ page: 0 }, 'page'],
    [{ page: -1 }, 'page'],
    [{ page: 1.5 }, 'page'],
    [{ page: 'invalid' }, 'page'],
    [{ page: '1e2' }, 'page'],
    [{ page: ' 1 ' }, 'page'],
    [{ page: '9007199254740993' }, 'page'],
    [{ pageSize: 0 }, 'pageSize'],
    [{ pageSize: 101 }, 'pageSize'],
    [{ status: 'UNKNOWN' }, 'status'],
    [{ staleness: 'UNKNOWN' }, 'staleness'],
    [{ findingType: 'UNKNOWN' }, 'findingType'],
    [{ sortBy: 'creationRequestFingerprint' }, 'sortBy'],
    [{ sortDirection: 'sideways' }, 'sortDirection'],
    [{ assetId: 'not-a-uuid' }, 'assetId'],
    [{ createdFrom: 'not-a-date' }, 'createdFrom'],
    [{ createdFrom: '2026-07-20' }, 'createdFrom'],
    [{ createdFrom: '2026-07-20T00:00:00' }, 'createdFrom'],
    [{ findingId: 'read-finding-invalid' }, 'findingId'],
  ])('rejects an invalid query contract: %p', async (input, property) => {
    const errors = await validate(plainToInstance(QueryFindingReviewCasesDto, input));
    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  it.each([
    '2026-07-20T00:00:00Z',
    '2026-07-20T00:00:00.123Z',
    '2026-07-20T03:00:00-03:00',
    '2026-07-20T03:00:00.123+03:00',
  ])('accepts a complete timestamp with explicit timezone: %s', async (createdFrom) => {
    const dto = plainToInstance(QueryFindingReviewCasesDto, { createdFrom });
    expect(await validate(dto)).toEqual([]);
    expect(FINDING_REVIEW_TIMESTAMP_PATTERN.test(createdFrom)).toBe(true);
    expect(isFindingReviewTimestamp(createdFrom)).toBe(true);
  });

  it.each([
    '2026-07-20',
    '2026-07-20T00:00:00',
    '2026-07-20 00:00:00Z',
    '20/07/2026',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-07-20T25:00:00Z',
    '2026-07-20T00:61:00Z',
    '2026-07-20T00:00:00+25:00',
    ' 2026-07-20T00:00:00Z ',
    '',
  ])('rejects an ambiguous or invalid timestamp: %j', async (createdFrom) => {
    const dto = plainToInstance(QueryFindingReviewCasesDto, { createdFrom });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'createdFrom')).toBe(true);
    expect(isFindingReviewTimestamp(createdFrom)).toBe(false);
  });

  it('normalizes equivalent explicit offsets to the same UTC instant', () => {
    expect(parseFindingReviewTimestamp('2026-07-20T03:00:00-03:00').toISOString()).toBe(
      '2026-07-20T06:00:00.000Z',
    );
    expect(parseFindingReviewTimestamp('2026-07-20T03:00:00-03:00').getTime()).toBe(
      parseFindingReviewTimestamp('2026-07-20T06:00:00Z').getTime(),
    );
  });

  it.each([
    ['1', 1],
    ['100', 100],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('accepts canonical safe pagination value %s', async (page, expected) => {
    const dto = plainToInstance(QueryFindingReviewCasesDto, { page });
    expect(await validate(dto)).toEqual([]);
    expect(dto.page).toBe(expected);
    expect(CANONICAL_POSITIVE_DECIMAL_PATTERN.test(page)).toBe(true);
  });

  it.each([
    ['1', 1],
    ['100', 100],
  ])('accepts canonical pageSize boundary %s', async (pageSize, expected) => {
    const dto = plainToInstance(QueryFindingReviewCasesDto, { pageSize });
    expect(await validate(dto)).toEqual([]);
    expect(dto.pageSize).toBe(expected);
  });

  it.each(['0', '-1', '+1', '01', '1.0', '1.5', '1e2', '1E2', ' 1', '1 ', '', '0x10'])(
    'rejects non-canonical pagination value %j',
    async (page) => {
      const dto = plainToInstance(QueryFindingReviewCasesDto, { page });
      expect((await validate(dto)).some((error) => error.property === 'page')).toBe(true);
    },
  );

  it('rejects skip overflow before querying persistence', async () => {
    const prisma = {
      findingReviewCase: { count: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new FindingReviewCasesService(prisma as unknown as PrismaService, {} as never, {
      assertEnabled: jest.fn(),
    });
    const query = plainToInstance(QueryFindingReviewCasesDto, {
      page: String(Number.MAX_SAFE_INTEGER),
      pageSize: '100',
    });
    expect(await validate(query)).toEqual([]);

    await expect(service.findAll(query)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_FINDING_REVIEW_CASE_PAGINATION' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps a summary without loading relations or exposing internal fields', async () => {
    const count = jest.fn((args?: unknown) => {
      void args;
      return Promise.resolve(1);
    });
    const findMany = jest.fn((args?: unknown) => {
      void args;
      return Promise.resolve([
        {
          id: '00000000-0000-4000-8000-000000000001',
          findingId: 'finding_0123456789abcdef01234567',
          findingType: FINDING_TYPES[0],
          policyVersion: '2026-07-conflict-v1',
          status: FindingReviewCaseStatus.OPEN,
          staleness: FindingReviewStaleness.CURRENT,
          version: 1,
          createdBy: 'atlas-mvp-user',
          createdAt: new Date('2026-07-20T00:00:00.000Z'),
          updatedAt: new Date('2026-07-20T00:00:00.000Z'),
          _count: { assets: 2, events: 1 },
          creationRequestFingerprint: 'must-not-leak',
        },
      ]);
    });
    const prisma = {
      findingReviewCase: { count, findMany },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const feature = { assertEnabled: jest.fn() };
    const service = new FindingReviewCasesService(
      prisma as unknown as PrismaService,
      {} as never,
      feature,
    );

    const result = await service.findAll(plainToInstance(QueryFindingReviewCasesDto, {}));
    expect(feature.assertEnabled).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    const findManyCall = findMany.mock.calls[0]?.[0] as
      { select: Record<string, unknown>; orderBy: unknown } | undefined;
    expect(findManyCall).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: { select: { assets: true, events: true } },
        }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(findManyCall?.select).not.toHaveProperty('originalSnapshot');
    expect(result.items[0]).toEqual(
      expect.objectContaining({ assetCount: 2, eventCount: 1, createdAt: expect.any(String) }),
    );
    expect(result.items[0]).not.toHaveProperty('creationRequestFingerprint');
    expect(result.items[0]).not.toHaveProperty('originalSnapshot');
  });

  it('rejects an inverted date range before querying persistence', async () => {
    const prisma = {
      findingReviewCase: { count: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new FindingReviewCasesService(prisma as unknown as PrismaService, {} as never, {
      assertEnabled: jest.fn(),
    });
    const query = plainToInstance(QueryFindingReviewCasesDto, {
      createdFrom: '2026-07-21T00:00:00.000Z',
      createdTo: '2026-07-20T00:00:00.000Z',
    });

    await expect(service.findAll(query)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_FINDING_REVIEW_CASE_DATE_RANGE' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

interface ReadFixture {
  caseId: string;
  findingId: string;
  assetId: string;
  createdAt: string;
  status: FindingReviewCaseStatus;
  staleness: FindingReviewStaleness;
  findingType: (typeof FINDING_TYPES)[number];
  originalSnapshot: Prisma.JsonValue;
  originalSnapshotHash: string;
}

describe('GET /conflict-review-cases (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const testRunId = randomUUID();
  const createdBy = `read-test-${testRunId}`;
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
  const fixtures: ReadFixture[] = [];
  const assetIds: string[] = [];
  const tiedEventIds = [randomUUID(), randomUUID()].sort() as [string, string];
  let deletedAssetCaseId: string;
  const baseTime = Date.parse('2026-07-01T12:00:00.000Z');
  const stableTime = new Date(baseTime + 100 * 60_000);

  function fixtureAt(index: number): ReadFixture {
    const fixture = fixtures[index];
    if (!fixture) throw new Error(`Fixture de leitura ${index} não foi criada.`);
    return fixture;
  }

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const statuses = Object.values(FindingReviewCaseStatus);
    const stalenessValues = Object.values(FindingReviewStaleness);
    for (let index = 0; index < 32; index += 1) {
      const asset = await prisma.asset.create({
        data: {
          canonicalKey: `pr19:${testRunId}:${index}`,
          name: `PR19-ASSET-${String(index).padStart(2, '0')}`,
          kind: index % 2 === 0 ? 'SERVER' : 'NOTEBOOK',
        },
        select: { id: true, name: true },
      });
      assetIds.push(asset.id);
      const findingId = `finding_${index.toString(16).padStart(24, '0')}`;
      const findingType = FINDING_TYPES[index % FINDING_TYPES.length]!;
      const status = statuses[index % statuses.length]!;
      const staleness = stalenessValues[index % stalenessValues.length]!;
      const createdAt = index >= 28 ? stableTime : new Date(baseTime + index * 60_000);
      const snapshot = {
        snapshotVersion: 1,
        findingId,
        findingType,
        generatedAt: createdAt.toISOString(),
        marker: `snapshot-${index}`,
      };
      const originalSnapshotHash = sha256(JSON.stringify(snapshot));
      const reviewCase = await prisma.findingReviewCase.create({
        data: {
          findingId,
          findingType,
          policyVersion: '2026-07-conflict-v1',
          reviewSubjectKey: sha256(`subject:${testRunId}:${index}`),
          activeReviewSubjectKey: null,
          creationRequestFingerprint: sha256(`request:${testRunId}:${index}`),
          status,
          staleness,
          originalSnapshot: snapshot,
          originalSnapshotHash,
          version: 1,
          createdBy,
          findingGeneratedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
          assets: {
            create: {
              assetId: asset.id,
              assetIdAtCreation: asset.id,
              assetNameAtCreation: asset.name,
              role: 'AFFECTED_ASSET',
              createdAt,
            },
          },
          events: {
            create: {
              eventType: 'CASE_CREATED',
              versionBefore: null,
              versionAfter: 1,
              actorId: createdBy,
              requestId: null,
              metadata: {
                findingId,
                originalSnapshotHash,
                requestFingerprint: 'must-not-leak',
                reviewSubjectKey: 'must-not-leak',
              },
              occurredAt: createdAt,
              createdAt,
            },
          },
        },
        select: { id: true },
      });
      fixtures.push({
        caseId: reviewCase.id,
        findingId,
        assetId: asset.id,
        createdAt: createdAt.toISOString(),
        status,
        staleness,
        findingType,
        originalSnapshot: snapshot,
        originalSnapshotHash,
      });
    }

    const eventCase = fixtureAt(0);
    await prisma.findingReviewEvent.createMany({
      data: [
        {
          caseId: eventCase.caseId,
          eventType: 'TEST_VERSION_3',
          versionBefore: 2,
          versionAfter: 3,
          actorId: createdBy,
          metadata: {
            findingId: eventCase.findingId,
            justification: 'Aguardando confirmação técnica.',
            private: 'must-not-leak',
          },
          occurredAt: new Date(baseTime + 1_000),
          createdAt: new Date(baseTime + 1_000),
        },
        {
          caseId: eventCase.caseId,
          eventType: 'TEST_VERSION_2',
          versionBefore: 1,
          versionAfter: 2,
          actorId: createdBy,
          metadata: { originalSnapshotHash: eventCase.originalSnapshotHash },
          occurredAt: new Date(baseTime + 2_000),
          createdAt: new Date(baseTime + 2_000),
        },
        {
          id: tiedEventIds[1],
          caseId: eventCase.caseId,
          eventType: 'TEST_TIED_SECOND',
          versionBefore: 3,
          versionAfter: 4,
          actorId: createdBy,
          occurredAt: new Date(baseTime + 3_000),
          createdAt: new Date(baseTime + 3_000),
        },
        {
          id: tiedEventIds[0],
          caseId: eventCase.caseId,
          eventType: 'TEST_TIED_FIRST',
          versionBefore: 3,
          versionAfter: 4,
          actorId: createdBy,
          metadata: { unexpected: 'must-not-leak' },
          occurredAt: new Date(baseTime + 3_000),
          createdAt: new Date(baseTime + 3_000),
        },
      ],
    });

    const deletedAssetFixture = fixtureAt(1);
    deletedAssetCaseId = deletedAssetFixture.caseId;
    await prisma.asset.delete({ where: { id: deletedAssetFixture.assetId } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.findingReviewCase.deleteMany({ where: { createdBy } });
      await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    }
    if (previousFlag === undefined) delete process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
    else process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = previousFlag;
    if (app) await app.close();
  });

  it('lists a summarized first page with defaults and relation counts', async () => {
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy })
      .expect(200);
    const body = responseBody<{
      items: Array<Record<string, unknown>>;
      pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
    }>(response);
    expect(body.pagination).toEqual({ page: 1, pageSize: 25, totalItems: 32, totalPages: 2 });
    expect(body.items).toHaveLength(25);
    expect(body.items[0]).toEqual(
      expect.objectContaining({ assetCount: 1, eventCount: expect.any(Number) }),
    );
    expect(body.items[0]).not.toHaveProperty('originalSnapshot');
    expect(body.items[0]).not.toHaveProperty('originalSnapshotHash');
    expect(body.items[0]).not.toHaveProperty('creationRequestFingerprint');
    expect(body.items[0]).not.toHaveProperty('activeReviewSubjectKey');
    expect(body.items[0]).not.toHaveProperty('reviewSubjectKey');
  });

  it('keeps equal timestamps stably ordered by id', async () => {
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, pageSize: 100 })
      .expect(200);
    const items = responseBody<{ items: Array<{ id: string; createdAt: string }> }>(response).items;
    const actual = items
      .filter((item) => item.createdAt === stableTime.toISOString())
      .map((item) => item.id);
    expect(actual).toEqual([...actual].sort().reverse());
    expect(actual).toHaveLength(4);
  });

  it('keeps deterministic ordering without omissions across pages with equal timestamps', async () => {
    const boundary = stableTime.toISOString();
    const query = {
      createdBy,
      createdFrom: boundary,
      createdTo: boundary,
      pageSize: 2,
    };
    const expected = fixtures
      .filter((fixture) => fixture.createdAt === boundary)
      .map((fixture) => fixture.caseId)
      .sort()
      .reverse();

    const firstPage = responseBody<{ items: Array<{ id: string }> }>(
      await request(server).get('/conflict-review-cases').query({ ...query, page: 1 }).expect(200),
    ).items.map((item) => item.id);
    const secondPage = responseBody<{ items: Array<{ id: string }> }>(
      await request(server).get('/conflict-review-cases').query({ ...query, page: 2 }).expect(200),
    ).items.map((item) => item.id);
    const repeatedFirstPage = responseBody<{ items: Array<{ id: string }> }>(
      await request(server).get('/conflict-review-cases').query({ ...query, page: 1 }).expect(200),
    ).items.map((item) => item.id);

    expect(firstPage).toEqual(repeatedFirstPage);
    expect([...firstPage, ...secondPage]).toEqual(expected);
    expect(new Set([...firstPage, ...secondPage]).size).toBe(expected.length);
  });

  it('uses the id tie-breaker across pages when sorting by an equal status', async () => {
    const status = fixtureAt(0).status;
    const expected = fixtures
      .filter((fixture) => fixture.status === status)
      .map((fixture) => fixture.caseId)
      .sort();
    const pageSize = Math.ceil(expected.length / 2);
    const first = responseBody<{ items: Array<{ id: string }> }>(
      await request(server)
        .get('/conflict-review-cases')
        .query({ createdBy, status, sortBy: 'status', sortDirection: 'asc', pageSize, page: 1 })
        .expect(200),
    ).items.map((item) => item.id);
    const second = responseBody<{ items: Array<{ id: string }> }>(
      await request(server)
        .get('/conflict-review-cases')
        .query({ createdBy, status, sortBy: 'status', sortDirection: 'asc', pageSize, page: 2 })
        .expect(200),
    ).items.map((item) => item.id);

    expect([...first, ...second]).toEqual(expected);
    expect(new Set([...first, ...second]).size).toBe(expected.length);
  });

  it('supports pagination beyond the end without changing the total', async () => {
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, page: 99, pageSize: 10 })
      .expect(200);
    expect(
      responseBody<{ items: unknown[]; pagination: { totalItems: number; totalPages: number } }>(
        response,
      ),
    ).toEqual(
      expect.objectContaining({
        items: [],
        pagination: expect.objectContaining({ totalItems: 32, totalPages: 4 }),
      }),
    );
  });

  it('returns a safe empty result for a valid filter without matches', async () => {
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, findingId: `finding_${'f'.repeat(24)}` })
      .expect(200);
    expect(
      responseBody<{ items: unknown[]; pagination: Record<string, number> }>(response),
    ).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
  });

  it('combines status, staleness, finding type, finding id and historical asset filters', async () => {
    const fixture = fixtureAt(7);
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({
        createdBy,
        status: fixture.status,
        staleness: fixture.staleness,
        findingType: fixture.findingType,
        findingId: fixture.findingId,
        assetId: fixture.assetId,
      })
      .expect(200);
    const body = responseBody<{ items: Array<{ id: string }>; pagination: { totalItems: number } }>(
      response,
    );
    expect(body.items.map((item) => item.id)).toEqual([fixture.caseId]);
    expect(body.pagination.totalItems).toBe(1);
  });

  it('finds a case by historical asset id after the current asset was removed', async () => {
    const fixture = fixtureAt(1);
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, assetId: fixture.assetId })
      .expect(200);
    expect(
      responseBody<{ items: Array<{ id: string }> }>(response).items.map((item) => item.id),
    ).toContain(deletedAssetCaseId);
  });

  it('treats createdFrom and createdTo as inclusive UTC limits', async () => {
    const boundary = stableTime.toISOString();
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, createdFrom: boundary, createdTo: boundary, pageSize: 100 })
      .expect(200);
    expect(responseBody<{ items: unknown[] }>(response).items).toHaveLength(4);
  });

  it.each([
    '2026-07-01T12:00:00Z',
    '2026-07-01T12:00:00.000Z',
    '2026-07-01T09:00:00-03:00',
    '2026-07-01T15:00:00+03:00',
  ])('accepts explicit timezones over HTTP: %s', async (boundary) => {
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, createdFrom: boundary, createdTo: boundary, pageSize: 100 })
      .expect(200);
    expect(responseBody<{ items: unknown[] }>(response).items).toHaveLength(1);
  });

  it.each([
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: 'invalid' },
    { page: '+1' },
    { page: '01' },
    { page: '1.0' },
    { page: '1e2' },
    { page: ' 1 ' },
    { page: '9007199254740993' },
    { pageSize: '01' },
    { pageSize: '1e2' },
    { pageSize: ' 1 ' },
    { pageSize: 101 },
    { status: 'UNKNOWN' },
    { staleness: 'UNKNOWN' },
    { findingType: 'UNKNOWN' },
    { sortBy: 'creationRequestFingerprint' },
    { sortDirection: 'sideways' },
    { assetId: 'invalid' },
    { createdFrom: 'invalid' },
    { createdFrom: '2026-07-20' },
    { createdFrom: '2026-07-20T00:00:00' },
    { createdFrom: '2026-07-20 00:00:00Z' },
    { createdFrom: '20/07/2026' },
    { createdFrom: '2026-02-30T00:00:00Z' },
    { createdFrom: '2026-13-01T00:00:00Z' },
    { createdFrom: '2026-07-20T25:00:00Z' },
    { createdFrom: '2026-07-20T00:61:00Z' },
    { createdFrom: '2026-07-20T00:00:00+25:00' },
    { createdFrom: ' 2026-07-20T00:00:00Z ' },
    { createdFrom: '' },
    { findingId: 'read-finding-invalid' },
    { findingId: 'finding_0123456789ABCDEF01234567' },
    { findingId: 'finding_0123456789abcdef0123456' },
    { findingId: 'finding_0123456789abcdef012345678' },
    { findingId: 'finding_0123456789abcdef0123456g' },
    { findingId: ' finding_0123456789abcdef01234567 ' },
    { unknown: 'value' },
  ])('rejects invalid or unknown list parameters: %p', async (query) => {
    const response = await request(server).get('/conflict-review-cases').query(query).expect(400);
    expect(JSON.stringify(response.body)).not.toMatch(/Prisma|SQL|stack/i);
  });

  it.each([
    'createdFrom=2026-07-20T00%3A00%3A00Z&createdFrom=2026-07-21T00%3A00%3A00Z',
    'page=1&page=2',
    'findingId=finding_0123456789abcdef01234567&findingId=finding_89abcdef0123456789abcdef',
  ])('rejects duplicated query parameters: %s', async (query) => {
    await request(server).get(`/conflict-review-cases?${query}`).expect(400);
  });

  it('returns stable Portuguese validation messages for deterministic filters', async () => {
    const date = await request(server)
      .get('/conflict-review-cases')
      .query({ createdFrom: '2026-07-20' })
      .expect(400);
    const page = await request(server)
      .get('/conflict-review-cases')
      .query({ page: '1e2' })
      .expect(400);
    const finding = await request(server)
      .get('/conflict-review-cases')
      .query({ findingId: 'read-finding-invalid' })
      .expect(400);

    expect(responseBody<{ message: string[] }>(date).message).toContain(
      'createdFrom deve ser um timestamp ISO 8601 completo com timezone explícito.',
    );
    expect(responseBody<{ message: string[] }>(page).message).toContain(
      'page deve ser um número inteiro decimal canônico e seguro.',
    );
    expect(responseBody<{ message: string[] }>(finding).message).toContain(
      'findingId deve seguir o formato finding_ com 24 caracteres hexadecimais minúsculos.',
    );
  });

  it('rejects invalid deterministic filters before invoking the read service', async () => {
    const cases = app.get(FindingReviewCasesService);
    const findAll = jest.spyOn(cases, 'findAll');
    try {
      await request(server)
        .get('/conflict-review-cases')
        .query({ createdFrom: '2026-07-20' })
        .expect(400);
      await request(server).get('/conflict-review-cases').query({ page: '1e2' }).expect(400);
      await request(server)
        .get('/conflict-review-cases')
        .query({ findingId: 'read-finding-invalid' })
        .expect(400);
      expect(findAll).not.toHaveBeenCalled();
    } finally {
      findAll.mockRestore();
    }
  });

  it('rejects an inverted date interval with a stable Portuguese error', async () => {
    const response = await request(server)
      .get('/conflict-review-cases')
      .query({
        createdBy,
        createdFrom: '2026-07-21T00:00:00.000Z',
        createdTo: '2026-07-20T00:00:00.000Z',
      })
      .expect(400);
    expect(responseBody<{ code: string; message: string }>(response)).toEqual(
      expect.objectContaining({
        code: 'INVALID_FINDING_REVIEW_CASE_DATE_RANGE',
        message: 'A data inicial não pode ser posterior à data final.',
      }),
    );
  });

  it('returns persisted snapshot, historical assets and ordered safe events without internal fields', async () => {
    const fixture = fixtureAt(0);
    const response = await request(server)
      .get(`/conflict-review-cases/${fixture.caseId}`)
      .expect(200);
    const body = responseBody<{
      originalSnapshot: Prisma.JsonValue;
      originalSnapshotHash: string;
      assets: Array<Record<string, unknown>>;
      events: Array<{ eventType: string; metadata: Record<string, string> | null }>;
      [key: string]: unknown;
    }>(response);
    expect(body.originalSnapshot).toEqual(fixture.originalSnapshot);
    expect(body.originalSnapshotHash).toBe(fixture.originalSnapshotHash);
    expect(body.assets[0]).toEqual(
      expect.objectContaining({
        assetIdAtCreation: fixture.assetId,
        currentAssetId: fixture.assetId,
        currentAssetAvailable: true,
      }),
    );
    expect(body.events.map((event) => event.eventType)).toEqual([
      'CASE_CREATED',
      'TEST_VERSION_2',
      'TEST_VERSION_3',
      'TEST_TIED_FIRST',
      'TEST_TIED_SECOND',
    ]);
    expect(body.events.slice(-2).map((event) => event.metadata)).toEqual([null, null]);
    expect(body.events.find((event) => event.eventType === 'TEST_VERSION_3')?.metadata).toEqual({
      findingId: fixture.findingId,
      justification: 'Aguardando confirmação técnica.',
    });
    expect(JSON.stringify(body.events)).not.toMatch(
      /must-not-leak|requestFingerprint|reviewSubjectKey/,
    );
    expect(body).not.toHaveProperty('creationRequestFingerprint');
    expect(body).not.toHaveProperty('activeReviewSubjectKey');
    expect(body).not.toHaveProperty('reviewSubjectKey');
  });

  it('preserves historical asset identity when the current asset no longer exists', async () => {
    const fixture = fixtureAt(1);
    const response = await request(server)
      .get(`/conflict-review-cases/${deletedAssetCaseId}`)
      .expect(200);
    expect(responseBody<{ assets: Array<Record<string, unknown>> }>(response).assets[0]).toEqual(
      expect.objectContaining({
        assetIdAtCreation: fixture.assetId,
        assetNameAtCreation: 'PR19-ASSET-01',
        currentAssetId: null,
        currentAssetName: null,
        currentAssetAvailable: false,
      }),
    );
  });

  it('returns the persisted case without recalculating the current finding', async () => {
    const fixture = fixtureAt(0);
    const findings = app.get(ConflictFindingsService);
    const findCurrentById = jest.spyOn(findings, 'findCurrentById');
    try {
      await request(server)
        .get('/conflict-review-cases')
        .query({ createdBy, findingId: fixture.findingId })
        .expect(200);
      await request(server).get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
      expect(findCurrentById).not.toHaveBeenCalled();
    } finally {
      findCurrentById.mockRestore();
    }
  });

  it('returns stable controlled errors for malformed and missing ids', async () => {
    const malformed = await request(server).get('/conflict-review-cases/not-a-uuid').expect(400);
    expect(responseBody<{ code: string; message: string }>(malformed)).toEqual(
      expect.objectContaining({
        code: 'INVALID_FINDING_REVIEW_CASE_ID',
        message: 'O identificador do caso de revisão é inválido.',
      }),
    );
    const missing = await request(server).get(`/conflict-review-cases/${randomUUID()}`).expect(404);
    expect(responseBody<{ code: string; message: string }>(missing)).toEqual(
      expect.objectContaining({
        code: 'FINDING_REVIEW_CASE_NOT_FOUND',
        message: 'O caso de revisão informado não foi encontrado.',
      }),
    );
    expect(JSON.stringify(missing.body)).not.toMatch(/Prisma|SQL|stack/i);
  });

  it('blocks existing cases while the module flag is disabled or invalid, then restores reads', async () => {
    const fixture = fixtureAt(0);
    const persistenceBefore = await persistenceCounts();
    for (const value of ['false', 'invalid']) {
      process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = value;
      const expectedCode =
        value === 'false'
          ? 'FINDING_REVIEW_CASES_DISABLED'
          : 'FINDING_REVIEW_CASES_CONFIGURATION_INVALID';
      const list = await request(server)
        .get('/conflict-review-cases')
        .query({ createdBy })
        .expect(503);
      const detail = await request(server)
        .get(`/conflict-review-cases/${fixture.caseId}`)
        .expect(503);
      expect(responseBody<{ code: string }>(list).code).toBe(expectedCode);
      expect(responseBody<{ code: string }>(detail).code).toBe(expectedCode);
    }
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    await request(server).get('/conflict-review-cases').query({ createdBy }).expect(200);
    await request(server).get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    expect(await persistenceCounts()).toEqual(persistenceBefore);
  });

  it('does not change cases, history, audit or inventory during list and detail reads', async () => {
    const fixture = fixtureAt(0);
    const before = await persistenceCounts();
    const caseBefore = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.caseId },
      select: { updatedAt: true, originalSnapshot: true, originalSnapshotHash: true },
    });
    await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, pageSize: 100 })
      .expect(200);
    await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, status: fixture.status })
      .expect(200);
    await request(server)
      .get('/conflict-review-cases')
      .query({ createdBy, page: 99, pageSize: 10 })
      .expect(200);
    await request(server)
      .get('/conflict-review-cases')
      .query({ createdFrom: '2026-07-20' })
      .expect(400);
    await request(server).get(`/conflict-review-cases/${fixture.caseId}`).expect(200);
    await request(server).get(`/conflict-review-cases/${deletedAssetCaseId}`).expect(200);
    await request(server).get(`/conflict-review-cases/${randomUUID()}`).expect(404);
    expect(await persistenceCounts()).toEqual(before);
    expect(
      await prisma.findingReviewCase.findUniqueOrThrow({
        where: { id: fixture.caseId },
        select: { updatedAt: true, originalSnapshot: true, originalSnapshotHash: true },
      }),
    ).toEqual(caseBefore);
  });

  async function persistenceCounts() {
    const [
      cases,
      relations,
      reviewEvents,
      audits,
      assets,
      attributes,
      interfaces,
      evidence,
      conflicts,
      conflictValues,
      assetEvents,
    ] = await Promise.all([
      prisma.findingReviewCase.count(),
      prisma.findingReviewCaseAsset.count(),
      prisma.findingReviewEvent.count(),
      prisma.auditLog.count(),
      prisma.asset.count(),
      prisma.assetAttribute.count(),
      prisma.networkInterface.count(),
      prisma.assetEvidence.count(),
      prisma.conflict.count(),
      prisma.conflictValue.count(),
      prisma.assetEvent.count(),
    ]);
    return {
      cases,
      relations,
      reviewEvents,
      audits,
      assets,
      attributes,
      interfaces,
      evidence,
      conflicts,
      conflictValues,
      assetEvents,
    };
  }
});
