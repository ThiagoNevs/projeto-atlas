import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';

import {
  AdministrativeStatus,
  AttributeValueType,
  ConflictStatus,
  OperationalStatus,
  PrismaClient,
  type AssetEvidence,
  type Prisma,
} from '../src/generated/prisma/client';

const DEMO_PREFIX = 'atlas-demo:';
const DEMO_ACTOR = 'atlas-demo-seed';
const now = new Date();

type DemoEvent = {
  type:
    | 'ASSET_DISCOVERED'
    | 'ASSET_SYNCED'
    | 'ASSET_UPDATED'
    | 'ADMIN_STATUS_CHANGED'
    | 'ASSET_REAPPEARED';
  hoursAgo: number;
  evidenceIndex?: number;
  data?: Prisma.InputJsonObject;
};

type DemoConflict = {
  status: ConflictStatus;
  impact: 'HIGH' | 'CRITICAL';
  occurrenceCount: number;
  detectedHoursAgo: number;
  reason?: string;
  comment?: string;
};

type DemoScenario = {
  key: string;
  name: string;
  kind: string;
  category: string;
  description: string;
  administrativeStatus: AdministrativeStatus;
  operationalStatus: OperationalStatus;
  confidenceScore: number;
  dataQualityScore: number;
  evidenceHoursAgo: number[];
  events: DemoEvent[];
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  operatingSystem?: string;
  osVersion?: string;
  macAddress?: string;
  ipAddresses?: string[];
  evidenceIpAddresses?: string[][];
  evidenceHostnames?: string[];
  previousHostname?: string;
  conflict?: DemoConflict;
};

function hoursAgo(hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

const scenarios: DemoScenario[] = [
  {
    key: 'notebook-rh-001',
    name: 'NB-RH-001',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook corporativo do time de Recursos Humanos.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 98,
    dataQualityScore: 97,
    evidenceHoursAgo: [2],
    events: [{ type: 'ASSET_DISCOVERED', hoursAgo: 2 }],
    manufacturer: 'Lenovo',
    model: 'ThinkPad T14',
    serialNumber: 'DEMO-RH-001',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:01',
    ipAddresses: ['10.20.0.21'],
  },
  {
    key: 'server-app-01',
    name: 'SRV-APP-01',
    kind: 'SERVER',
    category: 'APPLICATION',
    description: 'Servidor Linux que hospeda aplicações internas simuladas.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.OPERATIONAL,
    confidenceScore: 99,
    dataQualityScore: 98,
    evidenceHoursAgo: [336, 24, 1],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 336, evidenceIndex: 0 },
      { type: 'ASSET_SYNCED', hoursAgo: 24, evidenceIndex: 1 },
      { type: 'ASSET_SYNCED', hoursAgo: 1, evidenceIndex: 2 },
    ],
    manufacturer: 'Dell',
    model: 'PowerEdge R650',
    serialNumber: 'DEMO-APP-001',
    operatingSystem: 'Ubuntu Server',
    osVersion: '24.04',
    macAddress: '02:42:ac:20:00:11',
    ipAddresses: ['10.30.0.11'],
  },
  {
    key: 'vm-web-02',
    name: 'VM-WEB-02',
    previousHostname: 'VM-WEB-OLD',
    kind: 'VM',
    category: 'WEB',
    description: 'Máquina virtual web que passou por padronização de hostname.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 96,
    dataQualityScore: 94,
    evidenceHoursAgo: [240, 3],
    evidenceHostnames: ['VM-WEB-OLD', 'VM-WEB-02'],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 240, evidenceIndex: 0 },
      {
        type: 'ASSET_UPDATED',
        hoursAgo: 3,
        evidenceIndex: 1,
        data: { changedFields: ['hostname'], previousHostname: 'VM-WEB-OLD' },
      },
    ],
    manufacturer: 'VMware',
    model: 'Virtual Machine',
    serialNumber: 'DEMO-VM-WEB-02',
    operatingSystem: 'Ubuntu Server',
    osVersion: '22.04',
    macAddress: '02:42:ac:20:00:22',
    ipAddresses: ['172.16.10.22'],
  },
  {
    key: 'server-db-01',
    name: 'SRV-DB-01',
    kind: 'SERVER',
    category: 'DATABASE',
    description: 'Servidor de banco com alteração recente de endereço IP.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.OPERATIONAL,
    confidenceScore: 97,
    dataQualityScore: 96,
    evidenceHoursAgo: [168, 2],
    evidenceIpAddresses: [['10.30.0.20'], ['10.30.0.21']],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 168, evidenceIndex: 0 },
      {
        type: 'ASSET_UPDATED',
        hoursAgo: 2,
        evidenceIndex: 1,
        data: { changedFields: ['networkInterfaces'], previousIpAddress: '10.30.0.20' },
      },
    ],
    manufacturer: 'HPE',
    model: 'ProLiant DL360',
    serialNumber: 'DEMO-DB-001',
    operatingSystem: 'Red Hat Enterprise Linux',
    osVersion: '9.4',
    macAddress: '02:42:ac:20:00:31',
    ipAddresses: ['10.30.0.20', '10.30.0.21'],
  },
  {
    key: 'notebook-fin-014',
    name: 'NB-FIN-014',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Ativo com dados incompletos e baixa qualidade cadastral.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 46,
    dataQualityScore: 34,
    evidenceHoursAgo: [18],
    events: [{ type: 'ASSET_DISCOVERED', hoursAgo: 18 }],
    operatingSystem: 'Windows',
    macAddress: '02:42:ac:20:00:41',
    ipAddresses: ['10.20.0.44'],
  },
  {
    key: 'notebook-jur-008',
    name: 'NB-JUR-008',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook desativado há semanas e sem nova evidência técnica.',
    administrativeStatus: AdministrativeStatus.DEACTIVATED,
    operationalStatus: OperationalStatus.UNAVAILABLE,
    confidenceScore: 90,
    dataQualityScore: 88,
    evidenceHoursAgo: [720],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 900 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 700 },
    ],
    manufacturer: 'Dell',
    model: 'Latitude 5440',
    serialNumber: 'DEMO-JUR-008',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:51',
    ipAddresses: ['10.20.0.58'],
  },
  {
    key: 'notebook-sup-021',
    name: 'NB-SUP-021',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook desativado que voltou a reportar telemetria.',
    administrativeStatus: AdministrativeStatus.DEACTIVATED,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 95,
    dataQualityScore: 93,
    evidenceHoursAgo: [720, 1],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 900, evidenceIndex: 0 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 700, evidenceIndex: 0 },
      { type: 'ASSET_REAPPEARED', hoursAgo: 1, evidenceIndex: 1 },
    ],
    manufacturer: 'Lenovo',
    model: 'ThinkPad E14',
    serialNumber: 'DEMO-SUP-021',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:61',
    ipAddresses: ['10.20.0.61'],
    conflict: {
      status: ConflictStatus.OPEN,
      impact: 'HIGH',
      occurrenceCount: 1,
      detectedHoursAgo: 1,
    },
  },
  {
    key: 'notebook-com-007',
    name: 'NB-COM-007',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook perdido que reapareceu em uma rede corporativa simulada.',
    administrativeStatus: AdministrativeStatus.LOST,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 91,
    dataQualityScore: 89,
    evidenceHoursAgo: [480, 4],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 600, evidenceIndex: 0 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 460, evidenceIndex: 0 },
      { type: 'ASSET_REAPPEARED', hoursAgo: 4, evidenceIndex: 1 },
    ],
    manufacturer: 'HP',
    model: 'EliteBook 840',
    serialNumber: 'DEMO-COM-007',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:71',
    ipAddresses: ['10.20.0.71'],
    conflict: {
      status: ConflictStatus.OPEN,
      impact: 'CRITICAL',
      occurrenceCount: 1,
      detectedHoursAgo: 4,
    },
  },
  {
    key: 'workstation-eng-004',
    name: 'WS-ENG-004',
    kind: 'WORKSTATION',
    category: 'ENGINEERING',
    description: 'Estação descartada que voltou a enviar evidência técnica.',
    administrativeStatus: AdministrativeStatus.DISCARDED,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 94,
    dataQualityScore: 92,
    evidenceHoursAgo: [1440, 5],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 1700, evidenceIndex: 0 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 1400, evidenceIndex: 0 },
      { type: 'ASSET_REAPPEARED', hoursAgo: 5, evidenceIndex: 1 },
    ],
    manufacturer: 'Dell',
    model: 'Precision 3660',
    serialNumber: 'DEMO-ENG-004',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:81',
    ipAddresses: ['10.20.0.81'],
    conflict: {
      status: ConflictStatus.OPEN,
      impact: 'HIGH',
      occurrenceCount: 2,
      detectedHoursAgo: 5,
    },
  },
  {
    key: 'notebook-dir-003',
    name: 'NB-DIR-003',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook registrado como roubado com conflito em análise.',
    administrativeStatus: AdministrativeStatus.STOLEN,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 93,
    dataQualityScore: 91,
    evidenceHoursAgo: [720, 6],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 900, evidenceIndex: 0 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 700, evidenceIndex: 0 },
      { type: 'ASSET_REAPPEARED', hoursAgo: 8, evidenceIndex: 1 },
    ],
    manufacturer: 'Apple',
    model: 'MacBook Pro 14',
    serialNumber: 'DEMO-DIR-003',
    operatingSystem: 'macOS',
    osVersion: '15.5',
    macAddress: '02:42:ac:20:00:91',
    ipAddresses: ['10.20.0.91'],
    conflict: {
      status: ConflictStatus.IN_REVIEW,
      impact: 'CRITICAL',
      occurrenceCount: 2,
      detectedHoursAgo: 8,
      reason: 'Investigação iniciada',
      comment: 'Segurança e suporte estão validando a origem da nova evidência.',
    },
  },
  {
    key: 'vm-legacy-01',
    name: 'VM-LEGACY-01',
    kind: 'VM',
    category: 'LEGACY',
    description: 'Máquina virtual arquivada mantida como exceção temporária.',
    administrativeStatus: AdministrativeStatus.ARCHIVED,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 88,
    dataQualityScore: 86,
    evidenceHoursAgo: [2160, 12],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 2400, evidenceIndex: 0 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 2100, evidenceIndex: 0 },
      { type: 'ASSET_REAPPEARED', hoursAgo: 16, evidenceIndex: 1 },
    ],
    manufacturer: 'VMware',
    model: 'Virtual Machine',
    serialNumber: 'DEMO-LEGACY-01',
    operatingSystem: 'CentOS Linux',
    osVersion: '7',
    macAddress: '02:42:ac:20:00:a1',
    ipAddresses: ['172.16.10.41'],
    conflict: {
      status: ConflictStatus.EXCEPTION,
      impact: 'HIGH',
      occurrenceCount: 1,
      detectedHoursAgo: 16,
      reason: 'Exceção operacional aprovada',
      comment: 'A aplicação legada permanecerá acessível durante a transição simulada.',
    },
  },
  {
    key: 'notebook-ti-009',
    name: 'NB-TI-009',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook em manutenção para troca preventiva de armazenamento.',
    administrativeStatus: AdministrativeStatus.MAINTENANCE,
    operationalStatus: OperationalStatus.DEGRADED,
    confidenceScore: 96,
    dataQualityScore: 95,
    evidenceHoursAgo: [8],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 240 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 8 },
    ],
    manufacturer: 'Dell',
    model: 'Latitude 5440',
    serialNumber: 'DEMO-TI-009',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:b1',
    ipAddresses: ['10.20.0.101'],
  },
  {
    key: 'notebook-stock-012',
    name: 'NB-EST-012',
    kind: 'NOTEBOOK',
    category: 'ENDPOINT',
    description: 'Notebook higienizado e disponível em estoque para nova alocação.',
    administrativeStatus: AdministrativeStatus.IN_STOCK,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 97,
    dataQualityScore: 96,
    evidenceHoursAgo: [72],
    events: [
      { type: 'ASSET_DISCOVERED', hoursAgo: 360 },
      { type: 'ADMIN_STATUS_CHANGED', hoursAgo: 72 },
    ],
    manufacturer: 'Lenovo',
    model: 'ThinkPad L14',
    serialNumber: 'DEMO-EST-012',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '23H2',
    macAddress: '02:42:ac:20:00:c1',
    ipAddresses: ['10.20.0.112'],
  },
  {
    key: 'switch-floor-03',
    name: 'SW-ANDAR-03',
    kind: 'NETWORK_DEVICE',
    category: 'NETWORK',
    description: 'Switch de acesso do terceiro andar em operação normal.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.OPERATIONAL,
    confidenceScore: 99,
    dataQualityScore: 97,
    evidenceHoursAgo: [1],
    events: [{ type: 'ASSET_DISCOVERED', hoursAgo: 1 }],
    manufacturer: 'Cisco',
    model: 'Catalyst 9200',
    serialNumber: 'DEMO-SW-003',
    operatingSystem: 'Cisco IOS XE',
    osVersion: '17.12',
    macAddress: '02:42:ac:20:00:d1',
    ipAddresses: ['172.16.10.3'],
  },
  {
    key: 'printer-rh-02',
    name: 'PRN-RH-02',
    kind: 'PRINTER',
    category: 'INFRASTRUCTURE',
    description: 'Impressora de rede descoberta com informações parcialmente completas.',
    administrativeStatus: AdministrativeStatus.IN_USE,
    operationalStatus: OperationalStatus.SEEN_RECENTLY,
    confidenceScore: 68,
    dataQualityScore: 61,
    evidenceHoursAgo: [48],
    events: [{ type: 'ASSET_DISCOVERED', hoursAgo: 48 }],
    manufacturer: 'HP',
    model: 'LaserJet Pro',
    macAddress: '02:42:ac:20:00:e1',
    ipAddresses: ['172.16.10.52'],
  },
];

const eventTitles: Record<DemoEvent['type'], string> = {
  ASSET_DISCOVERED: 'Ativo descoberto',
  ASSET_SYNCED: 'Ativo sincronizado',
  ASSET_UPDATED: 'Ativo atualizado',
  ADMIN_STATUS_CHANGED: 'Status administrativo alterado',
  ASSET_REAPPEARED: 'Ativo encerrado voltou a aparecer',
};

function attributeCandidates(scenario: DemoScenario): Array<[string, string]> {
  return [
    ['hostname', scenario.name],
    ['type', scenario.kind],
    ['category', scenario.category],
    ['manufacturer', scenario.manufacturer],
    ['model', scenario.model],
    ['serialNumber', scenario.serialNumber],
    ['operatingSystem', scenario.operatingSystem],
    ['osVersion', scenario.osVersion],
  ].filter((candidate): candidate is [string, string] => Boolean(candidate[1]));
}

async function createScenario(
  transaction: Prisma.TransactionClient,
  scenario: DemoScenario,
): Promise<void> {
  const firstSeenAt = hoursAgo(Math.max(...scenario.evidenceHoursAgo));
  const lastSeenAt = hoursAgo(Math.min(...scenario.evidenceHoursAgo));
  const asset = await transaction.asset.create({
    data: {
      canonicalKey: `${DEMO_PREFIX}${scenario.key}`,
      name: scenario.name,
      kind: scenario.kind,
      description: scenario.description,
      operationalStatus: scenario.operationalStatus,
      administrativeStatus: scenario.administrativeStatus,
      confidenceScore: scenario.confidenceScore,
      dataQualityScore: scenario.dataQualityScore,
      firstSeenAt,
      lastSeenAt,
      createdAt: firstSeenAt,
      updatedAt: lastSeenAt,
    },
  });

  const evidence: AssetEvidence[] = [];
  for (const [index, evidenceHoursAgo] of scenario.evidenceHoursAgo.entries()) {
    const observedAt = hoursAgo(evidenceHoursAgo);
    const hostname = scenario.evidenceHostnames?.[index] ?? scenario.name;
    const ipAddresses = scenario.evidenceIpAddresses?.[index] ?? scenario.ipAddresses ?? [];
    evidence.push(
      await transaction.assetEvidence.create({
        data: {
          assetId: asset.id,
          source: scenario.kind === 'VM' ? 'atlas-demo-vcenter' : 'atlas-demo-agent',
          sourceRecordId: `${scenario.key}-${index + 1}`,
          evidenceType: 'DEMO_ASSET_SNAPSHOT',
          payload: {
            hostname,
            type: scenario.kind,
            category: scenario.category,
            manufacturer: scenario.manufacturer ?? null,
            model: scenario.model ?? null,
            serialNumber: scenario.serialNumber ?? null,
            operatingSystem: scenario.operatingSystem ?? null,
            osVersion: scenario.osVersion ?? null,
            ipAddresses,
            macAddresses: scenario.macAddress ? [scenario.macAddress] : [],
            simulated: true,
          },
          fingerprint: `atlas-demo-${scenario.key}-${index + 1}`,
          confidenceScore: scenario.confidenceScore,
          dataQualityScore: scenario.dataQualityScore,
          observedAt,
          ingestedAt: observedAt,
        },
      }),
    );
  }

  const latestEvidence = evidence.at(-1)!;
  await transaction.assetAttribute.createMany({
    data: attributeCandidates(scenario).map(([key, value]) => ({
      assetId: asset.id,
      evidenceId: latestEvidence.id,
      key,
      value,
      valueText: value,
      valueType: AttributeValueType.STRING,
      confidenceScore: scenario.confidenceScore,
      dataQualityScore: scenario.dataQualityScore,
      observedAt: lastSeenAt,
      lastConfirmedAt: lastSeenAt,
      confirmationCount: evidence.length,
      validFrom: lastSeenAt,
    })),
  });

  if (scenario.previousHostname) {
    await transaction.assetAttribute.create({
      data: {
        assetId: asset.id,
        evidenceId: evidence[0]!.id,
        key: 'hostname',
        value: scenario.previousHostname,
        valueText: scenario.previousHostname,
        valueType: AttributeValueType.STRING,
        confidenceScore: scenario.confidenceScore,
        dataQualityScore: scenario.dataQualityScore,
        isCurrent: false,
        observedAt: firstSeenAt,
        lastConfirmedAt: firstSeenAt,
        validFrom: firstSeenAt,
        validTo: lastSeenAt,
      },
    });
  }

  if (scenario.macAddress || scenario.ipAddresses?.length) {
    const identityKey = scenario.macAddress
      ? `mac:${scenario.macAddress}`
      : `ip:${scenario.ipAddresses![0]}`;
    await transaction.networkInterface.create({
      data: {
        assetId: asset.id,
        evidenceId: latestEvidence.id,
        identityKey,
        name: scenario.kind === 'NETWORK_DEVICE' ? 'management0' : 'eth0',
        macAddress: scenario.macAddress,
        ipAddresses: scenario.ipAddresses ?? [],
        interfaceIndex: 1,
        isPrimary: true,
        isCurrent: true,
        observedAt: lastSeenAt,
        firstSeenAt,
        lastSeenAt,
        createdAt: firstSeenAt,
        updatedAt: lastSeenAt,
      },
    });
  }

  for (const event of scenario.events) {
    const relatedEvidence = evidence[event.evidenceIndex ?? evidence.length - 1];
    const occurredAt = hoursAgo(event.hoursAgo);
    const lifecycleMessage = `Ativo administrativamente ${scenario.administrativeStatus} voltou a gerar evidência técnica.`;
    await transaction.assetEvent.create({
      data: {
        assetId: asset.id,
        evidenceId: relatedEvidence?.id,
        eventType: event.type,
        title: eventTitles[event.type],
        description:
          event.type === 'ASSET_REAPPEARED'
            ? lifecycleMessage
            : `Evento simulado do cenário ${scenario.key}.`,
        data:
          event.data ??
          (event.type === 'ASSET_REAPPEARED'
            ? {
                administrativeStatus: scenario.administrativeStatus,
                source: relatedEvidence?.source ?? 'atlas-demo-agent',
                evidenceId: relatedEvidence?.id ?? null,
                message: lifecycleMessage,
              }
            : { simulated: true, scenario: scenario.key }),
        occurredAt,
        recordedAt: occurredAt,
      },
    });
  }

  if (!scenario.conflict) {
    return;
  }

  const conflict = await transaction.conflict.create({
    data: {
      assetId: asset.id,
      conflictType: 'LIFECYCLE_CONFLICT',
      attributeKey: 'administrativeStatus',
      status: scenario.conflict.status,
      severity: scenario.conflict.impact === 'CRITICAL' ? 4 : 3,
      impact: scenario.conflict.impact,
      suggestedValue: 'REVIEW_REQUIRED',
      suggestionReason: 'Ativo encerrado voltou a gerar evidência técnica.',
      resolutionNote: scenario.conflict.comment,
      detectedAt: hoursAgo(scenario.conflict.detectedHoursAgo),
      lastDetectedAt: lastSeenAt,
      occurrenceCount: scenario.conflict.occurrenceCount,
      createdAt: hoursAgo(scenario.conflict.detectedHoursAgo),
      updatedAt: lastSeenAt,
      values: {
        create: Array.from({ length: scenario.conflict.occurrenceCount }, (_, index) => {
          const relatedEvidence = evidence[Math.min(index, evidence.length - 1)]!;
          return {
            evidenceId: relatedEvidence.id,
            value: {
              administrativeStatus: scenario.administrativeStatus,
              message: `Evidência simulada ${index + 1} após encerramento administrativo.`,
            },
            normalizedValue: scenario.administrativeStatus,
            source: relatedEvidence.source,
            confidenceScore: scenario.confidenceScore,
            observedAt: relatedEvidence.observedAt,
            createdAt: relatedEvidence.observedAt,
          };
        }),
      },
    },
  });

  if (scenario.conflict.status === ConflictStatus.OPEN) {
    return;
  }

  const changedAt = hoursAgo(Math.max(1, scenario.conflict.detectedHoursAgo - 1));
  const reason = scenario.conflict.reason ?? 'Tratamento simulado';
  const comment = scenario.conflict.comment ?? 'Decisão registrada pela massa de demonstração.';
  await transaction.assetEvent.create({
    data: {
      assetId: asset.id,
      eventType: 'CONFLICT_STATUS_CHANGED',
      title: 'Status do conflito alterado',
      description: `OPEN → ${scenario.conflict.status}: ${reason}`,
      data: {
        conflictId: conflict.id,
        conflictType: 'LIFECYCLE_CONFLICT',
        field: 'administrativeStatus',
        previousStatus: 'OPEN',
        newStatus: scenario.conflict.status,
        reason,
        comment,
        actorUserId: DEMO_ACTOR,
      },
      occurredAt: changedAt,
      recordedAt: changedAt,
    },
  });
  await transaction.auditLog.create({
    data: {
      assetId: asset.id,
      actorType: 'USER',
      actorId: DEMO_ACTOR,
      action: 'CONFLICT_STATUS_CHANGED',
      entityType: 'Conflict',
      entityId: conflict.id,
      before: { status: 'OPEN' },
      after: { status: scenario.conflict.status },
      metadata: { reason, comment, simulated: true },
      occurredAt: changedAt,
    },
  });
}

async function main(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to execute the demo seed.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.auditLog.deleteMany({ where: { actorId: DEMO_ACTOR } });
        await transaction.asset.deleteMany({
          where: { canonicalKey: { startsWith: DEMO_PREFIX } },
        });

        for (const scenario of scenarios) {
          await createScenario(transaction, scenario);
        }
      },
      { timeout: 60_000 },
    );

    const assets = await prisma.asset.findMany({
      where: { canonicalKey: { startsWith: DEMO_PREFIX } },
      select: { id: true },
    });
    const assetIds = assets.map((asset) => asset.id);
    const [evidenceCount, eventCount, conflictCount] = await Promise.all([
      prisma.assetEvidence.count({ where: { assetId: { in: assetIds } } }),
      prisma.assetEvent.count({ where: { assetId: { in: assetIds } } }),
      prisma.conflict.count({ where: { assetId: { in: assetIds } } }),
    ]);

    console.log(
      `Demo Atlas criada: ${assets.length} ativos, ${evidenceCount} evidências, ${eventCount} eventos e ${conflictCount} conflitos.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error('Falha ao criar a massa de demonstração do Atlas.', error);
  process.exitCode = 1;
});
