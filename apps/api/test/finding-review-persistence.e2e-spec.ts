import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { config as loadEnv } from 'dotenv';

import { FindingReviewCaseStatus, FindingReviewStaleness } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('FindingReviewCase minimal persistence (e2e)', () => {
  let prisma: PrismaService;
  const testRunId = randomUUID();
  const assetIds: string[] = [];
  const caseIds: string[] = [];
  let primaryCreationFingerprint = '';

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    prisma = new PrismaService();
    await prisma.$connect();
  });

  async function createCase(options: {
    suffix: string;
    reviewSubjectKey: string;
    activeReviewSubjectKey: string | null;
  }) {
    const findingId = `finding:${options.suffix}:${testRunId}`;
    const createdBy = `test-actor:${testRunId}`;
    const snapshot = { snapshotVersion: 1, findingId };
    const creationRequestFingerprint = sha256(
      JSON.stringify({
        operation: 'CREATE_FINDING_REVIEW_CASE',
        actorScope: createdBy,
        idempotencyKey: `test-key:${options.suffix}:${testRunId}`,
        payloadHash: sha256(JSON.stringify(snapshot)),
      }),
    );
    const reviewCase = await prisma.findingReviewCase.create({
      data: {
        findingId,
        findingType: 'HOSTNAME_DIVERGENCE_ON_ASSET',
        policyVersion: '2026-07-v1',
        reviewSubjectKey: options.reviewSubjectKey,
        activeReviewSubjectKey: options.activeReviewSubjectKey,
        creationRequestFingerprint,
        originalSnapshot: snapshot,
        originalSnapshotHash: sha256(JSON.stringify(snapshot)),
        createdBy,
        findingGeneratedAt: new Date('2026-07-17T12:00:00.000Z'),
        events: {
          create: {
            eventType: 'CASE_CREATED',
            versionBefore: null,
            versionAfter: 1,
            actorId: createdBy,
            requestId: sha256(`CASE_CREATED|${options.suffix}|${testRunId}`),
            nextStatus: FindingReviewCaseStatus.OPEN,
            after: { status: FindingReviewCaseStatus.OPEN, version: 1 },
          },
        },
      },
      include: { events: true },
    });
    caseIds.push(reviewCase.id);
    return reviewCase;
  }

  afterAll(async () => {
    if (prisma) {
      await prisma.findingReviewEvent.deleteMany({
        where: { caseId: { in: caseIds } },
      });
      await prisma.findingReviewCaseAsset.deleteMany({
        where: { caseId: { in: caseIds } },
      });
      await prisma.findingReviewCase.deleteMany({
        where: { id: { in: caseIds } },
      });
      await prisma.asset.deleteMany({
        where: { id: { in: assetIds } },
      });
      expect(
        await prisma.findingReviewCase.count({
          where: { createdBy: { contains: testRunId } },
        }),
      ).toBe(0);
      expect(
        await prisma.asset.count({
          where: { canonicalKey: { contains: testRunId } },
        }),
      ).toBe(0);
      await prisma.$disconnect();
    }
  });

  it('exposes only the approved case and staleness states', () => {
    expect(Object.values(FindingReviewCaseStatus)).toEqual([
      'OPEN',
      'IN_REVIEW',
      'WAITING_FOR_EVIDENCE',
      'RESOLVED',
      'DISMISSED',
      'CANCELLED',
    ]);
    expect(Object.values(FindingReviewStaleness)).toEqual([
      'CURRENT',
      'CHANGED',
      'NO_LONGER_DETECTED',
      'POLICY_VERSION_CHANGED',
      'ASSET_UNAVAILABLE',
      'REQUIRES_REFRESH',
    ]);
  });

  it('persists the original snapshot, multiple assets and the versioned creation event', async () => {
    const assets = await Promise.all(
      ['A', 'B'].map((suffix) =>
        prisma.asset.create({
          data: {
            canonicalKey: `atlas-test:finding-review:${testRunId}:${suffix}`,
            name: `FINDING-REVIEW-${suffix}`,
            kind: 'SERVER',
          },
        }),
      ),
    );
    assetIds.push(...assets.map((asset) => asset.id));

    const inventoryBefore = await prisma.asset.findMany({
      where: { id: { in: assets.map((asset) => asset.id) } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        canonicalKey: true,
        name: true,
        kind: true,
        operationalStatus: true,
        administrativeStatus: true,
        confidenceScore: true,
        dataQualityScore: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });

    const reviewSubjectKey = `finding-review-subject:v1:${testRunId}`;
    const createdBy = `test-actor:${testRunId}`;
    const snapshot = {
      snapshotVersion: 1,
      findingId: `finding:${testRunId}`,
      affectedAssetIds: assets.map((asset) => asset.id),
    };
    const creationRequestFingerprint = sha256(
      JSON.stringify({
        operation: 'CREATE_FINDING_REVIEW_CASE',
        actorScope: createdBy,
        idempotencyKey: `test-key:${testRunId}`,
        payloadHash: sha256(JSON.stringify(snapshot)),
      }),
    );
    primaryCreationFingerprint = creationRequestFingerprint;
    const reviewCase = await prisma.$transaction(async (tx) =>
      tx.findingReviewCase.create({
        data: {
          findingId: `finding:${testRunId}`,
          findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
          policyVersion: '2026-07-v1',
          reviewSubjectKey,
          activeReviewSubjectKey: reviewSubjectKey,
          creationRequestFingerprint,
          originalSnapshot: snapshot,
          originalSnapshotHash: sha256(JSON.stringify(snapshot)),
          createdBy,
          findingGeneratedAt: new Date('2026-07-17T12:00:00.000Z'),
          assets: {
            create: assets.map((asset) => ({
              assetId: asset.id,
              assetIdAtCreation: asset.id,
              assetNameAtCreation: asset.name,
              role: 'AFFECTED',
            })),
          },
          events: {
            create: {
              eventType: 'CASE_CREATED',
              versionBefore: null,
              versionAfter: 1,
              actorId: createdBy,
              requestId: sha256(`CASE_CREATED|${createdBy}|${testRunId}`),
              nextStatus: FindingReviewCaseStatus.OPEN,
              after: { status: FindingReviewCaseStatus.OPEN, version: 1 },
            },
          },
        },
        include: {
          assets: { orderBy: { assetIdAtCreation: 'asc' } },
          events: true,
        },
      }),
    );
    caseIds.push(reviewCase.id);

    expect(reviewCase).toMatchObject({
      status: FindingReviewCaseStatus.OPEN,
      staleness: FindingReviewStaleness.CURRENT,
      version: 1,
      reviewSubjectKey,
      activeReviewSubjectKey: reviewSubjectKey,
      creationRequestFingerprint,
    });
    expect(reviewCase.originalSnapshot).toEqual(snapshot);
    expect(reviewCase.originalSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewCase.assets).toHaveLength(2);
    expect(reviewCase.events).toEqual([
      expect.objectContaining({
        eventType: 'CASE_CREATED',
        versionBefore: null,
        versionAfter: 1,
        previousStatus: null,
        nextStatus: FindingReviewCaseStatus.OPEN,
      }),
    ]);

    const inventoryAfter = await prisma.asset.findMany({
      where: { id: { in: assets.map((asset) => asset.id) } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        canonicalKey: true,
        name: true,
        kind: true,
        operationalStatus: true,
        administrativeStatus: true,
        confidenceScore: true,
        dataQualityScore: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });
    expect(inventoryAfter).toEqual(inventoryBefore);
    expect(
      await prisma.assetEvidence.count({
        where: { assetId: { in: assets.map((asset) => asset.id) } },
      }),
    ).toBe(0);
    expect(
      await prisma.conflict.count({
        where: { assetId: { in: assets.map((asset) => asset.id) } },
      }),
    ).toBe(0);
  });

  it('prevents more than one active case for the same review subject', async () => {
    const existingCase = await prisma.findingReviewCase.findFirstOrThrow({
      where: { creationRequestFingerprint: primaryCreationFingerprint },
    });

    await expect(
      prisma.findingReviewCase.create({
        data: {
          findingId: `finding:duplicate-subject:${testRunId}`,
          findingType: existingCase.findingType,
          policyVersion: existingCase.policyVersion,
          reviewSubjectKey: existingCase.reviewSubjectKey,
          activeReviewSubjectKey: existingCase.activeReviewSubjectKey,
          creationRequestFingerprint: sha256(`duplicate-subject|${testRunId}`),
          originalSnapshot: {
            snapshotVersion: 1,
            findingId: `finding:duplicate-subject:${testRunId}`,
          },
          originalSnapshotHash: sha256(`duplicate-subject|${testRunId}`),
          createdBy: `test-actor:${testRunId}`,
          findingGeneratedAt: new Date('2026-07-17T12:01:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows historical cases and releases the active subject key for a later case', async () => {
    const reviewSubjectKey = `finding-review-subject:history:${testRunId}`;
    const historicalA = await createCase({
      suffix: 'historical-a',
      reviewSubjectKey,
      activeReviewSubjectKey: reviewSubjectKey,
    });
    await prisma.findingReviewCase.update({
      where: { id: historicalA.id },
      data: {
        status: FindingReviewCaseStatus.RESOLVED,
        activeReviewSubjectKey: null,
      },
    });
    const historicalB = await createCase({
      suffix: 'historical-b',
      reviewSubjectKey,
      activeReviewSubjectKey: reviewSubjectKey,
    });
    await prisma.findingReviewCase.update({
      where: { id: historicalB.id },
      data: {
        status: FindingReviewCaseStatus.RESOLVED,
        activeReviewSubjectKey: null,
      },
    });
    const activeA = await createCase({
      suffix: 'active-a',
      reviewSubjectKey,
      activeReviewSubjectKey: reviewSubjectKey,
    });

    expect(historicalA.reviewSubjectKey).toBe(reviewSubjectKey);
    expect(historicalB.reviewSubjectKey).toBe(reviewSubjectKey);
    expect(
      await prisma.findingReviewCase.count({
        where: {
          id: { in: [historicalA.id, historicalB.id] },
          status: FindingReviewCaseStatus.RESOLVED,
          activeReviewSubjectKey: null,
        },
      }),
    ).toBe(2);

    await prisma.findingReviewCase.update({
      where: { id: activeA.id },
      data: {
        status: FindingReviewCaseStatus.RESOLVED,
        activeReviewSubjectKey: null,
      },
    });
    const activeB = await createCase({
      suffix: 'active-b',
      reviewSubjectKey,
      activeReviewSubjectKey: reviewSubjectKey,
    });

    expect(activeB.activeReviewSubjectKey).toBe(reviewSubjectKey);
    expect(
      await prisma.findingReviewCase.count({
        where: { reviewSubjectKey },
      }),
    ).toBe(4);
    expect(
      await prisma.findingReviewCase.count({
        where: { activeReviewSubjectKey: reviewSubjectKey },
      }),
    ).toBe(1);
  });

  it('allows different review subjects to remain active simultaneously', async () => {
    const subjectA = `finding-review-subject:different-a:${testRunId}`;
    const subjectB = `finding-review-subject:different-b:${testRunId}`;
    const [caseA, caseB] = await Promise.all([
      createCase({
        suffix: 'different-a',
        reviewSubjectKey: subjectA,
        activeReviewSubjectKey: subjectA,
      }),
      createCase({
        suffix: 'different-b',
        reviewSubjectKey: subjectB,
        activeReviewSubjectKey: subjectB,
      }),
    ]);

    expect(caseA.activeReviewSubjectKey).toBe(subjectA);
    expect(caseB.activeReviewSubjectKey).toBe(subjectB);
  });

  it('keeps the contextual creation fingerprint unique without claiming HTTP idempotency', async () => {
    const existingCase = await prisma.findingReviewCase.findUniqueOrThrow({
      where: { creationRequestFingerprint: primaryCreationFingerprint },
    });

    await expect(
      prisma.findingReviewCase.create({
        data: {
          findingId: `finding:duplicate-request:${testRunId}`,
          findingType: existingCase.findingType,
          policyVersion: existingCase.policyVersion,
          reviewSubjectKey: `finding-review-subject:duplicate-request:${testRunId}`,
          activeReviewSubjectKey: `finding-review-subject:duplicate-request:${testRunId}`,
          creationRequestFingerprint: primaryCreationFingerprint,
          originalSnapshot: { snapshotVersion: 1 },
          originalSnapshotHash: sha256(`duplicate-request|${testRunId}`),
          createdBy: `test-actor:${testRunId}`,
          findingGeneratedAt: new Date('2026-07-17T12:03:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rolls back the case and event when a duplicate historical asset link violates its key', async () => {
    const asset = await prisma.asset.create({
      data: {
        canonicalKey: `atlas-test:finding-review:${testRunId}:rollback`,
        name: 'FINDING-REVIEW-ROLLBACK',
        kind: 'SERVER',
      },
    });
    assetIds.push(asset.id);
    const findingId = `finding:rollback:${testRunId}`;

    await expect(
      prisma.findingReviewCase.create({
        data: {
          findingId,
          findingType: 'HOSTNAME_DIVERGENCE_ON_ASSET',
          policyVersion: '2026-07-v1',
          reviewSubjectKey: `finding-review-subject:rollback:${testRunId}`,
          activeReviewSubjectKey: `finding-review-subject:rollback:${testRunId}`,
          creationRequestFingerprint: sha256(`rollback|${testRunId}`),
          originalSnapshot: { snapshotVersion: 1, assetId: asset.id },
          originalSnapshotHash: sha256(`rollback|${asset.id}|${testRunId}`),
          createdBy: `test-actor:${testRunId}`,
          findingGeneratedAt: new Date('2026-07-17T12:04:00.000Z'),
          assets: {
            create: [
              {
                assetId: asset.id,
                assetIdAtCreation: asset.id,
                assetNameAtCreation: asset.name,
                role: 'AFFECTED',
              },
              {
                assetId: asset.id,
                assetIdAtCreation: asset.id,
                assetNameAtCreation: asset.name,
                role: 'AFFECTED',
              },
            ],
          },
          events: {
            create: {
              eventType: 'CASE_CREATED',
              versionBefore: null,
              versionAfter: 1,
              actorId: `test-actor:${testRunId}`,
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(await prisma.findingReviewCase.count({ where: { findingId } })).toBe(0);
    expect(
      await prisma.findingReviewEvent.count({
        where: { reviewCase: { findingId } },
      }),
    ).toBe(0);
  });

  it('preserves the historical asset identity when an asset is removed', async () => {
    const disposableAsset = await prisma.asset.create({
      data: {
        canonicalKey: `atlas-test:finding-review:${testRunId}:deleted`,
        name: 'FINDING-REVIEW-DELETED',
        kind: 'SERVER',
      },
    });
    assetIds.push(disposableAsset.id);

    const reviewSubjectKey = `finding-review-subject:deleted:${testRunId}`;
    const reviewCase = await prisma.findingReviewCase.create({
      data: {
        findingId: `finding:deleted:${testRunId}`,
        findingType: 'HOSTNAME_DIVERGENCE_ON_ASSET',
        policyVersion: '2026-07-v1',
        reviewSubjectKey,
        activeReviewSubjectKey: reviewSubjectKey,
        creationRequestFingerprint: sha256(`deleted-asset|${testRunId}`),
        originalSnapshot: { snapshotVersion: 1, assetId: disposableAsset.id },
        originalSnapshotHash: sha256(`deleted-asset|${testRunId}`),
        createdBy: `test-actor:${testRunId}`,
        findingGeneratedAt: new Date('2026-07-17T12:02:00.000Z'),
        assets: {
          create: {
            assetId: disposableAsset.id,
            assetIdAtCreation: disposableAsset.id,
            assetNameAtCreation: disposableAsset.name,
            role: 'AFFECTED',
          },
        },
      },
    });
    caseIds.push(reviewCase.id);

    await prisma.asset.delete({ where: { id: disposableAsset.id } });

    const historicalLink = await prisma.findingReviewCaseAsset.findUniqueOrThrow({
      where: {
        caseId_assetIdAtCreation: {
          caseId: reviewCase.id,
          assetIdAtCreation: disposableAsset.id,
        },
      },
    });
    expect(historicalLink).toMatchObject({
      assetId: null,
      assetIdAtCreation: disposableAsset.id,
      assetNameAtCreation: disposableAsset.name,
    });
  });
});
