import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string) {
    const assetExists = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });

    if (!assetExists) {
      throw new NotFoundException(`Asset ${assetId} was not found.`);
    }

    return this.prisma.assetEvent.findMany({
      where: { assetId },
      orderBy: [{ occurredAt: 'desc' }, { recordedAt: 'desc' }],
      select: {
        id: true,
        evidenceId: true,
        eventType: true,
        title: true,
        description: true,
        data: true,
        occurredAt: true,
        recordedAt: true,
      },
    });
  }
}
