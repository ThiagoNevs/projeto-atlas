import { Prisma } from '../generated/prisma/client';
import { evidenceSource } from '../evidence-engine/utils/evidence-utils';
import { normalizeConflictHostname, normalizeConflictIp } from './conflict-normalization';
import {
  AssetIdentitySnapshot,
  ConflictObservation,
  ConflictSourceType,
} from './types/conflict-analysis';

export type EvidenceProjection = {
  id: string;
  source: string;
  evidenceType: string;
  observedAt: Date;
  ingestedAt: Date;
} | null;

export type AssetIdentityProjection = {
  id: string;
  name: string;
  updatedAt: Date;
  attributes: Array<{
    value: unknown;
    valueText: string | null;
    isCurrent: boolean;
    observedAt: Date;
    evidenceId: string | null;
    evidence: EvidenceProjection;
  }>;
  networkInterfaces: Array<{
    ipAddresses: string[];
    isCurrent: boolean;
    observedAt: Date | null;
    evidenceId: string | null;
    evidence: EvidenceProjection;
  }>;
};

export const ASSET_IDENTITY_SELECT = {
  id: true,
  name: true,
  updatedAt: true,
  attributes: {
    where: { key: { equals: 'hostname', mode: 'insensitive' as const } },
    orderBy: [{ isCurrent: 'desc' as const }, { observedAt: 'desc' as const }],
    select: {
      value: true,
      valueText: true,
      isCurrent: true,
      observedAt: true,
      evidenceId: true,
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
  networkInterfaces: {
    orderBy: [{ isCurrent: 'desc' as const }, { lastSeenAt: 'desc' as const }],
    select: {
      ipAddresses: true,
      isCurrent: true,
      observedAt: true,
      evidenceId: true,
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
} satisfies Prisma.AssetSelect;

export function buildAssetIdentitySnapshot(asset: AssetIdentityProjection): AssetIdentitySnapshot {
  const limitations: string[] = [];
  const hostnameObservations: ConflictObservation[] = [];
  const persistedHostname = normalizeConflictHostname(asset.name);
  if (persistedHostname) {
    hostnameObservations.push({
      assetId: asset.id,
      value: asset.name,
      normalizedValue: persistedHostname,
      attribute: 'HOSTNAME',
      source: 'ASSET_PERSISTED_VALUE',
      sourceType: 'UNKNOWN',
      evidenceId: null,
      observedAt: null,
      ingestedAt: null,
      current: true,
    });
  } else {
    limitations.push('O nome persistido do ativo não contém um hostname normalizado válido.');
  }

  for (const attribute of asset.attributes) {
    const value = stringValue(attribute.valueText, attribute.value);
    const normalizedValue = normalizeConflictHostname(value);
    if (!normalizedValue) {
      limitations.push('Uma observação de hostname vazia ou inválida foi ignorada na detecção.');
      continue;
    }
    const source = observationSource(attribute.evidence);
    hostnameObservations.push({
      assetId: asset.id,
      value,
      normalizedValue,
      attribute: 'HOSTNAME',
      source: source.identifier,
      sourceType: source.kind,
      evidenceId: attribute.evidence?.id ?? attribute.evidenceId,
      observedAt: attribute.observedAt.toISOString(),
      ingestedAt: attribute.evidence?.ingestedAt.toISOString() ?? null,
      current: attribute.isCurrent,
    });
  }

  const ipObservations: ConflictObservation[] = [];
  for (const networkInterface of asset.networkInterfaces) {
    for (const value of networkInterface.ipAddresses) {
      const normalizedValue = normalizeConflictIp(value);
      if (!normalizedValue) {
        limitations.push('Um endereço de rede vazio ou inválido foi ignorado na detecção.');
        continue;
      }
      const source = observationSource(networkInterface.evidence);
      ipObservations.push({
        assetId: asset.id,
        value,
        normalizedValue,
        attribute: 'IP_ADDRESS',
        source: source.identifier,
        sourceType: source.kind,
        evidenceId: networkInterface.evidence?.id ?? networkInterface.evidenceId,
        observedAt:
          networkInterface.observedAt?.toISOString() ??
          networkInterface.evidence?.observedAt.toISOString() ??
          null,
        ingestedAt: networkInterface.evidence?.ingestedAt.toISOString() ?? null,
        current: networkInterface.isCurrent,
      });
    }
  }
  if (asset.networkInterfaces.length === 0) {
    limitations.push('O ativo não possui interfaces de rede disponíveis para análise.');
  }

  return {
    assetId: asset.id,
    snapshotAt: asset.updatedAt.toISOString(),
    hostnameObservations,
    ipObservations,
    limitations: [...new Set(limitations)].sort(),
  };
}

function stringValue(valueText: string | null, value: unknown): string {
  if (valueText !== null) return valueText;
  return typeof value === 'string' ? value : '';
}

function observationSource(evidence: EvidenceProjection): {
  identifier: string;
  kind: ConflictSourceType;
} {
  const source = evidenceSource(evidence?.source ?? null, evidence?.evidenceType ?? null);
  return { identifier: source.identifier, kind: source.kind };
}
