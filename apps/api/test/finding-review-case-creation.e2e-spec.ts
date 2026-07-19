import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import type { ConflictFinding } from '../src/conflict-analysis/types/conflict-analysis';
import {
  buildFindingReviewSnapshot,
  canonicalSerialize,
  creationRequestFingerprint,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  normalizeIdempotencyKey,
  reviewSubjectKey,
  snapshotHash,
} from '../src/finding-review-cases/finding-review-case-creation';
import {
  FINDING_REVIEW_CASES_FEATURE_FLAG,
  parseFindingReviewCasesEnabled,
} from '../src/finding-review-cases/finding-review-cases.feature';
import { PrismaService } from '../src/prisma/prisma.service';

const NOW = '2026-07-19T12:00:00.000Z';

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
    affectedAssetIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
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

  it('fingerprints operation, provisional actor and normalized key without exposing the raw key', () => {
    const normalized = normalizeIdempotencyKey('  Chave-Única  ');
    const fingerprint = creationRequestFingerprint(normalized);
    expect(normalized).toBe('Chave-Única');
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain(normalized);
    expect(creationRequestFingerprint(normalized)).toBe(fingerprint);
  });

  it('rejects missing, blank and oversized idempotency keys', () => {
    expect(() => normalizeIdempotencyKey(undefined)).toThrow('obrigatório');
    expect(() => normalizeIdempotencyKey('   ')).toThrow('vazio');
    expect(() => normalizeIdempotencyKey('x'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1))).toThrow(
      'no máximo',
    );
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
  let server: Server;
  let prisma: PrismaService;
  const testRunId = randomUUID();
  const assetIds: string[] = [];
  const caseIds = new Set<string>();
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      const trackedCases = [
        ...new Set([
          ...caseIds,
          ...(
            await prisma.findingReviewCase.findMany({
              where: { findingId: { startsWith: 'finding_' }, assets: { some: { assetId: { in: assetIds } } } },
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
  });

  async function createDuplicateHostnameFinding(label: string): Promise<string> {
    const hostname = `pr18-${label}-${testRunId.slice(0, 8)}`.toLowerCase();
    const firstId = randomUUID();
    const secondId = randomUUID();
    assetIds.push(firstId, secondId);
    await prisma.asset.createMany({
      data: [
        { id: firstId, canonicalKey: `pr18:${label}:a:${testRunId}`, name: hostname, kind: 'SERVER' },
        { id: secondId, canonicalKey: `pr18:${label}:b:${testRunId}`, name: hostname, kind: 'SERVER' },
      ],
    });
    const response = await request(server)
      .get('/conflict-analysis/findings')
      .query({ hostname, pageSize: 100 })
      .expect(200);
    const items = responseBody<{ items: Array<{ findingId: string; type: string }> }>(response).items;
    const match = items.find((item) => item.type === 'DUPLICATE_HOSTNAME_ACROSS_ASSETS');
    if (!match) throw new Error(`Fixture ${label} did not produce a finding.`);
    return match.findingId;
  }

  async function postCase(findingId: string, key: string) {
    const response = await request(server)
      .post('/conflict-review-cases')
      .set('Idempotency-Key', key)
      .send({ findingId });
    const body = responseBody<Partial<CaseResponseBody>>(response);
    if (body.id) caseIds.add(body.id);
    return response;
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
    [{ findingId: 'finding_0123456789abcdef01234567' }, ''],
  ])('rejects an invalid body or header without internal details', async (body, key) => {
    const call = request(server).post('/conflict-review-cases').send(body);
    if (key) call.set('Idempotency-Key', key);
    const response = await call.expect(400);
    expect(JSON.stringify(response.body)).not.toMatch(/Prisma|SQL|stack/i);
  });

  it('returns a controlled 404 when the recalculated finding no longer exists', async () => {
    const response = await postCase('finding_0123456789abcdef01234567', `missing-${testRunId}`);
    const body = responseBody<ErrorResponseBody>(response);
    expect(response.status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({ code: 'FINDING_NOT_FOUND', message: expect.stringContaining('não existe') }),
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
        createdBy: 'atlas-mvp-user',
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
        actorId: 'atlas-mvp-user',
      }),
    ]);
    expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
    expect(await inventoryCounts()).toEqual(inventoryBefore);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'FindingReviewCase', entityId: stored.id },
    });
    const serializedAudit = JSON.stringify(audit);
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
      expect.objectContaining({ code: 'ACTIVE_REVIEW_CASE_EXISTS', existingCaseId: createdBody.id }),
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
    expect(await prisma.findingReviewCase.count({ where: { reviewSubjectKey: createdBody.reviewSubjectKey } })).toBe(1);
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
    ['get', '/conflict-review-cases'],
    ['get', `/conflict-review-cases/${randomUUID()}`],
    ['patch', `/conflict-review-cases/${randomUUID()}`],
    ['put', `/conflict-review-cases/${randomUUID()}`],
    ['delete', `/conflict-review-cases/${randomUUID()}`],
  ] as const)('does not expose out-of-scope %s endpoint', async (method, path) => {
    await request(server)[method](path).expect(404);
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
