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
            evidenceId: true,
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

    const referenceTime = new Date();
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
        attributeObservedAt: attribute.observedAt,
        evidenceObservedAt: attribute.evidence?.observedAt ?? null,
        evidenceIngestedAt: attribute.evidence?.ingestedAt ?? null,
        persistedConfidenceScore: scoreToNumber(attribute.confidenceScore),
        dataQuality: scoreToNumber(attribute.dataQualityScore),
        isManual: source.kind === 'MANUAL',
        evidenceId: attribute.evidenceId,
        evidenceAvailable: attribute.evidence !== null,
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
        .map(([attribute, candidates]) => {
          const currentCandidates = candidates.filter((candidate) => candidate.isCurrent);
          const currentValue = this.resolvePersistedCurrentValue(currentCandidates);

          return this.evidenceEngine.analyze(
            {
              attribute,
              currentValue: currentValue?.value ?? null,
              normalizedCurrentValue: currentValue?.normalizedValue ?? null,
              candidates,
            },
            referenceTime,
          );
        }),
    };
  }

  private resolvePersistedCurrentValue(
    candidates: EvidenceCandidate[],
  ): { value: unknown; normalizedValue: string } | null {
    if (candidates.length === 0) return null;

    const serializedValues = new Set(candidates.map((candidate) => JSON.stringify(candidate.value)));
    const normalizedValues = new Set(candidates.map((candidate) => candidate.normalizedValue));
    const representative = candidates[0];

    if (
      representative === undefined ||
      serializedValues.size !== 1 ||
      normalizedValues.size !== 1 ||
      representative.normalizedValue === null
    ) {
      return null;
    }

    return { value: representative.value, normalizedValue: representative.normalizedValue };
  }
}
