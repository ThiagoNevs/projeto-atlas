import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { ConflictFindingsService } from '../src/conflict-analysis/conflict-findings.service';
import type { ConflictFinding } from '../src/conflict-analysis/types/conflict-analysis';
import {
  buildFindingReviewSnapshot,
  reviewSubjectKey,
} from '../src/finding-review-cases/finding-review-case-creation';
import {
  compareFindingReviewContexts,
  inspectFindingReviewSnapshot,
} from '../src/finding-review-cases/finding-review-case-context-comparison';
import { FINDING_REVIEW_CASES_FEATURE_FLAG } from '../src/finding-review-cases/finding-review-cases.feature';
import { PrismaService } from '../src/prisma/prisma.service';

const NOW = '2026-08-31T12:00:00.000Z';

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
    normalizedHostname: 'atlas-context',
    normalizedIp: null,
    observations: [],
    temporalContext: {
      firstObservedAt: null,
      lastObservedAt: null,
      differenceMilliseconds: null,
      relationship: 'NO_TEMPORAL_CONTEXT',
    },
    explanation: ['Explicação derivada.'],
    limitations: [],
    reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
    ...overrides,
  };
}

function snapshot(overrides: Partial<ConflictFinding> = {}, generatedAt = NOW) {
  const currentFinding = finding(overrides);
  return buildFindingReviewSnapshot({
    finding: currentFinding,
    policyVersion: '2026-07-conflict-v1',
    generatedAt,
    affectedAssets: currentFinding.affectedAssetIds.map((assetId, index) => ({
      assetId,
      name: `asset-${index + 1}`,
    })),
  });
}

describe('Finding review context comparison primitives', () => {
  it('ignores finding ID, generation time, display names, raw values and set ordering', () => {
    const baseline = snapshot({
      observations: [
        {
          assetId: '00000000-0000-4000-8000-000000000001',
          attribute: 'HOSTNAME',
          value: 'ATLAS-CONTEXT.',
          normalizedValue: 'atlas-context',
          source: 'manual',
          sourceType: 'MANUAL',
          evidenceId: null,
          observedAt: NOW,
          ingestedAt: NOW,
          current: true,
        },
      ],
      limitations: ['b', 'a'],
    });
    const current = {
      ...snapshot(
        {
          findingId: 'finding_ffffffffffffffffffffffff',
          observations: baseline.observations.map((item) => ({ ...item, value: 'atlas-context' })),
          limitations: ['a', 'b'],
        },
        '2026-09-01T12:00:00.000Z',
      ),
      affectedAssets: [...baseline.affectedAssets]
        .reverse()
        .map((asset) => ({ ...asset, name: `renamed-${asset.assetId}` })),
    };

    expect(
      compareFindingReviewContexts({
        baseline,
        current,
        reviewSubjectKey: reviewSubjectKey(finding()),
      }),
    ).toEqual({ staleness: 'CURRENT', reasons: [], diff: {} });
  });

  it('returns deterministic material reasons and set differences', () => {
    const baseline = snapshot();
    const current = snapshot({
      findingId: 'finding_aaaaaaaaaaaaaaaaaaaaaaaa',
      affectedAssetIds: [...finding().affectedAssetIds, '00000000-0000-4000-8000-000000000003'],
      limitations: ['Nova limitação'],
    });

    expect(
      compareFindingReviewContexts({
        baseline,
        current,
        reviewSubjectKey: reviewSubjectKey(finding()),
      }),
    ).toEqual({
      staleness: 'CHANGED',
      reasons: ['AFFECTED_ASSETS_CHANGED', 'LIMITATIONS_CHANGED'],
      diff: {
        affectedAssets: {
          added: ['00000000-0000-4000-8000-000000000003'],
          removed: [],
        },
        limitations: { added: ['Nova limitação'], removed: [] },
      },
    });
  });

  it('separates observation, evidence and source changes into deterministic reasons', () => {
    const observation = {
      assetId: '00000000-0000-4000-8000-000000000001',
      attribute: 'HOSTNAME' as const,
      value: 'atlas-context',
      normalizedValue: 'atlas-context',
      source: 'source-a',
      sourceType: 'MANUAL' as const,
      evidenceId: '00000000-0000-4000-8000-000000000010',
      observedAt: NOW,
      ingestedAt: NOW,
      current: true,
    };
    const baseline = snapshot({ observations: [observation] });
    const current = snapshot({
      observations: [
        {
          ...observation,
          source: 'source-b',
          sourceType: 'TECHNICAL',
          evidenceId: '00000000-0000-4000-8000-000000000011',
          observedAt: '2026-09-01T12:00:00.000Z',
        },
      ],
    });

    const result = compareFindingReviewContexts({
      baseline,
      current,
      reviewSubjectKey: reviewSubjectKey(finding()),
    });
    expect(result.staleness).toBe('CHANGED');
    expect(result.reasons).toEqual(['EVIDENCE_CHANGED', 'OBSERVATIONS_CHANGED', 'SOURCES_CHANGED']);
  });

  it('detects provenance reassignment while global source and evidence sets remain equal', () => {
    const firstObservation = {
      assetId: '00000000-0000-4000-8000-000000000001',
      attribute: 'HOSTNAME' as const,
      value: 'atlas-context',
      normalizedValue: 'atlas-context',
      source: 'source-a',
      sourceType: 'MANUAL' as const,
      evidenceId: '00000000-0000-4000-8000-000000000010',
      observedAt: NOW,
      ingestedAt: NOW,
      current: true,
    };
    const secondObservation = {
      ...firstObservation,
      assetId: '00000000-0000-4000-8000-000000000002',
      source: 'source-b',
      sourceType: 'TECHNICAL' as const,
      evidenceId: '00000000-0000-4000-8000-000000000011',
    };
    const baseline = snapshot({ observations: [firstObservation, secondObservation] });
    const current = snapshot({
      observations: [
        {
          ...firstObservation,
          source: secondObservation.source,
          sourceType: secondObservation.sourceType,
          evidenceId: secondObservation.evidenceId,
        },
        {
          ...secondObservation,
          source: firstObservation.source,
          sourceType: firstObservation.sourceType,
          evidenceId: firstObservation.evidenceId,
        },
      ],
    });

    expect(current.sources).toEqual(baseline.sources);
    expect(current.observations.map(({ evidenceId }) => evidenceId).sort()).toEqual(
      baseline.observations.map(({ evidenceId }) => evidenceId).sort(),
    );
    expect(
      compareFindingReviewContexts({
        baseline,
        current,
        reviewSubjectKey: reviewSubjectKey(finding()),
      }),
    ).toEqual({
      staleness: 'CHANGED',
      reasons: ['OBSERVATIONS_CHANGED'],
      diff: {
        observations: {
          added: expect.arrayContaining([
            expect.objectContaining({
              assetId: firstObservation.assetId,
              source: secondObservation.source,
              evidenceId: secondObservation.evidenceId,
            }),
            expect.objectContaining({
              assetId: secondObservation.assetId,
              source: firstObservation.source,
              evidenceId: firstObservation.evidenceId,
            }),
          ]),
          removed: expect.arrayContaining([
            expect.objectContaining({
              assetId: firstObservation.assetId,
              source: firstObservation.source,
              evidenceId: firstObservation.evidenceId,
            }),
            expect.objectContaining({
              assetId: secondObservation.assetId,
              source: secondObservation.source,
              evidenceId: secondObservation.evidenceId,
            }),
          ]),
        },
      },
    });
  });

  it('gives policy changes precedence over ordinary material changes', () => {
    const baseline = snapshot();
    const current = { ...snapshot({ limitations: ['changed'] }), policyVersion: 'future-v2' };
    const result = compareFindingReviewContexts({
      baseline,
      current,
      reviewSubjectKey: reviewSubjectKey(finding()),
    });
    expect(result.staleness).toBe('POLICY_VERSION_CHANGED');
    expect(result.reasons).toEqual(['LIMITATIONS_CHANGED', 'POLICY_VERSION_CHANGED']);
  });

  it('distinguishes unsupported snapshot versions from malformed supported snapshots', () => {
    expect(inspectFindingReviewSnapshot({ snapshotVersion: 2 })).toEqual({
      kind: 'unsupported-version',
      snapshotVersion: 2,
    });
    expect(() => inspectFindingReviewSnapshot({ snapshotVersion: 1 })).toThrow(
      'snapshot histórico',
    );
  });
});

interface FindingListBody {
  items: Array<{ findingId: string; type: string }>;
}

interface CreatedCaseBody {
  id: string;
  findingId: string;
}

interface ComparisonBody {
  caseId: string;
  caseVersion: number;
  current: { findingId: string; snapshotHash: string } | null;
  result: { staleness: string; reasons: string[]; diff: Record<string, unknown> };
}

interface ErrorBody {
  code: string;
}

describe('GET /conflict-review-cases/:id/context-comparison (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let findings: ConflictFindingsService;
  const previousFlag = process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
  const testRunId = randomUUID();
  const assetIds = new Set<string>();
  const caseIds = new Set<string>();

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
    findings = app.get(ConflictFindingsService);
  });

  afterAll(async () => {
    if (prisma) {
      const ids = [...caseIds];
      await prisma.auditLog.deleteMany({
        where: { entityType: 'FindingReviewCase', entityId: { in: ids } },
      });
      await prisma.findingReviewCase.deleteMany({ where: { id: { in: ids } } });
      await prisma.asset.deleteMany({ where: { id: { in: [...assetIds] } } });
    }
    if (previousFlag === undefined) delete process.env[FINDING_REVIEW_CASES_FEATURE_FLAG];
    else process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = previousFlag;
    if (app) await app.close();
  });

  async function createFixture(label: string) {
    const hostname = `pr38-${label}-${testRunId.slice(0, 8)}`.toLowerCase();
    const firstAssetId = randomUUID();
    const secondAssetId = randomUUID();
    assetIds.add(firstAssetId);
    assetIds.add(secondAssetId);
    await prisma.asset.createMany({
      data: [
        {
          id: firstAssetId,
          canonicalKey: `pr38:${label}:a:${testRunId}`,
          name: hostname,
          kind: 'SERVER',
        },
        {
          id: secondAssetId,
          canonicalKey: `pr38:${label}:b:${testRunId}`,
          name: hostname,
          kind: 'SERVER',
        },
      ],
    });
    const findings = await request(server)
      .get('/conflict-analysis/findings')
      .query({ hostname, pageSize: 100 })
      .expect(200);
    const match = (findings.body as FindingListBody).items.find(
      (item) => item.type === 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    );
    if (!match) throw new Error(`Fixture ${label} não produziu finding.`);
    const created = await request(server)
      .post('/conflict-review-cases')
      .set('Idempotency-Key', `pr38-${label}-${testRunId}`)
      .send({ findingId: match.findingId })
      .expect(201);
    const body = created.body as CreatedCaseBody;
    caseIds.add(body.id);
    return { ...body, hostname, firstAssetId, secondAssetId };
  }

  async function persistenceState(caseId: string) {
    const [
      reviewCase,
      events,
      audits,
      decisions,
      assets,
      attributes,
      interfaces,
      evidence,
      assetEvents,
      conflicts,
      conflictValues,
    ] = await Promise.all([
      prisma.findingReviewCase.findUniqueOrThrow({ where: { id: caseId } }),
      prisma.findingReviewEvent.count({ where: { caseId } }),
      prisma.auditLog.count({ where: { entityType: 'FindingReviewCase', entityId: caseId } }),
      prisma.findingReviewDecision.count({ where: { caseId } }),
      prisma.asset.count(),
      prisma.assetAttribute.count(),
      prisma.networkInterface.count(),
      prisma.assetEvidence.count(),
      prisma.assetEvent.count(),
      prisma.conflict.count(),
      prisma.conflictValue.count(),
    ]);
    return {
      reviewCase,
      events,
      audits,
      decisions,
      assets,
      attributes,
      interfaces,
      evidence,
      assetEvents,
      conflicts,
      conflictValues,
    };
  }

  it('returns CURRENT and remains strictly read-only across repeated GETs', async () => {
    const fixture = await createFixture('current');
    const before = await persistenceState(fixture.id);
    const deriveCurrent = jest.spyOn(findings, 'findAllCurrent');
    const first = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    const second = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    const body = first.body as ComparisonBody;
    expect(body).toEqual(
      expect.objectContaining({
        caseId: fixture.id,
        caseVersion: 1,
        current: expect.objectContaining({ findingId: fixture.findingId }),
        result: { staleness: 'CURRENT', reasons: [], diff: {} },
      }),
    );
    expect((second.body as ComparisonBody).result).toEqual(body.result);
    expect(deriveCurrent).toHaveBeenCalledTimes(2);
    deriveCurrent.mockRestore();
    expect(await persistenceState(fixture.id)).toEqual(before);
  });

  it('ignores inventory changes that do not participate in the finding', async () => {
    const fixture = await createFixture('irrelevant');
    await prisma.asset.update({
      where: { id: fixture.firstAssetId },
      data: { description: 'Mudança administrativa irrelevante à identidade.' },
    });
    const response = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    expect((response.body as ComparisonBody).result).toEqual({
      staleness: 'CURRENT',
      reasons: [],
      diff: {},
    });
  });

  it('matches by reviewSubjectKey when findingId changes and reports CHANGED', async () => {
    const fixture = await createFixture('changed');
    const addedAssetId = randomUUID();
    assetIds.add(addedAssetId);
    await prisma.asset.create({
      data: {
        id: addedAssetId,
        canonicalKey: `pr38:changed:c:${testRunId}`,
        name: fixture.hostname,
        kind: 'SERVER',
      },
    });
    const before = await persistenceState(fixture.id);
    const response = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    const body = response.body as ComparisonBody;
    expect(body.current?.findingId).not.toBe(fixture.findingId);
    expect(body.result.staleness).toBe('CHANGED');
    expect(body.result.reasons).toEqual(
      expect.arrayContaining(['AFFECTED_ASSETS_CHANGED', 'OBSERVATIONS_CHANGED']),
    );
    expect(await persistenceState(fixture.id)).toEqual(before);
  });

  it('returns REQUIRES_REFRESH without choosing a current finding when matching is ambiguous', async () => {
    const fixture = await createFixture('ambiguous');
    const inventory = await findings.findAllCurrent();
    const matching = inventory.findings.find(
      ({ finding: currentFinding }) =>
        currentFinding.type === 'DUPLICATE_HOSTNAME_ACROSS_ASSETS' &&
        currentFinding.normalizedHostname === fixture.hostname,
    );
    if (!matching) throw new Error('Fixture ambígua não produziu finding correspondente.');
    const before = await persistenceState(fixture.id);
    const deriveCurrent = jest.spyOn(findings, 'findAllCurrent').mockResolvedValue({
      ...inventory,
      findings: [
        ...inventory.findings,
        {
          ...matching,
          finding: {
            ...matching.finding,
            findingId: 'finding_ffffffffffffffffffffffff',
          },
        },
      ],
    });

    try {
      const response = await request(server)
        .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
        .expect(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          current: null,
          result: {
            staleness: 'REQUIRES_REFRESH',
            reasons: ['COMPARISON_AMBIGUOUS'],
            diff: {},
          },
        }),
      );
    } finally {
      deriveCurrent.mockRestore();
    }
    expect(await persistenceState(fixture.id)).toEqual(before);
  });

  it('returns REQUIRES_REFRESH read-only for an unsupported snapshot version', async () => {
    const fixture = await createFixture('unsupported-snapshot');
    const stored = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { id: fixture.id },
      select: { originalSnapshot: true },
    });
    if (
      typeof stored.originalSnapshot !== 'object' ||
      stored.originalSnapshot === null ||
      Array.isArray(stored.originalSnapshot)
    ) {
      throw new Error('Fixture não possui snapshot histórico estruturado.');
    }
    await prisma.findingReviewCase.update({
      where: { id: fixture.id },
      data: {
        originalSnapshot: {
          ...stored.originalSnapshot,
          snapshotVersion: 2,
        },
      },
    });
    const before = await persistenceState(fixture.id);

    const response = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        current: null,
        result: {
          staleness: 'REQUIRES_REFRESH',
          reasons: ['SNAPSHOT_VERSION_UNSUPPORTED'],
          diff: {},
        },
      }),
    );
    expect(await persistenceState(fixture.id)).toEqual(before);
  });

  it('returns NO_LONGER_DETECTED with current null when the subject disappears', async () => {
    const fixture = await createFixture('disappeared');
    await prisma.asset.update({
      where: { id: fixture.secondAssetId },
      data: { name: `${fixture.hostname}-renamed` },
    });
    const before = await persistenceState(fixture.id);
    const response = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        current: null,
        result: {
          staleness: 'NO_LONGER_DETECTED',
          reasons: ['FINDING_NO_LONGER_DETECTED'],
          diff: {},
        },
      }),
    );
    expect(await persistenceState(fixture.id)).toEqual(before);
  });

  it('gives ASSET_UNAVAILABLE precedence when a historical asset was deleted', async () => {
    const fixture = await createFixture('asset-unavailable');
    await prisma.asset.delete({ where: { id: fixture.secondAssetId } });
    const before = await persistenceState(fixture.id);
    const response = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(200);
    expect((response.body as ComparisonBody).result).toEqual({
      staleness: 'ASSET_UNAVAILABLE',
      reasons: ['ASSET_UNAVAILABLE'],
      diff: {},
    });
    expect(await persistenceState(fixture.id)).toEqual(before);
  });

  it('uses the established validation, not-found and feature-gate errors', async () => {
    const invalid = await request(server)
      .get('/conflict-review-cases/not-a-uuid/context-comparison')
      .expect(400);
    expect((invalid.body as ErrorBody).code).toBe('INVALID_FINDING_REVIEW_CASE_ID');
    const missing = await request(server)
      .get(`/conflict-review-cases/${randomUUID()}/context-comparison`)
      .expect(404);
    expect((missing.body as ErrorBody).code).toBe('FINDING_REVIEW_CASE_NOT_FOUND');

    const fixture = await createFixture('disabled');
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'false';
    const disabled = await request(server)
      .get(`/conflict-review-cases/${fixture.id}/context-comparison`)
      .expect(503);
    expect((disabled.body as ErrorBody).code).toBe('FINDING_REVIEW_CASES_DISABLED');
    process.env[FINDING_REVIEW_CASES_FEATURE_FLAG] = 'true';
  });
});
