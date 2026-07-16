const CANONICAL_ATTRIBUTE_KEYS: Record<string, string> = {
  ADMINISTRATIVESTATUS: 'administrativeStatus',
  CATEGORY: 'category',
  COMMENT: 'comment',
  CRITICALITY: 'criticality',
  DEPARTMENT: 'department',
  ENVIRONMENT: 'environment',
  HOSTNAME: 'hostname',
  LOCATION: 'location',
  MANUFACTURER: 'manufacturer',
  MODEL: 'model',
  OPERATINGSYSTEM: 'operatingSystem',
  OPERATINGSYSTEMVERSION: 'osVersion',
  OS: 'operatingSystem',
  OSVERSION: 'osVersion',
  OWNER: 'owner',
  SERIALNUMBER: 'serialNumber',
  TYPE: 'type',
};

export function normalizeAttributeKey(key: string): string {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return CANONICAL_ATTRIBUTE_KEYS[normalized] ?? key.trim();
}

export function normalizeCandidateValue(valueText: string | null, value: unknown): string | null {
  if (valueText?.trim()) return valueText.trim().toLocaleLowerCase('pt-BR');
  if (typeof value === 'string') {
    const normalizedValue = value.trim();
    return normalizedValue ? normalizedValue.toLocaleLowerCase('pt-BR') : null;
  }
  if (value === null || value === undefined) return null;

  return JSON.stringify(value) ?? null;
}
