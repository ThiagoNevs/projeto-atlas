import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { EvidenceEngineService } from './evidence-engine.service';
import { EvidenceCandidate } from './types/evidence-candidate';
import { normalizeAttributeKey, normalizeCandidateValue } from './utils/attribute-utils';
import { evidenceSource, scoreToNumber } from './utils/evidence-utils';

@Injectable()
export class EvidenceAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidenceEngine: EvidenceEngineService,
  ) {}

  async analyzeAsset(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        name: true,
        attributes: {
          orderBy: [{ isCurrent: 'desc' }, { observedAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            key: true,
            value: true,
            valueText: true,
            confidenceScore: true,
            dataQualityScore: true,
            isCurrent: true,
            observedAt: true,
            confirmationCount: true,
            evidence: {
              select: {
                id: true,
                source: true,
                evidenceType: true,
                observedAt: true,
                ingestedAt: true,
              },
            },
          },
        },
      },
    });

    if (!asset) throw new NotFoundException(`Asset ${assetId} was not found.`);

    const candidatesByAttribute = new Map<string, EvidenceCandidate[]>();
    for (const attribute of asset.attributes) {
      const key = normalizeAttributeKey(attribute.key);
      const candidates = candidatesByAttribute.get(key) ?? [];
      const source = evidenceSource(
        attribute.evidence?.source ?? null,
        attribute.evidence?.evidenceType ?? null,
      );

      candidates.push({
        attributeId: attribute.id,
        value: attribute.value,
        valueText: attribute.valueText,
        normalizedValue: normalizeCandidateValue(attribute.valueText, attribute.value),
        source,
        observedAt: attribute.observedAt,
        ingestedAt: attribute.evidence?.ingestedAt ?? null,
        confidence: scoreToNumber(attribute.confidenceScore),
        dataQuality: scoreToNumber(attribute.dataQualityScore),
        isManual: source.kind === 'MANUAL',
        evidenceId: attribute.evidence?.id ?? null,
        isCurrent: attribute.isCurrent,
        confirmationCount: attribute.confirmationCount,
      });
      candidatesByAttribute.set(key, candidates);
    }

    return {
      asset: { id: asset.id, name: asset.name },
      mode: 'SHADOW' as const,
      decisionsChanged: false,
      analyses: [...candidatesByAttribute.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([attribute, candidates]) => this.evidenceEngine.analyze(attribute, candidates)),
    };
  }
}
