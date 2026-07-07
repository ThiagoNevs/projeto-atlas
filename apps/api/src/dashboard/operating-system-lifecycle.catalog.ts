export const OPERATING_SYSTEM_LIFECYCLE_CATALOG_VERSION = '2026-07-01';

export const OBSOLETE_OPERATING_SYSTEM_PATTERNS = [
  'windows xp',
  'windows 7',
  'windows server 2008',
  'windows server 2012',
  'windows server 2012 r2',
] as const;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isObsoleteOperatingSystem(
  operatingSystem: string | null,
  version: string | null,
): boolean {
  if (!operatingSystem) return false;
  const combined = normalize([operatingSystem, version].filter(Boolean).join(' '));

  return OBSOLETE_OPERATING_SYSTEM_PATTERNS.some((pattern) => combined.includes(pattern));
}
