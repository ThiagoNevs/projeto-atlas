import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';

import { describe, expect, it, beforeAll, afterAll, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  NetworkDiscoveryResultStatus,
  NetworkDiscoveryRunStatus,
} from '../src/generated/prisma/client';
import { NetworkDiscoveryService } from '../src/network-discovery/network-discovery.service';
import { PrismaService } from '../src/prisma/prisma.service';

type IngestionResponse = {
  action: 'created' | 'updated' | 'synced';
  eventType: 'ASSET_DISCOVERED' | 'ASSET_SYNCED' | 'ASSET_UPDATED' | 'ASSET_REAPPEARED';
  changedFields: string[];
  evidenceId: string;
  eventId: string;
  lifecycleConflict: null | {
    id: string;
    conflictType: 'LIFECYCLE_CONFLICT';
    status: 'OPEN';
    impact: 'HIGH';
    occurrenceCount: number;
  };
  asset: {
    id: string;
    atlasId: string;
    name: string;
    networkInterfaces: Array<{
      id: string;
      macAddress: string | null;
      ipAddresses: string[];
    }>;
  };
};

type ConflictDetailResponse = {
  conflict: Record<string, unknown>;
  asset: Record<string, unknown>;
  values: unknown[];
  metadata: Record<string, unknown>;
  timeline: Array<Record<string, unknown>>;
};

type ConflictStatusUpdateResponse = {
  previousStatus: string;
  status: string;
  eventId: string;
  auditLogId: string;
};

type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type AuditLogItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
};

type AuditLogListResponse = PaginatedResponse<AuditLogItem> & {
  summary: {
    total: number;
    administrativeChanges: number;
    conflictTreatments: number;
    discoveryExecutions: number;
    failuresOrRejections: number;
  };
};

type DataQualityAssetResponse = {
  id: string;
  dataQualityScore: number | null;
  confidenceScore: number | null;
  issues: string[];
  missingFields: string[];
};

type DataQualitySummaryResponse = {
  totalAssets: number;
  lowDataQuality: number;
  lowConfidence: number;
  missingSerialNumber: number;
  missingOperatingSystem: number;
  missingNetworkInfo: number;
  assetsWithoutRecentEvidence: number;
  averageDataQualityScore: number;
  averageConfidenceScore: number;
};

type ManualAssetResponse = {
  asset: {
    id: string;
    name: string;
    operationalStatus: string;
    administrativeStatus: string;
    confidenceScore: number | null;
    dataQualityScore: number | null;
  };
  evidenceId: string;
  eventId: string;
  auditLogId: string;
};

describe('Asset ingestion idempotency (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let networkDiscoveryService: NetworkDiscoveryService;
  let assetId: string;
  let lifecycleConflictId: string;
  let queryAssetIds: string[];
  let queryConflictIds: string[];
  const discoveryProfileIds: string[] = [];
  const discoveryRunIds: string[] = [];
  const discoveryAssetIds: string[] = [];
  let discoveryProfileId: string;
  let disabledDiscoveryProfileId: string;
  let discoveryRunId: string;
  let dataQualityAssetId: string;
  let manualAssetId: string;
  let initialAttributeCount: number;
  const sourceAssetId = `e2e-${randomUUID()}`;
  const querySerialNumber = `QUERY-SERIAL-${sourceAssetId}`;
  const canonicalKey = `e2e-tests:${sourceAssetId}`;
  const queryPrefix = `query-${sourceAssetId.slice(-8)}`;
  const basePayload = {
    source: 'e2e-tests',
    sourceAssetId,
    hostname: 'atlas-e2e-01',
    type: 'SERVER',
    category: 'APPLICATION',
    serialNumber: 'E2E-SN-001',
    manufacturer: 'Dell',
    model: 'PowerEdge R650',
    operatingSystem: 'Ubuntu Server',
    osVersion: '24.04',
    lastSeenAt: '2026-07-03T04:20:00.000Z',
    ipAddresses: ['10.99.0.10'],
    macAddresses: ['02:42:ac:11:99:10'],
    confidenceScore: 92,
    dataQualityScore: 95,
  };
  const manualPayload = {
    identifier: `MANUAL-${sourceAssetId}`,
    identifierType: 'HOSTNAME',
    type: 'NOTEBOOK',
    administrativeStatus: 'IN_STOCK',
    reason: 'Equipamento de teste ainda sem observação técnica.',
    hostname: `manual-${sourceAssetId}`,
    serialNumber: `MANUAL-SERIAL-${sourceAssetId}`,
    manufacturer: 'Fabricante de teste',
    model: 'Modelo de laboratório',
    operatingSystem: 'Windows 11',
    osVersion: '23H2',
    location: 'Laboratório E2E',
    owner: 'TI',
    department: 'Infraestrutura',
    environment: 'Estoque',
    criticality: 'Baixa',
    comment: 'Declaração criada exclusivamente pela suíte E2E.',
  };

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    networkDiscoveryService = app.get(NetworkDiscoveryService);

    const queryAssets = await Promise.all([
      prisma.asset.create({
        data: {
          canonicalKey: `${canonicalKey}:query-notebook`,
          name: `${queryPrefix}-notebook`,
          kind: 'NOTEBOOK',
          operationalStatus: 'SEEN_RECENTLY',
          administrativeStatus: 'IN_USE',
          confidenceScore: 91,
          dataQualityScore: 88,
          firstSeenAt: new Date('2026-07-01T10:00:00.000Z'),
          lastSeenAt: new Date('2026-07-01T10:00:00.000Z'),
          attributes: {
            create: {
              key: 'serialNumber',
              value: querySerialNumber,
              valueText: querySerialNumber,
              valueType: 'STRING',
              observedAt: new Date('2026-07-01T10:00:00.000Z'),
            },
          },
        },
      }),
      prisma.asset.create({
        data: {
          canonicalKey: `${canonicalKey}:query-server`,
          name: `${queryPrefix}-server`,
          kind: 'SERVER',
          operationalStatus: 'SEEN_RECENTLY',
          administrativeStatus: 'DEACTIVATED',
          confidenceScore: 55,
          dataQualityScore: 60,
          firstSeenAt: new Date('2026-07-02T10:00:00.000Z'),
          lastSeenAt: new Date('2026-07-02T10:00:00.000Z'),
        },
      }),
      prisma.asset.create({
        data: {
          canonicalKey: `${canonicalKey}:query-vm`,
          name: `${queryPrefix}-vm`,
          kind: 'VM',
          operationalStatus: 'SEEN_RECENTLY',
          administrativeStatus: 'LOST',
          confidenceScore: 75,
          dataQualityScore: 72,
          firstSeenAt: new Date('2026-07-03T10:00:00.000Z'),
          lastSeenAt: new Date('2026-07-03T10:00:00.000Z'),
        },
      }),
    ]);
    queryAssetIds = queryAssets.map((asset) => asset.id);

    const queryConflicts = await Promise.all([
      prisma.conflict.create({
        data: {
          assetId: queryAssets[1].id,
          conflictType: 'LIFECYCLE_CONFLICT',
          attributeKey: 'administrativeStatus',
          status: 'OPEN',
          impact: 'HIGH',
          occurrenceCount: 4,
          suggestionReason: 'Ativo de consulta voltou a aparecer.',
        },
      }),
      prisma.conflict.create({
        data: {
          assetId: queryAssets[2].id,
          conflictType: 'LIFECYCLE_CONFLICT',
          attributeKey: 'administrativeStatus',
          status: 'IN_REVIEW',
          impact: 'LOW',
          occurrenceCount: 2,
          suggestionReason: 'Ativo de consulta em análise.',
        },
      }),
    ]);
    queryConflictIds = queryConflicts.map((conflict) => conflict.id);

    const dataQualityAsset = await prisma.asset.create({
      data: {
        canonicalKey: `${canonicalKey}:data-quality-incomplete`,
        name: `quality-incomplete-${sourceAssetId.slice(-8)}`,
        kind: 'SERVER',
        operationalStatus: 'UNKNOWN',
        administrativeStatus: 'IN_USE',
        confidenceScore: 45,
        dataQualityScore: 40,
        firstSeenAt: new Date('2020-01-01T10:00:00.000Z'),
        lastSeenAt: new Date('2020-01-01T10:00:00.000Z'),
      },
    });
    dataQualityAssetId = dataQualityAsset.id;
  });

  afterAll(async () => {
    if (manualAssetId) {
      await prisma.auditLog.deleteMany({ where: { entityId: manualAssetId } });
      await prisma.asset.deleteMany({ where: { id: manualAssetId } });
    }
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: 'NetworkDiscoveryRun', entityId: { in: discoveryRunIds } },
          { entityType: 'NetworkDiscoveryProfile', entityId: { in: discoveryProfileIds } },
        ],
      },
    });
    if (discoveryProfileIds.length) {
      await prisma.networkDiscoveryProfile.deleteMany({
        where: { id: { in: discoveryProfileIds } },
      });
    }
    if (discoveryAssetIds.length) {
      await prisma.asset.deleteMany({ where: { id: { in: discoveryAssetIds } } });
    }
    await prisma.asset.deleteMany({ where: { canonicalKey: { startsWith: canonicalKey } } });
    await app.close();
  });

  it('creates an asset, evidence, attributes, interface and discovery event', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send(basePayload)
      .expect(201);
    const body = response.body as IngestionResponse;

    assetId = body.asset.id;
    expect(body.asset.atlasId).toMatch(/^ATLAS-[A-F0-9]{8}$/);
    expect(body.action).toBe('created');
    expect(body.eventType).toBe('ASSET_DISCOVERED');
    expect(body.asset.networkInterfaces).toHaveLength(1);
    expect(await prisma.assetEvidence.count({ where: { assetId } })).toBe(1);
    expect(await prisma.assetEvent.count({ where: { assetId } })).toBe(1);
    initialAttributeCount = await prisma.assetAttribute.count({ where: { assetId } });
    expect(initialAttributeCount).toBeGreaterThan(0);
  });

  it('syncs identical data without duplicating attributes or interfaces', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send(basePayload)
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.action).toBe('synced');
    expect(body.eventType).toBe('ASSET_SYNCED');
    expect(body.changedFields).toEqual([]);
    expect(await prisma.assetEvidence.count({ where: { assetId } })).toBe(2);
    expect(await prisma.assetAttribute.count({ where: { assetId } })).toBe(initialAttributeCount);
    expect(await prisma.networkInterface.count({ where: { assetId } })).toBe(1);

    const currentAttributes = await prisma.assetAttribute.findMany({
      where: { assetId, isCurrent: true },
      select: { confirmationCount: true },
    });
    expect(currentAttributes.every((attribute) => attribute.confirmationCount === 2)).toBe(true);
  });

  it('creates attribute history and an update event when hostname changes', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:21:00.000Z',
      })
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.action).toBe('updated');
    expect(body.eventType).toBe('ASSET_UPDATED');
    expect(body.changedFields).toContain('hostname');
    expect(await prisma.assetAttribute.count({ where: { assetId } })).toBe(
      initialAttributeCount + 1,
    );
    expect(
      await prisma.assetAttribute.count({ where: { assetId, key: 'hostname', isCurrent: true } }),
    ).toBe(1);
  });

  it('updates the same interface when a known MAC receives a new IP', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:22:00.000Z',
        ipAddresses: ['10.99.0.10', '10.99.0.11'],
      })
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.eventType).toBe('ASSET_UPDATED');
    expect(body.changedFields).toContain('networkInterfaces');
    expect(await prisma.networkInterface.count({ where: { assetId } })).toBe(1);

    const networkInterface = await prisma.networkInterface.findFirstOrThrow({
      where: { assetId, isCurrent: true },
    });
    expect(networkInterface.ipAddresses).toEqual(
      expect.arrayContaining(['10.99.0.10', '10.99.0.11']),
    );
  });

  it('prepares a conflict when the same IP is observed with another MAC', async () => {
    await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:23:00.000Z',
        ipAddresses: ['10.99.0.10'],
        macAddresses: ['02:42:ac:11:99:20'],
      })
      .expect(201);

    const conflict = await prisma.conflict.findFirst({
      where: { assetId, attributeKey: 'network.ip.10.99.0.10' },
      include: { values: true },
    });
    expect(conflict).not.toBeNull();
    expect(conflict?.values).toHaveLength(2);
    expect(await prisma.networkInterface.count({ where: { assetId } })).toBe(2);
  });

  it('rejects scores outside the 0 to 100 range', async () => {
    await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        sourceAssetId: `${sourceAssetId}-invalid`,
        confidenceScore: 101,
      })
      .expect(400);
  });

  it('does not create a lifecycle conflict when an IN_USE asset receives evidence', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:24:00.000Z',
      })
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.lifecycleConflict).toBeNull();
    expect(
      await prisma.conflict.count({
        where: { assetId, conflictType: 'LIFECYCLE_CONFLICT' },
      }),
    ).toBe(0);
  });

  it('changes administrative status and records the event and audit log atomically', async () => {
    const response = await request(httpServer)
      .patch(`/assets/${assetId}/administrative-status`)
      .send({
        administrativeStatus: 'DEACTIVATED',
        reason: 'Baixa patrimonial',
        comment: 'Equipamento recolhido pelo suporte e removido do uso corporativo.',
      })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        previousStatus: 'IN_USE',
        administrativeStatus: 'DEACTIVATED',
        eventId: expect.any(String),
        auditLogId: expect.any(String),
      }),
    );

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    const event = await prisma.assetEvent.findFirst({
      where: { assetId, eventType: 'ADMIN_STATUS_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    });
    const auditLog = await prisma.auditLog.findFirst({
      where: { assetId, action: 'ADMIN_STATUS_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    });

    expect(asset.administrativeStatus).toBe('DEACTIVATED');
    expect(event?.data).toEqual(
      expect.objectContaining({
        previousStatus: 'IN_USE',
        newStatus: 'DEACTIVATED',
        reason: 'Baixa patrimonial',
        comment: 'Equipamento recolhido pelo suporte e removido do uso corporativo.',
        actorUserId: 'atlas-mvp-user',
      }),
    );
    expect(auditLog).toEqual(
      expect.objectContaining({
        actorType: 'USER',
        actorId: 'atlas-mvp-user',
        before: { administrativeStatus: 'IN_USE' },
        after: { administrativeStatus: 'DEACTIVATED' },
        metadata: {
          reason: 'Baixa patrimonial',
          comment: 'Equipamento recolhido pelo suporte e removido do uso corporativo.',
        },
      }),
    );
  });

  it('rejects an administrative status update when the value did not change', async () => {
    const eventCount = await prisma.assetEvent.count({ where: { assetId } });
    const auditLogCount = await prisma.auditLog.count({ where: { assetId } });

    await request(httpServer)
      .patch(`/assets/${assetId}/administrative-status`)
      .send({
        administrativeStatus: 'DEACTIVATED',
        reason: 'Tentativa repetida',
        comment: 'O status já havia sido registrado.',
      })
      .expect(400);

    expect(await prisma.assetEvent.count({ where: { assetId } })).toBe(eventCount);
    expect(await prisma.auditLog.count({ where: { assetId } })).toBe(auditLogCount);
  });

  it('validates enum, reason and comment for administrative status updates', async () => {
    await request(httpServer)
      .patch(`/assets/${assetId}/administrative-status`)
      .send({
        administrativeStatus: 'INVALID_STATUS',
        reason: '   ',
        comment: '',
      })
      .expect(400);
  });

  it('creates ASSET_REAPPEARED when a DEACTIVATED asset receives evidence', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:25:00.000Z',
      })
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.eventType).toBe('ASSET_REAPPEARED');
    expect(body.lifecycleConflict).toEqual(
      expect.objectContaining({
        conflictType: 'LIFECYCLE_CONFLICT',
        status: 'OPEN',
        impact: 'HIGH',
        occurrenceCount: 1,
      }),
    );
    lifecycleConflictId = body.lifecycleConflict!.id;

    const event = await prisma.assetEvent.findUniqueOrThrow({ where: { id: body.eventId } });
    expect(event.eventType).toBe('ASSET_REAPPEARED');
    expect(event.data).toEqual(
      expect.objectContaining({
        administrativeStatus: 'DEACTIVATED',
        source: 'e2e-tests',
        evidenceId: body.evidenceId,
      }),
    );
  });

  it('keeps the DEACTIVATED administrative status after reappearance', async () => {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });

    expect(asset.administrativeStatus).toBe('DEACTIVATED');
    expect(asset.operationalStatus).toBe('SEEN_RECENTLY');
    expect(asset.lastSeenAt?.toISOString()).toBe('2026-07-03T04:25:00.000Z');
  });

  it('updates the lifecycle conflict when a DISCARDED asset receives evidence', async () => {
    await request(httpServer)
      .patch(`/assets/${assetId}/administrative-status`)
      .send({
        administrativeStatus: 'DISCARDED',
        reason: 'Descarte confirmado',
        comment: 'O ativo foi marcado como descartado para validar o conflito de ciclo de vida.',
      })
      .expect(200);

    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:26:00.000Z',
      })
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.eventType).toBe('ASSET_REAPPEARED');
    expect(body.lifecycleConflict?.occurrenceCount).toBe(2);
    expect(
      await prisma.conflict.count({
        where: { assetId, conflictType: 'LIFECYCLE_CONFLICT', status: 'OPEN' },
      }),
    ).toBe(1);
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })).administrativeStatus,
    ).toBe('DISCARDED');
  });

  it('does not duplicate an open lifecycle conflict on repeated evidence', async () => {
    const response = await request(httpServer)
      .post('/ingestion/assets')
      .send({
        ...basePayload,
        hostname: 'atlas-e2e-02',
        lastSeenAt: '2026-07-03T04:27:00.000Z',
      })
      .expect(201);
    const body = response.body as IngestionResponse;

    expect(body.eventType).toBe('ASSET_REAPPEARED');
    expect(body.lifecycleConflict?.occurrenceCount).toBe(3);
    expect(
      await prisma.conflict.count({
        where: { assetId, conflictType: 'LIFECYCLE_CONFLICT', status: 'OPEN' },
      }),
    ).toBe(1);
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: assetId } })).administrativeStatus,
    ).toBe('DISCARDED');
  });

  it('lists conflicts in the Resolution Center', async () => {
    const response = await request(httpServer).get('/conflicts').expect(200);
    const conflicts = (response.body as PaginatedResponse<Record<string, unknown>>).items;
    const conflict = conflicts.find((item) => item.id === lifecycleConflictId);

    expect(conflict).toEqual(
      expect.objectContaining({
        id: lifecycleConflictId,
        type: 'LIFECYCLE_CONFLICT',
        field: 'administrativeStatus',
        status: 'OPEN',
        impact: 'HIGH',
        assetId,
        assetName: 'atlas-e2e-02',
        administrativeStatus: 'DISCARDED',
        occurrenceCount: 3,
      }),
    );
  });

  it('returns conflict details, values, metadata and related timeline', async () => {
    const response = await request(httpServer).get(`/conflicts/${lifecycleConflictId}`).expect(200);
    const body = response.body as ConflictDetailResponse;

    expect(body).toEqual(
      expect.objectContaining({
        conflict: expect.objectContaining({
          id: lifecycleConflictId,
          type: 'LIFECYCLE_CONFLICT',
          status: 'OPEN',
        }),
        asset: expect.objectContaining({ id: assetId, name: 'atlas-e2e-02' }),
        values: expect.any(Array),
        metadata: expect.objectContaining({ occurrenceCount: 3 }),
        timeline: expect.arrayContaining([
          expect.objectContaining({ eventType: 'ASSET_REAPPEARED' }),
        ]),
      }),
    );
    expect(body.values).toHaveLength(3);
  });

  it('rejects an invalid conflict status', async () => {
    await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'INVALID_STATUS',
        reason: 'Status inválido',
        comment: 'Este payload deve ser rejeitado.',
      })
      .expect(400);
  });

  it('rejects blank reason and comment when changing conflict status', async () => {
    await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'IN_REVIEW',
        reason: '   ',
        comment: '',
      })
      .expect(400);
  });

  it('returns 404 when the conflict does not exist', async () => {
    await request(httpServer)
      .patch(`/conflicts/${randomUUID()}/status`)
      .send({
        status: 'IN_REVIEW',
        reason: 'Início da análise',
        comment: 'Conflito inexistente para validar a resposta.',
      })
      .expect(404);
  });

  it('blocks RESOLVED while a lifecycle conflict asset remains closed', async () => {
    const eventCount = await prisma.assetEvent.count({ where: { assetId } });
    const auditLogCount = await prisma.auditLog.count({ where: { assetId } });

    const response = await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'RESOLVED',
        reason: 'Tentativa de resolução',
        comment: 'O ativo ainda permanece descartado.',
      })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        message:
          'Para resolver este conflito, reative o ativo ou marque o conflito como exceção/ignorado com justificativa.',
      }),
    );
    expect(await prisma.assetEvent.count({ where: { assetId } })).toBe(eventCount);
    expect(await prisma.auditLog.count({ where: { assetId } })).toBe(auditLogCount);
  });

  it('allows IN_REVIEW while the lifecycle conflict asset remains closed', async () => {
    const response = await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'IN_REVIEW',
        reason: 'Análise iniciada',
        comment: 'O time de suporte está verificando o reaparecimento.',
      })
      .expect(200);
    const body = response.body as ConflictStatusUpdateResponse;

    expect(body.previousStatus).toBe('OPEN');
    expect(body.status).toBe('IN_REVIEW');
  });

  it('allows EXCEPTION with reason and comment while the asset remains closed', async () => {
    const response = await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'EXCEPTION',
        reason: 'Exceção operacional aprovada',
        comment: 'O ativo permanece encerrado, mas sua comunicação foi autorizada temporariamente.',
      })
      .expect(200);
    const body = response.body as ConflictStatusUpdateResponse;

    expect(body.previousStatus).toBe('IN_REVIEW');
    expect(body.status).toBe('EXCEPTION');
  });

  it('allows IGNORED with reason and comment while the asset remains closed', async () => {
    const response = await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'IGNORED',
        reason: 'Sinal técnico conhecido',
        comment: 'A emissão residual será ignorada conforme decisão registrada.',
      })
      .expect(200);
    const body = response.body as ConflictStatusUpdateResponse;

    expect(body.previousStatus).toBe('EXCEPTION');
    expect(body.status).toBe('IGNORED');
  });

  it('allows RESOLVED after the lifecycle conflict asset is reactivated and audits it', async () => {
    await request(httpServer)
      .patch(`/assets/${assetId}/administrative-status`)
      .send({
        administrativeStatus: 'IN_USE',
        reason: 'Ativo reativado',
        comment: 'A reativação foi validada pelo time de suporte.',
      })
      .expect(200);

    const response = await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'RESOLVED',
        reason: 'Ativo reativado manualmente.',
        comment: 'Validado com o time de suporte.',
      })
      .expect(200);
    const body = response.body as ConflictStatusUpdateResponse;

    expect(body).toEqual(
      expect.objectContaining({
        previousStatus: 'IGNORED',
        status: 'RESOLVED',
        eventId: expect.any(String),
        auditLogId: expect.any(String),
      }),
    );

    const conflict = await prisma.conflict.findUniqueOrThrow({
      where: { id: lifecycleConflictId },
    });
    const event = await prisma.assetEvent.findUniqueOrThrow({
      where: { id: body.eventId },
    });
    const auditLog = await prisma.auditLog.findUniqueOrThrow({
      where: { id: body.auditLogId },
    });

    expect(conflict.status).toBe('RESOLVED');
    expect(conflict.resolvedAt).not.toBeNull();
    expect(event).toEqual(
      expect.objectContaining({
        assetId,
        eventType: 'CONFLICT_STATUS_CHANGED',
        data: expect.objectContaining({
          conflictId: lifecycleConflictId,
          previousStatus: 'IGNORED',
          newStatus: 'RESOLVED',
          reason: 'Ativo reativado manualmente.',
          comment: 'Validado com o time de suporte.',
        }),
      }),
    );
    expect(auditLog).toEqual(
      expect.objectContaining({
        assetId,
        actorType: 'USER',
        actorId: 'atlas-mvp-user',
        action: 'CONFLICT_STATUS_CHANGED',
        entityType: 'Conflict',
        entityId: lifecycleConflictId,
        before: { status: 'IGNORED' },
        after: { status: 'RESOLVED' },
        metadata: {
          reason: 'Ativo reativado manualmente.',
          comment: 'Validado com o time de suporte.',
        },
      }),
    );
  });

  it('rejects changing a conflict to its current status', async () => {
    const eventCount = await prisma.assetEvent.count({ where: { assetId } });
    const auditLogCount = await prisma.auditLog.count({ where: { assetId } });

    await request(httpServer)
      .patch(`/conflicts/${lifecycleConflictId}/status`)
      .send({
        status: 'RESOLVED',
        reason: 'Tentativa repetida',
        comment: 'Não deve gerar novo histórico.',
      })
      .expect(400);

    expect(await prisma.assetEvent.count({ where: { assetId } })).toBe(eventCount);
    expect(await prisma.auditLog.count({ where: { assetId } })).toBe(auditLogCount);
  });

  it('searches assets by hostname', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${queryPrefix}-notebook`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryAssetIds[0] }));
  });

  it('searches assets by serial number attribute', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${querySerialNumber}`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryAssetIds[0] }));
  });

  it('filters assets by administrative status', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${queryPrefix}&administrativeStatus=DEACTIVATED`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryAssetIds[1] }));
  });

  it('filters assets by type', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${queryPrefix}&type=VM`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryAssetIds[2], type: 'VM' }));
  });

  it('filters assets by minimum confidence score', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${queryPrefix}&minConfidenceScore=90`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryAssetIds[0] }));
  });

  it('paginates assets with total metadata', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${queryPrefix}&page=2&pageSize=2&sortBy=name&sortDirection=asc`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body).toEqual(
      expect.objectContaining({ total: 3, page: 2, pageSize: 2, totalPages: 2 }),
    );
    expect(body.items).toHaveLength(1);
  });

  it('sorts assets by last seen date', async () => {
    const response = await request(httpServer)
      .get(`/assets?search=${queryPrefix}&sortBy=lastSeenAt&sortDirection=asc`)
      .expect(200);
    const body = response.body as PaginatedResponse<{ id: string }>;

    expect(body.items.map((item) => item.id)).toEqual(queryAssetIds);
  });

  it('rejects asset page size above 100', async () => {
    await request(httpServer).get('/assets?pageSize=101').expect(400);
  });

  it('rejects an invalid asset score', async () => {
    await request(httpServer).get('/assets?minConfidenceScore=101').expect(400);
  });

  it('filters conflicts by status', async () => {
    const response = await request(httpServer)
      .get(`/conflicts?search=${queryPrefix}&status=IN_REVIEW`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryConflictIds[1] }));
  });

  it('filters conflicts by impact', async () => {
    const response = await request(httpServer)
      .get(`/conflicts?search=${queryPrefix}&impact=HIGH`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryConflictIds[0] }));
  });

  it('searches conflicts by related asset hostname', async () => {
    const response = await request(httpServer)
      .get(`/conflicts?search=${queryPrefix}-server`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body.total).toBe(1);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: queryConflictIds[0] }));
  });

  it('paginates conflicts with total metadata', async () => {
    const response = await request(httpServer)
      .get(`/conflicts?search=${queryPrefix}&page=2&pageSize=1`)
      .expect(200);
    const body = response.body as PaginatedResponse<Record<string, unknown>>;

    expect(body).toEqual(
      expect.objectContaining({ total: 2, page: 2, pageSize: 1, totalPages: 2 }),
    );
    expect(body.items).toHaveLength(1);
  });

  it('sorts conflicts by updated date', async () => {
    const response = await request(httpServer)
      .get(`/conflicts?search=${queryPrefix}&sortBy=updatedAt&sortDirection=asc`)
      .expect(200);
    const body = response.body as PaginatedResponse<{ updatedAt: string }>;
    const timestamps = body.items.map((item) => new Date(item.updatedAt).getTime());

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
  });

  it('rejects an invalid conflict status filter', async () => {
    await request(httpServer).get('/conflicts?status=INVALID_STATUS').expect(400);
  });

  it('exposes the stabilized discovery run and result statuses', () => {
    expect(Object.values(NetworkDiscoveryRunStatus)).toEqual([
      'PENDING',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
    expect(Object.values(NetworkDiscoveryResultStatus)).toEqual([
      'DISCOVERED',
      'UPDATED',
      'SKIPPED',
      'ERROR',
    ]);
  });

  it('creates a valid Network Discovery Lite profile', async () => {
    const response = await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: `Discovery ${sourceAssetId}`,
        description: 'Escopo privado e simulado para testes E2E.',
        enabled: true,
        mode: 'LIGHT',
        allowedCidrs: ['172.31.250.0/30'],
        deniedCidrs: [],
        rateLimitPerMinute: 10,
        scheduleEnabled: false,
        methods: ['ICMP_SIMULATED', 'DNS_REVERSE_SIMULATED', 'ARP_SIMULATED'],
      })
      .expect(201);

    discoveryProfileId = (response.body as { id: string }).id;
    discoveryProfileIds.push(discoveryProfileId);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: discoveryProfileId,
        enabled: true,
        mode: 'LIGHT',
        allowedCidrs: ['172.31.250.0/30'],
        rateLimitPerMinute: 10,
      }),
    );
  });

  it('rejects a discovery profile without allowed CIDRs', async () => {
    await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: 'Sem escopo',
        enabled: true,
        mode: 'LIGHT',
        rateLimitPerMinute: 10,
        methods: ['ICMP_SIMULATED'],
      })
      .expect(400);
  });

  it('rejects discovery over CIDR 0.0.0.0/0', async () => {
    const response = await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: 'Escopo inseguro',
        enabled: true,
        mode: 'CONTROLLED',
        allowedCidrs: ['0.0.0.0/0'],
        rateLimitPerMinute: 1,
        methods: ['ICMP_SIMULATED'],
      })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({ message: expect.stringContaining('0.0.0.0/0') }),
    );
  });

  it('rejects public CIDRs in the MVP', async () => {
    const response = await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: 'Escopo público',
        enabled: true,
        mode: 'LIGHT',
        allowedCidrs: ['8.8.8.0/24'],
        rateLimitPerMinute: 5,
        methods: ['ICMP_SIMULATED'],
      })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'No MVP, a descoberta de rede permite apenas CIDRs privados.',
      }),
    );
  });

  it('rejects scheduling without a schedule expression', async () => {
    await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: 'Agendamento incompleto',
        enabled: true,
        mode: 'LIGHT',
        allowedCidrs: ['192.168.50.0/24'],
        rateLimitPerMinute: 5,
        scheduleEnabled: true,
        methods: ['DNS_REVERSE_SIMULATED'],
      })
      .expect(400);
  });

  it('rejects a discovery rate limit above 60 per minute', async () => {
    await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: 'Limite inválido',
        enabled: true,
        mode: 'LIGHT',
        allowedCidrs: ['10.20.0.0/24'],
        rateLimitPerMinute: 61,
        methods: ['ARP_SIMULATED'],
      })
      .expect(400);
  });

  it('rejects execution of a disabled discovery profile', async () => {
    const createResponse = await request(httpServer)
      .post('/network-discovery/profiles')
      .send({
        name: `Disabled ${sourceAssetId}`,
        enabled: false,
        mode: 'PASSIVE',
        allowedCidrs: ['10.30.0.0/30'],
        rateLimitPerMinute: 5,
        methods: ['DNS_REVERSE_SIMULATED'],
      })
      .expect(201);
    disabledDiscoveryProfileId = (createResponse.body as { id: string }).id;
    discoveryProfileIds.push(disabledDiscoveryProfileId);

    await request(httpServer)
      .post(`/network-discovery/profiles/${disabledDiscoveryProfileId}/run`)
      .expect(400);

    const rejectionAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: 'NetworkDiscoveryProfile',
        entityId: disabledDiscoveryProfileId,
        action: 'NETWORK_DISCOVERY_RUN_REJECTED',
      },
    });
    expect(rejectionAudit.metadata).toEqual(
      expect.objectContaining({ reasonCode: 'PROFILE_DISABLED', simulation: true }),
    );
  });

  it('executes a simulated discovery successfully', async () => {
    const response = await request(httpServer)
      .post(`/network-discovery/profiles/${discoveryProfileId}/run`)
      .expect(201);
    const body = response.body as {
      id: string;
      status: string;
      totalTargets: number;
      discoveredCount: number;
      results: Array<{ assetId: string }>;
    };

    discoveryRunId = body.id;
    discoveryRunIds.push(body.id);
    discoveryAssetIds.push(...body.results.map((result) => result.assetId));
    expect(body).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        totalTargets: 2,
        discoveredCount: 2,
      }),
    );
  });

  it('persists the NetworkDiscoveryRun', async () => {
    const run = await prisma.networkDiscoveryRun.findUniqueOrThrow({
      where: { id: discoveryRunId },
    });
    expect(run).toEqual(
      expect.objectContaining({
        profileId: discoveryProfileId,
        status: 'COMPLETED',
        totalTargets: 2,
        discoveredCount: 2,
      }),
    );
    expect(run.finishedAt).not.toBeNull();
  });

  it('persists discovery results', async () => {
    const results = await prisma.networkDiscoveryResult.findMany({
      where: { runId: discoveryRunId },
    });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 'DISCOVERED')).toBe(true);
    expect(results.every((result) => result.ipAddress.startsWith('172.31.250.'))).toBe(true);
  });

  it('creates NETWORK_DISCOVERY evidence', async () => {
    const evidence = await prisma.assetEvidence.findMany({
      where: { assetId: { in: discoveryAssetIds }, evidenceType: 'NETWORK_DISCOVERY' },
    });
    expect(evidence).toHaveLength(2);
    expect(evidence.every((item) => item.source === 'network-discovery-lite')).toBe(true);
  });

  it('creates or updates assets conservatively from discovery observations', async () => {
    const assets = await prisma.asset.findMany({ where: { id: { in: discoveryAssetIds } } });
    expect(assets).toHaveLength(2);
    expect(assets.every((asset) => asset.canonicalKey?.startsWith('network-discovery:'))).toBe(
      true,
    );
    expect(assets.every((asset) => asset.operationalStatus === 'SEEN_RECENTLY')).toBe(true);
  });

  it('creates discovery events in the asset timeline', async () => {
    const events = await prisma.assetEvent.findMany({
      where: { assetId: { in: discoveryAssetIds } },
      select: { eventType: true },
    });
    const eventTypes = new Set(events.map((event) => event.eventType));
    expect(eventTypes.has('NETWORK_DISCOVERY_RUN_STARTED')).toBe(true);
    expect(eventTypes.has('NETWORK_DISCOVERY_ASSET_FOUND')).toBe(true);
    expect(eventTypes.has('NETWORK_DISCOVERY_RUN_FINISHED')).toBe(true);
  });

  it('creates an AuditLog for the discovery execution', async () => {
    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: 'NetworkDiscoveryRun',
        entityId: discoveryRunId,
        action: 'NETWORK_DISCOVERY_RUN_EXECUTED',
      },
    });
    expect(auditLog).toEqual(
      expect.objectContaining({ actorType: 'SYSTEM', actorId: 'atlas-network-discovery-lite' }),
    );
  });

  it('lists discovery runs', async () => {
    const response = await request(httpServer).get('/network-discovery/runs').expect(200);
    const runs = response.body as Array<{ id: string; profile: { id: string } }>;
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: discoveryRunId,
          profile: expect.objectContaining({ id: discoveryProfileId }),
        }),
      ]),
    );
  });

  it('returns discovery run details and related assets', async () => {
    const response = await request(httpServer)
      .get(`/network-discovery/runs/${discoveryRunId}`)
      .expect(200);
    const body = response.body as {
      id: string;
      profile: { id: string };
      results: Array<{ asset: { id: string } | null }>;
    };

    expect(body.id).toBe(discoveryRunId);
    expect(body.profile.id).toBe(discoveryProfileId);
    expect(body.results).toHaveLength(2);
    expect(body.results.every((result) => result.asset !== null)).toBe(true);
  });

  it('persists a FAILED run and audit log when simulated processing fails', async () => {
    const failurePoint = networkDiscoveryService as unknown as {
      processObservation: (...args: unknown[]) => Promise<unknown>;
    };
    const failureSpy = jest
      .spyOn(failurePoint, 'processObservation')
      .mockRejectedValueOnce(new Error('Controlled E2E simulation failure'));

    const response = await request(httpServer)
      .post(`/network-discovery/profiles/${discoveryProfileId}/run`)
      .expect(500);
    failureSpy.mockRestore();

    const failedRunId = (response.body as { runId: string }).runId;
    discoveryRunIds.push(failedRunId);
    const failedRun = await prisma.networkDiscoveryRun.findUniqueOrThrow({
      where: { id: failedRunId },
    });
    expect(failedRun).toEqual(
      expect.objectContaining({
        profileId: discoveryProfileId,
        status: 'FAILED',
        errorCount: 1,
        finishedAt: expect.any(Date),
        summary: expect.objectContaining({ errorCode: 'SIMULATION_FAILED', simulation: true }),
      }),
    );

    const failureAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: 'NetworkDiscoveryRun',
        entityId: failedRunId,
        action: 'NETWORK_DISCOVERY_RUN_FAILED',
      },
    });
    expect(failureAudit.after).toEqual({ status: 'FAILED' });
  });

  it('returns the dashboard summary with all operational sections', async () => {
    const response = await request(httpServer).get('/dashboard/summary').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        assets: expect.objectContaining({
          total: expect.any(Number),
          byAdministrativeStatus: expect.any(Object),
          byOperationalStatus: expect.any(Object),
          byType: expect.any(Object),
          byOperatingSystem: expect.any(Object),
          byOperatingSystemVersion: expect.any(Object),
        }),
        conflicts: expect.objectContaining({ totalOpen: expect.any(Number) }),
        networkDiscovery: expect.objectContaining({ totalRuns: expect.any(Number) }),
        recentActivity: expect.any(Array),
        recommendedActions: expect.any(Array),
      }),
    );
  });

  it('reports the current asset count in the dashboard', async () => {
    const expectedTotal = await prisma.asset.count();
    const response = await request(httpServer).get('/dashboard/summary').expect(200);

    expect((response.body as { assets: { total: number } }).assets.total).toBe(expectedTotal);
  });

  it('reports the current open conflict count in the dashboard', async () => {
    const expectedTotal = await prisma.conflict.count({ where: { status: 'OPEN' } });
    const response = await request(httpServer).get('/dashboard/summary').expect(200);

    expect((response.body as { conflicts: { totalOpen: number } }).conflicts.totalOpen).toBe(
      expectedTotal,
    );
  });

  it('returns the latest asset events in dashboard activity order', async () => {
    const expectedEvents = await prisma.assetEvent.findMany({
      orderBy: [{ occurredAt: 'desc' }, { recordedAt: 'desc' }],
      take: 8,
      select: { id: true },
    });
    const response = await request(httpServer).get('/dashboard/summary').expect(200);
    const activity = (response.body as { recentActivity: Array<{ id: string }> }).recentActivity;

    expect(activity.map((event) => event.id)).toEqual(expectedEvents.map((event) => event.id));
  });

  it('lists audit logs with pagination and summary', async () => {
    const response = await request(httpServer).get('/audit-logs').expect(200);
    const body = response.body as AuditLogListResponse;

    expect(body).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        total: expect.any(Number),
        page: 1,
        pageSize: 20,
        totalPages: expect.any(Number),
        summary: expect.objectContaining({ total: expect.any(Number) }),
      }),
    );
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('returns an empty audit log page when no record matches', async () => {
    const response = await request(httpServer)
      .get('/audit-logs')
      .query({ search: `missing-${randomUUID()}` })
      .expect(200);
    const body = response.body as AuditLogListResponse;

    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('filters audit logs by action', async () => {
    const existing = await prisma.auditLog.findFirstOrThrow();
    const response = await request(httpServer)
      .get('/audit-logs')
      .query({ action: existing.action, pageSize: 100 })
      .expect(200);
    const body = response.body as AuditLogListResponse;

    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.action === existing.action)).toBe(true);
  });

  it('filters audit logs by entity type', async () => {
    const existing = await prisma.auditLog.findFirstOrThrow();
    const response = await request(httpServer)
      .get('/audit-logs')
      .query({ entityType: existing.entityType, pageSize: 100 })
      .expect(200);
    const body = response.body as AuditLogListResponse;

    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.entityType === existing.entityType)).toBe(true);
  });

  it('filters audit logs by occurrence period', async () => {
    const existing = await prisma.auditLog.findFirstOrThrow({ orderBy: { occurredAt: 'asc' } });
    const dateFrom = new Date(existing.occurredAt.getTime() - 1_000).toISOString();
    const dateTo = new Date(existing.occurredAt.getTime() + 1_000).toISOString();
    const response = await request(httpServer)
      .get('/audit-logs')
      .query({ dateFrom, dateTo, pageSize: 100 })
      .expect(200);
    const body = response.body as AuditLogListResponse;

    expect(body.items.some((item) => item.id === existing.id)).toBe(true);
    expect(
      body.items.every(
        (item) =>
          new Date(item.occurredAt) >= new Date(dateFrom) &&
          new Date(item.occurredAt) <= new Date(dateTo),
      ),
    ).toBe(true);
  });

  it('paginates audit logs', async () => {
    const response = await request(httpServer)
      .get('/audit-logs')
      .query({ page: 1, pageSize: 1 })
      .expect(200);
    const body = response.body as AuditLogListResponse;

    expect(body.items).toHaveLength(1);
    expect(body.pageSize).toBe(1);
    expect(body.totalPages).toBe(body.total);
  });

  it('orders audit logs by occurredAt', async () => {
    const response = await request(httpServer)
      .get('/audit-logs')
      .query({ sortBy: 'occurredAt', sortDirection: 'desc', pageSize: 100 })
      .expect(200);
    const body = response.body as AuditLogListResponse;
    const timestamps = body.items.map((item) => new Date(item.occurredAt).getTime());

    expect(timestamps).toEqual([...timestamps].sort((left, right) => right - left));
  });

  it('returns an audit log detail by id', async () => {
    const existing = await prisma.auditLog.findFirstOrThrow();
    const response = await request(httpServer).get(`/audit-logs/${existing.id}`).expect(200);
    const body = response.body as AuditLogItem;

    expect(body).toEqual(
      expect.objectContaining({
        id: existing.id,
        action: existing.action,
        entityType: existing.entityType,
        entityId: existing.entityId,
      }),
    );
  });

  it('returns 404 for an unknown audit log', async () => {
    await request(httpServer).get(`/audit-logs/${randomUUID()}`).expect(404);
  });

  it('rejects audit log pageSize above 100', async () => {
    await request(httpServer).get('/audit-logs').query({ pageSize: 101 }).expect(400);
  });

  it('returns the data quality summary with current inventory data', async () => {
    const response = await request(httpServer).get('/data-quality/summary').expect(200);
    const body = response.body as DataQualitySummaryResponse;

    expect(body.totalAssets).toBeGreaterThan(0);
    expect(body.lowDataQuality).toBeGreaterThan(0);
    expect(body.lowConfidence).toBeGreaterThan(0);
    expect(body.missingSerialNumber).toBeGreaterThan(0);
    expect(body.missingOperatingSystem).toBeGreaterThan(0);
    expect(body.missingNetworkInfo).toBeGreaterThan(0);
    expect(body.assetsWithoutRecentEvidence).toBeGreaterThan(0);
    expect(body.averageDataQualityScore).toEqual(expect.any(Number));
    expect(body.averageConfidenceScore).toEqual(expect.any(Number));
  });

  it('lists data quality assets with pagination', async () => {
    const response = await request(httpServer).get('/data-quality/assets').expect(200);
    const body = response.body as PaginatedResponse<DataQualityAssetResponse>;

    expect(body).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        total: expect.any(Number),
        page: 1,
        pageSize: 20,
        totalPages: expect.any(Number),
      }),
    );
    expect(body.items.some((asset) => asset.id === dataQualityAssetId)).toBe(true);
  });

  it.each([
    ['LOW_DATA_QUALITY', 'LOW_DATA_QUALITY'],
    ['LOW_CONFIDENCE', 'LOW_CONFIDENCE'],
    ['MISSING_SERIAL_NUMBER', 'MISSING_SERIAL_NUMBER'],
    ['MISSING_OPERATING_SYSTEM', 'MISSING_OPERATING_SYSTEM'],
    ['MISSING_NETWORK_INFO', 'MISSING_NETWORK_INFO'],
    ['WITHOUT_RECENT_EVIDENCE', 'WITHOUT_RECENT_EVIDENCE'],
  ])('filters by %s and reports the issue', async (issue, expectedIssue) => {
    const response = await request(httpServer)
      .get('/data-quality/assets')
      .query({ issue, pageSize: 100 })
      .expect(200);
    const body = response.body as PaginatedResponse<DataQualityAssetResponse>;
    const asset = body.items.find((item) => item.id === dataQualityAssetId);

    expect(asset).toBeDefined();
    expect(asset?.issues).toContain(expectedIssue);
  });

  it('paginates data quality assets', async () => {
    const response = await request(httpServer)
      .get('/data-quality/assets')
      .query({ page: 1, pageSize: 1 })
      .expect(200);
    const body = response.body as PaginatedResponse<DataQualityAssetResponse>;

    expect(body.items).toHaveLength(1);
    expect(body.pageSize).toBe(1);
  });

  it('orders low-quality assets by dataQualityScore', async () => {
    const response = await request(httpServer)
      .get('/data-quality/assets')
      .query({
        issue: 'LOW_DATA_QUALITY',
        sortBy: 'dataQualityScore',
        sortDirection: 'asc',
        pageSize: 100,
      })
      .expect(200);
    const body = response.body as PaginatedResponse<DataQualityAssetResponse>;
    const scores = body.items.flatMap((asset) =>
      asset.dataQualityScore === null ? [] : [asset.dataQualityScore],
    );

    expect(scores).toEqual([...scores].sort((left, right) => left - right));
  });

  it('rejects data quality pageSize above 100', async () => {
    await request(httpServer).get('/data-quality/assets').query({ pageSize: 101 }).expect(400);
  });

  it('requires the mandatory manual declaration fields', async () => {
    await request(httpServer).post('/assets/manual').send({}).expect(400);
  });

  it('requires a non-empty reason for manual declaration', async () => {
    await request(httpServer)
      .post('/assets/manual')
      .send({ ...manualPayload, reason: '   ' })
      .expect(400);
  });

  it('creates a manually declared asset with conservative operational state', async () => {
    const response = await request(httpServer)
      .post('/assets/manual')
      .send(manualPayload)
      .expect(201);
    const body = response.body as ManualAssetResponse;
    manualAssetId = body.asset.id;

    expect(body.asset).toEqual(
      expect.objectContaining({
        name: manualPayload.hostname,
        operationalStatus: 'UNKNOWN',
        administrativeStatus: 'IN_STOCK',
        confidenceScore: 60,
      }),
    );
    expect(body.asset.dataQualityScore).toBeGreaterThan(70);
  });

  it('creates manual evidence for the declared asset', async () => {
    const evidence = await prisma.assetEvidence.findFirstOrThrow({
      where: { assetId: manualAssetId },
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        source: 'MANUAL',
        evidenceType: 'MANUAL_DECLARATION',
        confidenceScore: expect.anything(),
      }),
    );
  });

  it('creates the manual declaration timeline event', async () => {
    const event = await prisma.assetEvent.findFirstOrThrow({
      where: { assetId: manualAssetId, eventType: 'ASSET_MANUALLY_DECLARED' },
    });

    expect(event.title).toBe('Ativo declarado manualmente');
    expect(event.description).toBe(manualPayload.reason);
  });

  it('creates the manual declaration audit log', async () => {
    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: manualAssetId, action: 'ASSET_MANUALLY_DECLARED' },
    });

    expect(auditLog).toEqual(
      expect.objectContaining({ actorType: 'USER', actorId: 'atlas-mvp-user' }),
    );
    expect(auditLog.metadata).toEqual(
      expect.objectContaining({ reason: manualPayload.reason, origin: 'manual-declaration' }),
    );
  });

  it('rejects a manual declaration with duplicate hostname', async () => {
    await request(httpServer)
      .post('/assets/manual')
      .send({
        ...manualPayload,
        identifier: `${manualPayload.identifier}-hostname-duplicate`,
        serialNumber: `${manualPayload.serialNumber}-other`,
      })
      .expect(409);
  });

  it('rejects a manual declaration with duplicate serial number', async () => {
    await request(httpServer)
      .post('/assets/manual')
      .send({
        ...manualPayload,
        identifier: `${manualPayload.identifier}-serial-duplicate`,
        hostname: `${manualPayload.hostname}-other`,
      })
      .expect(409);
  });

  it('lists the manually declared asset in the inventory', async () => {
    const response = await request(httpServer)
      .get('/assets')
      .query({ search: manualPayload.hostname })
      .expect(200);
    const body = response.body as PaginatedResponse<{ id: string }>;

    expect(body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: manualAssetId })]),
    );
  });

  it('returns the manually declared asset detail', async () => {
    const response = await request(httpServer).get(`/assets/${manualAssetId}`).expect(200);
    const body = response.body as { id: string; attributes: Array<{ key: string }> };

    expect(body.id).toBe(manualAssetId);
    expect(body.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'hostname' }),
        expect.objectContaining({ key: 'serialNumber' }),
        expect.objectContaining({ key: 'operatingSystem' }),
      ]),
    );
  });

  it('keeps the manual-only asset visible in data quality', async () => {
    const response = await request(httpServer)
      .get('/data-quality/assets')
      .query({ search: manualPayload.hostname, pageSize: 100 })
      .expect(200);
    const body = response.body as PaginatedResponse<DataQualityAssetResponse>;
    const asset = body.items.find((item) => item.id === manualAssetId);

    expect(asset).toBeDefined();
    expect(asset?.issues).toEqual(
      expect.arrayContaining(['LOW_CONFIDENCE', 'MISSING_NETWORK_INFO', 'WITHOUT_RECENT_EVIDENCE']),
    );
  });
});
