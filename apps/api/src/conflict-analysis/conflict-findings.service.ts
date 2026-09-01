import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  ASSET_IDENTITY_SELECT,
  AssetIdentityProjection,
  buildAssetIdentitySnapshot,
} from './conflict-snapshot';
import { ConflictFindingsInventoryBuilder } from './conflict-findings-inventory.builder';
import { IDENTITY_NETWORK_CONFLICT_POLICY_VERSION } from './conflict-analysis.policy';
import type { QueryConflictFindingsDto } from './dto/query-conflict-findings.dto';

@Injectable()
export class ConflictFindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ConflictFindingsInventoryBuilder,
  ) {}

  async findAll(query: QueryConflictFindingsDto) {
    const assets = await this.loadAssets();
    const snapshots = assets.map((asset) => buildAssetIdentitySnapshot(asset));

    return this.inventory.build(
      snapshots,
      assets.map((asset) => ({ assetId: asset.id, persistedName: asset.name })),
      query,
    );
  }

  async findCurrentById(findingId: string) {
    const assets = await this.loadAssets();
    const snapshots = assets.map((asset) => buildAssetIdentitySnapshot(asset));
    const finding = this.inventory.findById(snapshots, findingId);
    if (!finding) return null;

    const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));
    return {
      finding,
      policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
      generatedAt: this.inventory.generatedAtFor(snapshots),
      affectedAssets: finding.affectedAssetIds.map((assetId) => ({
        assetId,
        name: assetNames.get(assetId) ?? null,
      })),
    };
  }

  async findAllCurrent() {
    const assets = await this.loadAssets();
    const snapshots = assets.map((asset) => buildAssetIdentitySnapshot(asset));
    const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]));

    return {
      findings: this.inventory.findAllCurrent(snapshots).map((finding) => ({
        finding,
        affectedAssets: finding.affectedAssetIds.map((assetId) => ({
          assetId,
          name: assetNames.get(assetId) ?? null,
        })),
      })),
      policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
      generatedAt: this.inventory.generatedAtFor(snapshots),
    };
  }

  private async loadAssets(): Promise<AssetIdentityProjection[]> {
    return this.prisma.asset.findMany({
      select: ASSET_IDENTITY_SELECT,
    });
  }
}
