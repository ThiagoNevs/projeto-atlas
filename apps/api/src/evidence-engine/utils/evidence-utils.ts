import { EvidenceSource, EvidenceSourceKind } from '../types/evidence-source';

type Score = { toNumber(): number } | number | null;

export function scoreToNumber(score: Score): number | null {
  if (score === null) return null;
  return typeof score === 'number' ? score : score.toNumber();
}

export function evidenceSource(
  source: string | null,
  evidenceType: string | null,
): EvidenceSource {
  const identifier = source?.trim() || 'UNKNOWN';

  return {
    identifier,
    kind: evidenceSourceKind(identifier, evidenceType),
    evidenceType,
    trustScore: null,
  };
}

function evidenceSourceKind(source: string, evidenceType: string | null): EvidenceSourceKind {
  const normalizedSource = source.trim().toUpperCase();
  const normalizedType = evidenceType?.trim().toUpperCase() ?? '';

  if (
    normalizedSource === 'MANUAL' ||
    normalizedType === 'MANUAL_DECLARATION' ||
    normalizedType === 'MANUAL_ENRICHMENT' ||
    normalizedType.endsWith('_MANUAL_IMPORT')
  ) {
    return 'MANUAL';
  }

  if (
    normalizedSource.includes('DEMO') ||
    normalizedSource === 'NETWORK-DISCOVERY-LITE' ||
    normalizedType === 'NETWORK_DISCOVERY' ||
    normalizedType === 'MANUAL_ASSET_SNAPSHOT' ||
    normalizedType.startsWith('DEMO_')
  ) {
    return 'SIMULATED';
  }

  if (normalizedType.startsWith('TECHNICAL_')) return 'TECHNICAL';
  return 'UNKNOWN';
}
