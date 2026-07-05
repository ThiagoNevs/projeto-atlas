import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

type Score = { toNumber(): number } | null;

function presentScore(score: Score): number | null {
  return score?.toNumber() ?? null;
}

@Injectable()
export class EvidencesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string) {
    const assetExists = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });

    if (!assetExists) {
      throw new NotFoundException(`Asset ${assetId} was not found.`);
    }

    const evidence = await this.prisma.assetEvidence.findMany({
      where: { assetId },
      orderBy: [{ observedAt: 'desc' }, { ingestedAt: 'desc' }],
      select: {
        id: true,
        source: true,
        sourceRecordId: true,
        evidenceType: true,
        payload: true,
        fingerprint: true,
        confidenceScore: true,
        dataQualityScore: true,
        observedAt: true,
        ingestedAt: true,
      },
    });

    return evidence.map((item) => ({
      ...item,
      confidenceScore: presentScore(item.confidenceScore),
      dataQualityScore: presentScore(item.dataQualityScore),
    }));
  }
}
