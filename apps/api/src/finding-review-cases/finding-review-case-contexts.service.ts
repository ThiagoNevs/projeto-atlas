import { Injectable, NotFoundException } from '@nestjs/common';

import { ConflictFindingsService } from '../conflict-analysis/conflict-findings.service';
import { FindingReviewStaleness, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildFindingReviewSnapshot,
  canonicalSerialize,
  compareCanonicalStrings,
  reviewSubjectKey,
  snapshotHash,
} from './finding-review-case-creation';
import {
  compareFindingReviewContexts,
  inspectFindingReviewSnapshot,
  snapshotReviewSubjectKey,
  type FindingReviewContextComparisonReason,
  type FindingReviewContextDiff,
} from './finding-review-case-context-comparison';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';

const CONTEXT_COMPARISON_SELECT = {
  id: true,
  version: true,
  findingId: true,
  findingType: true,
  policyVersion: true,
  reviewSubjectKey: true,
  originalSnapshot: true,
  originalSnapshotHash: true,
  assets: {
    select: {
      assetIdAtCreation: true,
      asset: { select: { id: true } },
    },
  },
} satisfies Prisma.FindingReviewCaseSelect;

@Injectable()
export class FindingReviewCaseContextsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly findings: ConflictFindingsService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

  async compare(id: string) {
    this.feature.assertEnabled();
    const reviewCase = await this.prisma.findingReviewCase.findUnique({
      where: { id },
      select: CONTEXT_COMPARISON_SELECT,
    });
    if (!reviewCase) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'FINDING_REVIEW_CASE_NOT_FOUND',
        message: 'O caso de revisão informado não foi encontrado.',
      });
    }

    const inspection = inspectFindingReviewSnapshot(reviewCase.originalSnapshot);
    const baseline = {
      kind: 'ORIGINAL' as const,
      findingId: reviewCase.findingId,
      policyVersion: reviewCase.policyVersion,
      snapshotHash: reviewCase.originalSnapshotHash,
    };
    if (inspection.kind === 'unsupported-version') {
      return this.response(reviewCase.id, reviewCase.version, baseline, null, {
        staleness: FindingReviewStaleness.REQUIRES_REFRESH,
        reasons: ['SNAPSHOT_VERSION_UNSUPPORTED'],
        diff: {},
      });
    }

    const original = inspection.snapshot;
    const snapshotAssetIds = original.affectedAssets
      .map((asset) => asset.assetId)
      .sort(compareCanonicalStrings);
    const relationAssetIds = reviewCase.assets
      .map((relation) => relation.assetIdAtCreation)
      .sort(compareCanonicalStrings);
    if (
      original.findingId !== reviewCase.findingId ||
      original.findingType !== reviewCase.findingType ||
      original.policyVersion !== reviewCase.policyVersion ||
      snapshotHash(original) !== reviewCase.originalSnapshotHash ||
      snapshotReviewSubjectKey(original) !== reviewCase.reviewSubjectKey ||
      canonicalSerialize(snapshotAssetIds) !== canonicalSerialize(relationAssetIds)
    ) {
      throw new Error('O snapshot histórico não corresponde ao caso de revisão persistido.');
    }

    const currentInventory = await this.findings.findAllCurrent();
    const matches = currentInventory.findings.filter(
      ({ finding }) => reviewSubjectKey(finding) === reviewCase.reviewSubjectKey,
    );
    const assetUnavailable = reviewCase.assets.some((relation) => relation.asset === null);

    if (matches.length > 1) {
      return this.response(reviewCase.id, reviewCase.version, baseline, null, {
        staleness: FindingReviewStaleness.REQUIRES_REFRESH,
        reasons: ['COMPARISON_AMBIGUOUS'],
        diff: {},
      });
    }

    const currentMatch = matches[0];
    const currentSnapshot = currentMatch
      ? buildFindingReviewSnapshot({
          finding: currentMatch.finding,
          affectedAssets: currentMatch.affectedAssets,
          policyVersion: currentInventory.policyVersion,
          generatedAt: currentInventory.generatedAt,
        })
      : null;
    const current = currentSnapshot
      ? {
          findingId: currentSnapshot.findingId,
          policyVersion: currentSnapshot.policyVersion,
          snapshot: currentSnapshot,
          snapshotHash: snapshotHash(currentSnapshot),
        }
      : null;

    if (assetUnavailable) {
      return this.response(reviewCase.id, reviewCase.version, baseline, current, {
        staleness: FindingReviewStaleness.ASSET_UNAVAILABLE,
        reasons: ['ASSET_UNAVAILABLE'],
        diff: {},
      });
    }

    if (reviewCase.policyVersion !== currentInventory.policyVersion && currentSnapshot) {
      return this.response(
        reviewCase.id,
        reviewCase.version,
        baseline,
        current,
        compareFindingReviewContexts({
          baseline: original,
          current: currentSnapshot,
          reviewSubjectKey: reviewCase.reviewSubjectKey,
        }),
      );
    }

    if (reviewCase.policyVersion !== currentInventory.policyVersion) {
      return this.response(reviewCase.id, reviewCase.version, baseline, current, {
        staleness: FindingReviewStaleness.POLICY_VERSION_CHANGED,
        reasons: ['POLICY_VERSION_CHANGED'],
        diff: {},
      });
    }

    if (!currentSnapshot) {
      return this.response(reviewCase.id, reviewCase.version, baseline, null, {
        staleness: FindingReviewStaleness.NO_LONGER_DETECTED,
        reasons: ['FINDING_NO_LONGER_DETECTED'],
        diff: {},
      });
    }

    return this.response(
      reviewCase.id,
      reviewCase.version,
      baseline,
      current,
      compareFindingReviewContexts({
        baseline: original,
        current: currentSnapshot,
        reviewSubjectKey: reviewCase.reviewSubjectKey,
      }),
    );
  }

  private response(
    caseId: string,
    caseVersion: number,
    baseline: {
      kind: 'ORIGINAL';
      findingId: string;
      policyVersion: string;
      snapshotHash: string;
    },
    current: {
      findingId: string;
      policyVersion: string;
      snapshot: unknown;
      snapshotHash: string;
    } | null,
    result: {
      staleness: FindingReviewStaleness;
      reasons: FindingReviewContextComparisonReason[];
      diff: FindingReviewContextDiff;
    },
  ) {
    return {
      caseId,
      caseVersion,
      comparedAt: new Date().toISOString(),
      baseline,
      current,
      result,
    };
  }
}
