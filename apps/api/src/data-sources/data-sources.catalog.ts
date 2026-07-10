export type DataSourceStatus = 'AVAILABLE' | 'PLANNED' | 'FUTURE';

export interface DataSourceCatalogItem {
  id: string;
  name: string;
  category: string;
  status: DataSourceStatus;
  description: string;
  evidenceType: string | null;
  current: boolean;
}

export const DATA_SOURCE_CATALOG: DataSourceCatalogItem[] = [
  {
    id: 'manual-declaration',
    name: 'Cadastro manual',
    category: 'Manual',
    status: 'AVAILABLE',
    description: 'Permite declarar ativos que existem, mas ainda não possuem evidência técnica.',
    evidenceType: 'MANUAL_DECLARATION',
    current: true,
  },
  {
    id: 'manual-enrichment',
    name: 'Enriquecimento manual',
    category: 'Manual',
    status: 'AVAILABLE',
    description:
      'Permite complementar informações ausentes de ativos existentes com motivo e auditoria.',
    evidenceType: 'MANUAL_ENRICHMENT',
    current: true,
  },
  {
    id: 'network-discovery-lite',
    name: 'Network Discovery Lite',
    category: 'Descoberta de rede',
    status: 'AVAILABLE',
    description: 'Descoberta controlada e simulada para gerar evidências de rede no MVP.',
    evidenceType: 'NETWORK_DISCOVERY',
    current: true,
  },
  {
    id: 'csv-import',
    name: 'Importação CSV',
    category: 'Arquivo',
    status: 'PLANNED',
    description:
      'Permitirá importar ativos em massa com pré-validação, pré-visualização e auditoria.',
    evidenceType: null,
    current: false,
  },
  {
    id: 'microsoft-intune',
    name: 'Microsoft Intune',
    category: 'Microsoft',
    status: 'PLANNED',
    description:
      'Futuro conector para dispositivos gerenciados, sistema operacional, serial, usuário e último check-in.',
    evidenceType: null,
    current: false,
  },
  {
    id: 'microsoft-defender',
    name: 'Microsoft Defender',
    category: 'Segurança',
    status: 'PLANNED',
    description:
      'Futuro conector para sinais de segurança, presença de agente e visibilidade de endpoints.',
    evidenceType: null,
    current: false,
  },
  {
    id: 'active-directory-entra-id',
    name: 'Active Directory / Entra ID',
    category: 'Identidade',
    status: 'PLANNED',
    description:
      'Futuro conector para identidade, dispositivos, usuários e contexto organizacional.',
    evidenceType: null,
    current: false,
  },
  {
    id: 'vulnerability-tools',
    name: 'Ferramentas de vulnerabilidade',
    category: 'Segurança',
    status: 'FUTURE',
    description:
      'Futuro conector para correlacionar ativos com scanners como Tenable, Qualys ou Nessus.',
    evidenceType: null,
    current: false,
  },
  {
    id: 'cloud-providers',
    name: 'Cloud providers',
    category: 'Cloud',
    status: 'FUTURE',
    description: 'Futuro conector para ativos em AWS, Azure e GCP.',
    evidenceType: null,
    current: false,
  },
  {
    id: 'cmdb-itsm',
    name: 'CMDB / ITSM',
    category: 'Governança',
    status: 'FUTURE',
    description:
      'Futuro conector para cruzar o inventário técnico com bases administrativas como ServiceNow, GLPI ou Jira Service Management.',
    evidenceType: null,
    current: false,
  },
];
