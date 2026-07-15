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
  ASSET_MANUALLY_DECLARED: 'Ativo declarado manualmente',
  ASSET_MANUALLY_ENRICHED: 'Ativo enriquecido manualmente',
  ASSET_IMPORTED_FROM_CSV: 'Ativo importado',
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
  COMMENT: 'Comentário',
  CRITICALITY: 'Criticidade',
  DEPARTMENT: 'Departamento',
  ENVIRONMENT: 'Ambiente',
  HOSTNAME: 'Hostname atual',
  LOCATION: 'Localização',
  MANUFACTURER: 'Fabricante',
  MODEL: 'Modelo',
  OPERATINGSYSTEM: 'Sistema operacional',
  OSVERSION: 'Versão do sistema operacional',
  OWNER: 'Responsável',
  SERIALNUMBER: 'Número de série',
  TYPE: 'Tipo',
};

const evidenceTypeLabels: Record<string, string> = {
  CSV_MANUAL_IMPORT: 'Importação manual por CSV',
  DATA_QUALITY_FIXTURE: 'Registro de qualidade de dados',
  DEMO_ASSET_SNAPSHOT: 'Captura simulada do ativo',
  MANUAL_ASSET_SNAPSHOT: 'Captura manual do ativo',
  NETWORK_DISCOVERY: 'Descoberta de rede',
  MANUAL_DECLARATION: 'Declaração manual do ativo',
  MANUAL_ENRICHMENT: 'Enriquecimento manual',
  SOURCE_SNAPSHOT: 'Captura da fonte',
  SPREADSHEET_MANUAL_IMPORT: 'Importação manual por planilha',
  TECHNICAL_AGENT: 'Agente técnico',
};

const auditActionLabels: Record<string, string> = {
  ADMIN_STATUS_CHANGED: 'Status administrativo alterado',
  CONFLICT_STATUS_CHANGED: 'Status do conflito alterado',
  NETWORK_DISCOVERY_RUN_EXECUTED: 'Descoberta de rede executada',
  NETWORK_DISCOVERY_RUN_REJECTED: 'Descoberta de rede rejeitada',
  NETWORK_DISCOVERY_RUN_FAILED: 'Descoberta de rede com falha',
  ASSET_MANUALLY_DECLARED: 'Ativo declarado manualmente',
  ASSET_MANUALLY_ENRICHED: 'Ativo enriquecido manualmente',
  ASSET_IMPORTED_FROM_CSV: 'Ativo importado',
};

const manualIdentifierTypeLabels: Record<string, string> = {
  HOSTNAME: 'Hostname',
  SERIAL_NUMBER: 'Número de série',
  ASSET_TAG: 'Etiqueta patrimonial',
  MAC_ADDRESS: 'Endereço MAC',
  INTERNAL_NAME: 'Nome interno',
};

const auditActorTypeLabels: Record<string, string> = {
  USER: 'Usuário',
  SYSTEM: 'Sistema',
  SERVICE: 'Serviço',
};

const auditEntityTypeLabels: Record<string, string> = {
  ASSET: 'Ativo',
  CONFLICT: 'Conflito',
  NETWORKDISCOVERYRUN: 'Execução de descoberta',
  NETWORKDISCOVERYPROFILE: 'Perfil de descoberta',
};

const auditValueLabels: Record<string, string> = {
  IN_USE: 'Em uso',
  IN_STOCK: 'Em estoque',
  MAINTENANCE: 'Em manutenção',
  DEACTIVATED: 'Desativado',
  DISCARDED: 'Descartado',
  LOST: 'Perdido',
  STOLEN: 'Roubado/Furtado',
  ARCHIVED: 'Arquivado',
  OPEN: 'Aberto',
  IN_REVIEW: 'Em análise',
  RESOLVED: 'Resolvido',
  IGNORED: 'Ignorado',
  EXCEPTION: 'Exceção',
  RUNNING: 'Em execução',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada',
};

const dataQualityIssueLabels: Record<string, string> = {
  LOW_DATA_QUALITY: 'Baixa qualidade',
  LOW_CONFIDENCE: 'Baixa confiabilidade',
  MISSING_SERIAL_NUMBER: 'Sem número de série',
  MISSING_MANUFACTURER: 'Sem fabricante',
  MISSING_MODEL: 'Sem modelo',
  MISSING_OPERATING_SYSTEM: 'Sem sistema operacional',
  MISSING_NETWORK_INFO: 'Sem rede identificada',
  MISSING_ADMINISTRATIVE_STATUS: 'Sem status administrativo',
  WITHOUT_RECENT_EVIDENCE: 'Sem evidência recente',
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

export function getAuditActionLabel(value: string): string {
  return labelFrom(auditActionLabels, value);
}

export function getAuditActorTypeLabel(value: string): string {
  return labelFrom(auditActorTypeLabels, value);
}

export function getAuditEntityTypeLabel(value: string): string {
  return auditEntityTypeLabels[normalizeKey(value)] ?? humanizeTechnicalLabel(value);
}

export function getAuditValueLabel(value: string): string {
  return labelFrom(auditValueLabels, value);
}

export function getDataQualityIssueLabel(value: string): string {
  return labelFrom(dataQualityIssueLabels, value);
}

export function getManualIdentifierTypeLabel(value: string): string {
  return labelFrom(manualIdentifierTypeLabels, value);
}
