import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  ASSET_IDENTITY_SELECT,
  AssetIdentityProjection,
  buildAssetIdentitySnapshot,
} from './conflict-snapshot';
import { ConflictFindingsInventoryBuilder } from './conflict-findings-inventory.builder';
import type { QueryConflictFindingsDto } from './dto/query-conflict-findings.dto';

@Injectable()
export class ConflictFindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ConflictFindingsInventoryBuilder,
  ) {}

  async findAll(query: QueryConflictFindingsDto) {
    const assets = (await this.prisma.asset.findMany({
      select: ASSET_IDENTITY_SELECT,
    })) as AssetIdentityProjection[];
    const snapshots = assets.map((asset) => buildAssetIdentitySnapshot(asset));

    return this.inventory.build(
      snapshots,
      assets.map((asset) => ({ assetId: asset.id, persistedName: asset.name })),
      query,
    );
  }
}
