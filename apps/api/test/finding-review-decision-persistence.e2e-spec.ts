import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { config as loadEnv } from 'dotenv';

import { FindingReviewIdentityConclusion } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('FindingReviewDecision persistence foundation (e2e)', () => {
  let prisma: PrismaService;
  const testRunId = randomUUID();
  const actorId = `test-actor:${testRunId}`;
  const isolatedCaseIds = new Set<string>();
  let assetId = '';
  let primaryCaseId = '';
  let secondaryCaseId = '';

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    prisma = new PrismaService();
    await prisma.$connect();

    const asset = await prisma.asset.create({
      data: {
        canonicalKey: `atlas-test:finding-review-decision:${testRunId}`,
        name: 'FINDING-REVIEW-DECISION-FOUNDATION',
        kind: 'SERVER',
      },
    });
    assetId = asset.id;

    const createCase = async (suffix: string, withAsset: boolean) => {
      const findingId = `finding:decision:${suffix}:${testRunId}`;
      const snapshot = { snapshotVersion: 1, findingId };
      return prisma.findingReviewCase.create({
        data: {
          findingId,
          findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
          policyVersion: '2026-07-conflict-v1',
          reviewSubjectKey: sha256(`subject:${suffix}:${testRunId}`),
          activeReviewSubjectKey: sha256(`active-subject:${suffix}:${testRunId}`),
          creationRequestFingerprint: sha256(`create-case:${suffix}:${testRunId}`),
          originalSnapshot: snapshot,
          originalSnapshotHash: sha256(JSON.stringify(snapshot)),
          createdBy: actorId,
          findingGeneratedAt: new Date('2026-08-20T12:00:00.000Z'),
          ...(withAsset
            ? {
                assets: {
                  create: {
                    assetId,
                    assetIdAtCreation: assetId,
                    assetNameAtCreation: asset.name,
                    role: 'AFFECTED_ASSET',
                  },
                },
              }
            : {}),
        },
      });
    };

    primaryCaseId = (await createCase('primary', true)).id;
    secondaryCaseId = (await createCase('secondary', false)).id;
  });

  async function createIsolatedCase(suffix: string) {
    const uniqueSuffix = `${suffix}:${randomUUID()}`;
    const findingId = `finding:decision:${uniqueSuffix}`;
    const snapshot = { snapshotVersion: 1, findingId };
    const reviewCase = await prisma.findingReviewCase.create({
      data: {
        findingId,
        findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        policyVersion: '2026-07-conflict-v1',
        reviewSubjectKey: sha256(`subject:${uniqueSuffix}`),
        activeReviewSubjectKey: sha256(`active-subject:${uniqueSuffix}`),
        creationRequestFingerprint: sha256(`create-case:${uniqueSuffix}`),
        originalSnapshot: snapshot,
        originalSnapshotHash: sha256(JSON.stringify(snapshot)),
        createdBy: actorId,
        findingGeneratedAt: new Date('2026-08-20T12:00:00.000Z'),
      },
    });
    isolatedCaseIds.add(reviewCase.id);
    return reviewCase;
  }

  async function cleanupIsolatedCase(caseId: string) {
    await prisma.findingReviewDecision.deleteMany({ where: { caseId } });
    await prisma.findingReviewCaseAsset.deleteMany({ where: { caseId } });
    await prisma.findingReviewEvent.deleteMany({ where: { caseId } });
    await prisma.findingReviewCase.deleteMany({ where: { id: caseId } });
    isolatedCaseIds.delete(caseId);
  }

  afterAll(async () => {
    if (!prisma) return;
    const caseIds = [primaryCaseId, secondaryCaseId, ...isolatedCaseIds];
    await prisma.findingReviewDecision.deleteMany({
      where: { reviewCase: { createdBy: actorId } },
    });
    await prisma.findingReviewCaseAsset.deleteMany({
      where: { caseId: { in: caseIds } },
    });
    await prisma.findingReviewEvent.deleteMany({
      where: { caseId: { in: caseIds } },
    });
    await prisma.findingReviewCase.deleteMany({
      where: { id: { in: caseIds } },
    });
    await prisma.asset.deleteMany({ where: { id: assetId } });

    expect(await prisma.findingReviewDecision.count({ where: { createdBy: actorId } })).toBe(0);
    expect(await prisma.findingReviewCase.count({ where: { createdBy: actorId } })).toBe(0);
    await prisma.$disconnect();
  });

  it('exposes exactly the two approved identity conclusions', () => {
    expect(Object.values(FindingReviewIdentityConclusion)).toEqual([
      'SAME_ASSET',
      'DIFFERENT_ASSETS',
    ]);
  });

  it('keeps existing cases valid without a decision', async () => {
    const isolatedCase = await createIsolatedCase('without-decision');

    try {
      const reviewCase = await prisma.findingReviewCase.findUniqueOrThrow({
        where: { id: isolatedCase.id },
        include: { decisions: true },
      });

      expect(reviewCase.decisions).toEqual([]);
    } finally {
      await cleanupIsolatedCase(isolatedCase.id);
    }
  });

  it('persists the complete canonical decision record', async () => {
    const createdAt = new Date('2026-08-20T13:00:00.123Z');
    const requestFingerprint = sha256(`decision:same-asset:${testRunId}`);
    const decision = await prisma.findingReviewDecision.create({
      data: {
        caseId: primaryCaseId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Os registros representam a mesma identidade técnica.',
        caseVersion: 2,
        createdBy: actorId,
        requestFingerprint,
        createdAt,
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        caseId: primaryCaseId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Os registros representam a mesma identidade técnica.',
        caseVersion: 2,
        createdBy: actorId,
        requestFingerprint,
        createdAt,
      }),
    );
    expect(decision.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('supports both conclusions, historical versions and equal versions in different cases', async () => {
    const historicalCase = await createIsolatedCase('history');
    const sameVersionCase = await createIsolatedCase('same-version-other-case');

    try {
      await prisma.findingReviewDecision.create({
        data: {
          caseId: historicalCase.id,
          identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          justification: 'A primeira revisão concluiu que era o mesmo ativo.',
          caseVersion: 2,
          createdBy: actorId,
          requestFingerprint: sha256(`decision:history:version-2:${testRunId}`),
        },
      });
      const [historicalDecision, otherCaseDecision] = await Promise.all([
        prisma.findingReviewDecision.create({
          data: {
            caseId: historicalCase.id,
            identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
            justification: 'Uma revisão histórica concluiu que eram ativos distintos.',
            caseVersion: 3,
            createdBy: actorId,
            requestFingerprint: sha256(`decision:history:version-3:${testRunId}`),
          },
        }),
        prisma.findingReviewDecision.create({
          data: {
            caseId: sameVersionCase.id,
            identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
            justification: 'O segundo caso também concluiu por ativos distintos.',
            caseVersion: 2,
            createdBy: actorId,
            requestFingerprint: sha256(`decision:history:other-case-version-2:${testRunId}`),
          },
        }),
      ]);

      expect(historicalDecision.identityConclusion).toBe('DIFFERENT_ASSETS');
      expect(otherCaseDecision.identityConclusion).toBe('DIFFERENT_ASSETS');
      expect(
        await prisma.findingReviewDecision.findMany({
          where: { caseId: historicalCase.id },
          orderBy: { caseVersion: 'asc' },
          select: { caseVersion: true },
        }),
      ).toEqual([{ caseVersion: 2 }, { caseVersion: 3 }]);
      expect(
        await prisma.findingReviewDecision.count({
          where: {
            caseVersion: 2,
            caseId: { in: [historicalCase.id, sameVersionCase.id] },
          },
        }),
      ).toBe(2);
    } finally {
      await cleanupIsolatedCase(historicalCase.id);
      await cleanupIsolatedCase(sameVersionCase.id);
    }
  });

  it('rejects an unknown case through the required foreign key', async () => {
    await expect(
      prisma.findingReviewDecision.create({
        data: {
          caseId: randomUUID(),
          identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          justification: 'Esta decisão não possui caso válido.',
          caseVersion: 1,
          createdBy: actorId,
          requestFingerprint: sha256(`decision:missing-case:${testRunId}`),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps request fingerprints globally unique', async () => {
    const requestFingerprint = sha256(`decision:duplicate-fingerprint:${testRunId}`);
    await prisma.findingReviewDecision.create({
      data: {
        caseId: secondaryCaseId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Primeira requisição persistida.',
        caseVersion: 4,
        createdBy: actorId,
        requestFingerprint,
      },
    });

    await expect(
      prisma.findingReviewDecision.create({
        data: {
          caseId: primaryCaseId,
          identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          justification: 'Tentativa de reutilização do fingerprint.',
          caseVersion: 4,
          createdBy: actorId,
          requestFingerprint,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a repeated case version inside the same case', async () => {
    const isolatedCase = await createIsolatedCase('duplicate-case-version');
    const firstFingerprint = sha256(`decision:duplicate-version:first:${testRunId}`);
    const secondFingerprint = sha256(`decision:duplicate-version:second:${testRunId}`);

    try {
      const firstDecision = await prisma.findingReviewDecision.create({
        data: {
          caseId: isolatedCase.id,
          identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
          justification: 'Primeira decisão desta versão.',
          caseVersion: 2,
          createdBy: actorId,
          requestFingerprint: firstFingerprint,
        },
      });

      await expect(
        prisma.findingReviewDecision.create({
          data: {
            caseId: isolatedCase.id,
            identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
            justification: 'A versão dois já possui uma decisão.',
            caseVersion: 2,
            createdBy: actorId,
            requestFingerprint: secondFingerprint,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(firstFingerprint).not.toBe(secondFingerprint);
      expect(
        await prisma.findingReviewDecision.findMany({
          where: { caseId: isolatedCase.id },
          select: { id: true, requestFingerprint: true },
        }),
      ).toEqual([{ id: firstDecision.id, requestFingerprint: firstFingerprint }]);
    } finally {
      await cleanupIsolatedCase(isolatedCase.id);
    }
  });

  it('lets PostgreSQL reject values outside the identity conclusion enum', async () => {
    const requestFingerprint = sha256(`decision:invalid-enum:${testRunId}`);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "finding_review_decisions" (
          "id", "case_id", "identity_conclusion", "justification",
          "case_version", "created_by", "request_fingerprint"
        ) VALUES (
          ${randomUUID()}::uuid, ${secondaryCaseId}::uuid,
          ${'NOT_A_CONCLUSION'}::"FindingReviewIdentityConclusion",
          ${'Conclusão inválida de teste.'}, ${5}, ${actorId}, ${requestFingerprint}
        )
      `,
    ).rejects.toThrow();
    expect(
      await prisma.findingReviewDecision.count({ where: { requestFingerprint } }),
    ).toBe(0);
  });

  it('rolls back the entire PostgreSQL transaction after a decision constraint violation', async () => {
    const requestFingerprint = sha256(`decision:rollback:${testRunId}`);

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.findingReviewDecision.create({
          data: {
            caseId: secondaryCaseId,
            identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
            justification: 'Esta inserção temporária deve sofrer rollback.',
            caseVersion: 6,
            createdBy: actorId,
            requestFingerprint,
          },
        });
        await transaction.findingReviewDecision.create({
          data: {
            caseId: primaryCaseId,
            identityConclusion: FindingReviewIdentityConclusion.DIFFERENT_ASSETS,
            justification: 'Esta duplicidade força o rollback.',
            caseVersion: 6,
            createdBy: actorId,
            requestFingerprint,
          },
        });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(
      await prisma.findingReviewDecision.count({ where: { requestFingerprint } }),
    ).toBe(0);
  });

  it('prevents deleting a case that owns immutable decision history', async () => {
    const isolatedCase = await createIsolatedCase('delete-restrict');
    const decision = await prisma.findingReviewDecision.create({
      data: {
        caseId: isolatedCase.id,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Esta decisão deve proteger o histórico do caso.',
        caseVersion: 2,
        createdBy: actorId,
        requestFingerprint: sha256(`decision:delete-restrict:${testRunId}`),
      },
    });

    try {
      expect(await prisma.findingReviewCase.count({ where: { id: isolatedCase.id } })).toBe(1);
      expect(await prisma.findingReviewDecision.count({ where: { id: decision.id } })).toBe(1);

      await expect(
        prisma.findingReviewCase.delete({ where: { id: isolatedCase.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });

      expect(await prisma.findingReviewCase.count({ where: { id: isolatedCase.id } })).toBe(1);
      expect(await prisma.findingReviewDecision.count({ where: { id: decision.id } })).toBe(1);
    } finally {
      await cleanupIsolatedCase(isolatedCase.id);
    }
  });

  it('does not modify inventory structures while persisting a decision', async () => {
    const inventoryBefore = await inventorySnapshot(prisma, assetId);

    await prisma.findingReviewDecision.create({
      data: {
        caseId: secondaryCaseId,
        identityConclusion: FindingReviewIdentityConclusion.SAME_ASSET,
        justification: 'Persistência isolada do inventário.',
        caseVersion: 7,
        createdBy: actorId,
        requestFingerprint: sha256(`decision:no-inventory-write:${testRunId}`),
      },
    });

    expect(await inventorySnapshot(prisma, assetId)).toEqual(inventoryBefore);
  });
});

async function inventorySnapshot(prisma: PrismaService, assetId: string) {
  return {
    asset: await prisma.asset.findUnique({ where: { id: assetId } }),
    assetAttributes: await prisma.assetAttribute.count({ where: { assetId } }),
    networkInterfaces: await prisma.networkInterface.count({ where: { assetId } }),
    assetEvidence: await prisma.assetEvidence.count({ where: { assetId } }),
    assetEvents: await prisma.assetEvent.count({ where: { assetId } }),
    conflicts: await prisma.conflict.count({ where: { assetId } }),
    conflictValues: await prisma.conflictValue.count({ where: { conflict: { assetId } } }),
  };
}
