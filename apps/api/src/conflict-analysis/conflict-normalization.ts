import { isIP } from 'node:net';

export function normalizeConflictHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase('pt-BR');
  if (!normalized || normalized.length > 253) return null;

  const labels = normalized.split('.');
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    )
  ) {
    return null;
  }

  return normalized;
}

export function normalizeConflictIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const version = isIP(trimmed);
  if (version === 4) return trimmed.split('.').map(Number).join('.');
  if (version !== 6) return null;

  try {
    return new URL(`http://[${trimmed}]`).hostname.slice(1, -1).toLocaleLowerCase();
  } catch {
    return null;
  }
}
