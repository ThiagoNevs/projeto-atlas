const eventLabels: Record<string, string> = {
  ASSET_DISCOVERED: 'Ativo descoberto',
  ASSET_SYNCED: 'Ativo sincronizado',
  ASSET_UPDATED: 'Ativo atualizado',
  ADMIN_STATUS_CHANGED: 'Status administrativo alterado',
  ASSET_REAPPEARED: 'Ativo encerrado reapareceu',
  CONFLICT_STATUS_CHANGED: 'Status do conflito alterado',
  NETWORK_DISCOVERY_RUN_STARTED: 'Descoberta de rede iniciada',
  NETWORK_DISCOVERY_ASSET_FOUND: 'Ativo encontrado pela descoberta de rede',
  NETWORK_DISCOVERY_RUN_FINISHED: 'Descoberta de rede concluída',
};

const conflictStatusLabels: Record<string, string> = {
  OPEN: 'Aberto',
  IN_REVIEW: 'Em análise',
  RESOLVED: 'Resolvido',
  IGNORED: 'Ignorado',
  EXCEPTION: 'Exceção',
  DISMISSED: 'Dispensado',
};

const impactLabels: Record<string, string> = {
  LOW: 'Baixo',
  MEDIUM: 'Médio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
};

const conflictTypeLabels: Record<string, string> = {
  LIFECYCLE_CONFLICT: 'Conflito de ciclo de vida',
  ATTRIBUTE_CONFLICT: 'Conflito de atributo',
  NETWORK_IDENTITY_CONFLICT: 'Conflito de identidade de rede',
};

const discoveryModeLabels: Record<string, string> = {
  PASSIVE: 'Passivo',
  LIGHT: 'Leve',
  CONTROLLED: 'Controlado',
};

const discoveryMethodLabels: Record<string, string> = {
  ICMP_SIMULATED: 'ICMP simulado',
  DNS_REVERSE_SIMULATED: 'DNS reverso simulado',
  ARP_SIMULATED: 'ARP simulado',
};

const discoveryRunStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  RUNNING: 'Em execução',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada',
};

const discoveryResultStatusLabels: Record<string, string> = {
  DISCOVERED: 'Ativo descoberto',
  UPDATED: 'Ativo atualizado',
  SKIPPED: 'Ignorado com segurança',
  ERROR: 'Erro',
};

const assetTypeLabels: Record<string, string> = {
  SERVER: 'Servidor',
  NOTEBOOK: 'Notebook',
  DESKTOP: 'Desktop',
  WORKSTATION: 'Estação de trabalho',
  VM: 'Máquina virtual',
  NETWORK_DEVICE: 'Dispositivo de rede',
  PRINTER: 'Impressora',
  STORAGE: 'Armazenamento',
  UNKNOWN: 'Desconhecido',
};

const attributeLabels: Record<string, string> = {
  ADMINISTRATIVESTATUS: 'Status administrativo',
  CATEGORY: 'Categoria',
  HOSTNAME: 'Hostname atual',
  MANUFACTURER: 'Fabricante',
  MODEL: 'Modelo',
  OPERATINGSYSTEM: 'Sistema operacional',
  OSVERSION: 'Versão do sistema operacional',
  SERIALNUMBER: 'Número de série',
  TYPE: 'Tipo',
};

const evidenceTypeLabels: Record<string, string> = {
  DEMO_ASSET_SNAPSHOT: 'Captura simulada do ativo',
  MANUAL_ASSET_SNAPSHOT: 'Captura manual do ativo',
  NETWORK_DISCOVERY: 'Descoberta de rede',
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function labelFrom(map: Record<string, string>, value: string): string {
  return map[value.trim().toUpperCase()] ?? humanizeTechnicalLabel(value);
}

export function humanizeTechnicalLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getEventLabel(value: string): string {
  return labelFrom(eventLabels, value);
}

export function getConflictStatusLabel(value: string): string {
  return labelFrom(conflictStatusLabels, value);
}

export function getImpactLabel(value: string | null): string {
  return value ? labelFrom(impactLabels, value) : 'Não informado';
}

export function getConflictTypeLabel(value: string): string {
  return labelFrom(conflictTypeLabels, value);
}

export function getAssetTypeLabel(value: string): string {
  return labelFrom(assetTypeLabels, value);
}

export function getAttributeLabel(value: string): string {
  return attributeLabels[normalizeKey(value)] ?? humanizeTechnicalLabel(value);
}

export function getEvidenceTypeLabel(value: string): string {
  return labelFrom(evidenceTypeLabels, value);
}

export function getDiscoveryModeLabel(value: string): string {
  return labelFrom(discoveryModeLabels, value);
}

export function getDiscoveryMethodLabel(value: string): string {
  return labelFrom(discoveryMethodLabels, value);
}

export function getDiscoveryRunStatusLabel(value: string): string {
  return labelFrom(discoveryRunStatusLabels, value);
}

export function getDiscoveryResultStatusLabel(value: string): string {
  return labelFrom(discoveryResultStatusLabels, value);
}
