import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAnalysisPolicy } from './conflict-analysis.policy';
import {
  ASSET_IDENTITY_SELECT,
  AssetIdentityProjection,
  buildAssetIdentitySnapshot,
} from './conflict-snapshot';

@Injectable()
export class ConflictAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ConflictAnalysisPolicy,
  ) {}

  async analyzeAsset(assetId: string) {
    const target = (await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: ASSET_IDENTITY_SELECT,
    })) as AssetIdentityProjection | null;

    if (!target) throw new NotFoundException(`Asset ${assetId} was not found.`);

    const targetSnapshot = buildAssetIdentitySnapshot(target);
    const normalizedHostnames = [
      ...new Set(targetSnapshot.hostnameObservations.map((item) => item.normalizedValue)),
    ];
    const normalizedIps = [
      ...new Set(targetSnapshot.ipObservations.map((item) => item.normalizedValue)),
    ];
    const queryIps = [
      ...new Set([
        ...normalizedIps,
        ...target.networkInterfaces.flatMap((item) => item.ipAddresses.map((ip) => ip.trim())),
      ]),
    ];
    const relatedFilters: Prisma.AssetWhereInput[] = [];

    for (const hostname of normalizedHostnames) {
      relatedFilters.push(
        { name: { equals: hostname, mode: 'insensitive' } },
        {
          attributes: {
            some: {
              key: { equals: 'hostname', mode: 'insensitive' },
              valueText: { equals: hostname, mode: 'insensitive' },
            },
          },
        },
      );
    }
    if (queryIps.length) {
      relatedFilters.push({
        networkInterfaces: { some: { ipAddresses: { hasSome: queryIps } } },
      });
    }

    const related = relatedFilters.length
      ? ((await this.prisma.asset.findMany({
          where: { id: { not: assetId }, OR: relatedFilters },
          select: ASSET_IDENTITY_SELECT,
        })) as AssetIdentityProjection[])
      : [];
    const snapshots = [
      targetSnapshot,
      ...related.map((asset) => buildAssetIdentitySnapshot(asset)),
    ];

    return this.policy.analyze(assetId, snapshots);
  }
}
