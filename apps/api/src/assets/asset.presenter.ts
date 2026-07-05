import { Prisma } from '../generated/prisma/client';

export const assetSummarySelect = {
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
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      evidence: true,
      events: true,
    },
  },
} satisfies Prisma.AssetSelect;

export const assetDetailSelect = {
  ...assetSummarySelect,
  description: true,
  attributes: {
    where: { isCurrent: true },
    orderBy: { key: 'asc' },
    select: {
      id: true,
      key: true,
      value: true,
      valueText: true,
      valueType: true,
      confidenceScore: true,
      dataQualityScore: true,
      observedAt: true,
      lastConfirmedAt: true,
      confirmationCount: true,
    },
  },
  networkInterfaces: {
    orderBy: { interfaceIndex: 'asc' },
    select: {
      id: true,
      name: true,
      macAddress: true,
      ipAddresses: true,
      interfaceIndex: true,
      isPrimary: true,
      isCurrent: true,
      observedAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  },
  conflicts: {
    where: { status: 'OPEN' },
    orderBy: { detectedAt: 'desc' },
    select: {
      id: true,
      conflictType: true,
      attributeKey: true,
      status: true,
      severity: true,
      impact: true,
      suggestedValue: true,
      suggestionReason: true,
      detectedAt: true,
      lastDetectedAt: true,
      occurrenceCount: true,
    },
  },
} satisfies Prisma.AssetSelect;

type Score = { toNumber(): number } | null;

type AssetSummaryRecord = Prisma.AssetGetPayload<{ select: typeof assetSummarySelect }>;
type AssetDetailRecord = Prisma.AssetGetPayload<{ select: typeof assetDetailSelect }>;

function presentScore(score: Score): number | null {
  return score?.toNumber() ?? null;
}

function presentAtlasId(id: string): string {
  return `ATLAS-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export function presentAssetSummary(asset: AssetSummaryRecord) {
  return {
    ...asset,
    atlasId: presentAtlasId(asset.id),
    type: asset.kind,
    confidenceScore: presentScore(asset.confidenceScore),
    dataQualityScore: presentScore(asset.dataQualityScore),
    evidenceCount: asset._count.evidence,
    eventCount: asset._count.events,
    kind: undefined,
    _count: undefined,
  };
}

export function presentAssetDetail(asset: AssetDetailRecord) {
  return {
    ...presentAssetSummary(asset),
    description: asset.description,
    attributes: asset.attributes.map((attribute) => ({
      ...attribute,
      confidenceScore: presentScore(attribute.confidenceScore),
      dataQualityScore: presentScore(attribute.dataQualityScore),
    })),
    networkInterfaces: asset.networkInterfaces,
    conflicts: asset.conflicts,
  };
}
