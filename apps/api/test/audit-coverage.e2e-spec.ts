import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { oidcActorId } from '../src/auth/actor-id';
import type { Prisma } from '../src/generated/prisma/client';
import { DataQualityService } from '../src/data-quality/data-quality.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  startTestAuthHarness,
  TEST_AUTH_ACCESS_VALUE,
  TEST_AUTH_ANALYST_ROLE,
  TEST_AUTH_SERVICE_CLIENT_ID,
  TEST_AUTH_SERVICE_SUBJECT,
  TEST_AUTH_VIEWER_ROLE,
  type TestAuthHarness,
} from './auth-test-harness';

type AuditedAction =
  | 'NETWORK_DISCOVERY_PROFILE_CREATED'
  | 'NETWORK_DISCOVERY_PROFILE_UPDATED'
  | 'ASSET_INGESTION_COMPLETED'
  | 'DATA_QUALITY_EXPORT_PREPARED';
type UnknownFunction = (...args: unknown[]) => unknown;

class AuditFaultInjectingPrismaService extends PrismaService {
  private failureAction: AuditedAction | null = null;
  private transactionCalls = 0;

  constructor() {
    super();

    const realTransaction = this.$transaction.bind(this) as unknown as UnknownFunction;
    this.$transaction = ((input: unknown, ...options: unknown[]) => {
      this.transactionCalls += 1;
      if (typeof input !== 'function') {
        return Reflect.apply(realTransaction, this, [input, ...options]);
      }
      const callback = input as (client: Prisma.TransactionClient) => Promise<unknown>;
      return Reflect.apply(realTransaction, this, [
        (client: Prisma.TransactionClient) => callback(this.wrapTransaction(client)),
        ...options,
      ]);
    }) as typeof this.$transaction;

    const auditDelegate = this.auditLog;
    const realAuditCreate = auditDelegate.create.bind(auditDelegate);
    auditDelegate.create = ((args: unknown) => {
      this.failIfConfigured(args);
      return Reflect.apply(realAuditCreate as unknown as UnknownFunction, auditDelegate, [args]);
    }) as typeof auditDelegate.create;
  }

  failNextAudit(action: AuditedAction): void {
    this.failureAction = action;
  }

  clearFailure(): void {
    this.failureAction = null;
  }

  getTransactionCalls(): number {
    return this.transactionCalls;
  }

  private failIfConfigured(args: unknown): void {
    const action = (args as { data?: { action?: unknown } } | undefined)?.data?.action;
    if (action === this.failureAction) {
      const failedAction = this.failureAction;
      this.failureAction = null;
      throw new Error(`TEST_AUDIT_FAILURE:${failedAction}`);
    }
  }

  private wrapTransaction(client: Prisma.TransactionClient): Prisma.TransactionClient {
    return new Proxy(client, {
      get: (target, property) => {
        const delegate = (target as unknown as Record<PropertyKey, unknown>)[property];
        if (property !== 'auditLog' || typeof delegate !== 'object' || delegate === null) {
          return delegate;
        }
        return new Proxy(delegate, {
          get: (delegateTarget, method) => {
            const operation = (delegateTarget as Record<PropertyKey, unknown>)[method];
            if (method !== 'create' || typeof operation !== 'function') return operation;
            return (...args: unknown[]) => {
              this.failIfConfigured(args[0]);
              return Reflect.apply(operation as UnknownFunction, delegateTarget, args);
            };
          },
        });
      },
    });
  }
}

describe('Privileged operation audit coverage (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let auth: TestAuthHarness;
  let admin: ReturnType<typeof request.agent>;
  let analyst: ReturnType<typeof request.agent>;
  let viewer: ReturnType<typeof request.agent>;
  let service: ReturnType<typeof request.agent>;
  let prisma: AuditFaultInjectingPrismaService;
  let dataQuality: DataQualityService;

  const runId = randomUUID();
  const profileIds = new Set<string>();
  const assetIds = new Set<string>();
  const exportAuditIds = new Set<string>();
  const analystSubject = `audit-analyst-${runId}`;
  const viewerSubject = `audit-viewer-${runId}`;

  const profilePayload = (name: string) => ({
    name,
    description: 'Perfil administrativo da suíte de auditoria.',
    enabled: true,
    mode: 'LIGHT',
    allowedCidrs: ['10.42.0.0/30'],
    deniedCidrs: ['10.42.0.3/32'],
    rateLimitPerMinute: 10,
    scheduleEnabled: false,
    methods: ['ICMP_SIMULATED', 'DNS_REVERSE_SIMULATED'],
  });

  const ingestionPayload = (suffix: string) => ({
    source: ' Audit-Coverage ',
    sourceAssetId: `${runId}-${suffix}`,
    hostname: `audit-${suffix}`,
    type: 'SERVER',
    serialNumber: `AUDIT-${suffix}`,
    lastSeenAt: '2026-09-13T12:00:00.000Z',
    ipAddresses: [`10.42.1.${suffix === 'rollback' ? '10' : '11'}`],
    macAddresses: [suffix === 'rollback' ? '02:42:AC:42:01:10' : '02:42:AC:42:01:11'],
    confidenceScore: 90,
    dataQualityScore: 90,
  });

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    auth = await startTestAuthHarness();

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useClass(AuditFaultInjectingPrismaService)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const analystToken = await auth.issueToken({
      subject: analystSubject,
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_ANALYST_ROLE],
    });
    const viewerToken = await auth.issueToken({
      subject: viewerSubject,
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_VIEWER_ROLE],
    });
    const serviceToken = await auth.issueToken({
      clientId: TEST_AUTH_SERVICE_CLIENT_ID,
      subject: TEST_AUTH_SERVICE_SUBJECT,
      roles: [TEST_AUTH_ACCESS_VALUE, TEST_AUTH_ANALYST_ROLE],
      additionalClaims: {
        raw_subject_copy: TEST_AUTH_SERVICE_SUBJECT,
        credential: 'test-only-sensitive-claim',
      },
    });
    admin = await auth.createAuthenticatedAgent(app);
    analyst = await auth.createAuthenticatedAgent(app, analystToken);
    viewer = await auth.createAuthenticatedAgent(app, viewerToken);
    service = await auth.createAuthenticatedAgent(app, serviceToken);
    prisma = app.get<AuditFaultInjectingPrismaService>(PrismaService);
    dataQuality = app.get(DataQualityService);
  });

  beforeEach(() => {
    prisma.clearFailure();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entityType: 'NetworkDiscoveryProfile', entityId: { in: [...profileIds] } },
            { entityType: 'Asset', entityId: { in: [...assetIds] } },
            { id: { in: [...exportAuditIds] } },
          ],
        },
      });
      await prisma.networkDiscoveryProfile.deleteMany({ where: { id: { in: [...profileIds] } } });
      await prisma.asset.deleteMany({ where: { id: { in: [...assetIds] } } });
    }
    if (app) await app.close();
    if (auth) await auth.close();
  });

  it('audits profile creation with the trusted actor and safe administrative configuration', async () => {
    const response = await admin
      .post('/network-discovery/profiles')
      .send(profilePayload(`audit-create-${runId}`))
      .expect(201);
    const profileId = (response.body as { id: string }).id;
    profileIds.add(profileId);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: profileId, action: 'NETWORK_DISCOVERY_PROFILE_CREATED' },
    });
    expect(audit).toEqual(
      expect.objectContaining({
        actorId: auth.actor.id,
        actorType: 'USER',
        entityType: 'NetworkDiscoveryProfile',
        entityId: profileId,
        before: null,
      }),
    );
    expect(audit.after).toEqual({
      name: `audit-create-${runId}`,
      description: 'Perfil administrativo da suíte de auditoria.',
      enabled: true,
      mode: 'LIGHT',
      allowedCidrs: ['10.42.0.0/30'],
      deniedCidrs: ['10.42.0.3/32'],
      rateLimitPerMinute: 10,
      scheduleEnabled: false,
      scheduleExpression: null,
      methods: ['ICMP_SIMULATED', 'DNS_REVERSE_SIMULATED'],
    });
  });

  it('persists safe SERVICE provenance for an authorized audited operation', async () => {
    const response = await service
      .post('/network-discovery/profiles')
      .send(profilePayload(`audit-service-${runId}`))
      .expect(201);
    const profileId = (response.body as { id: string }).id;
    profileIds.add(profileId);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: profileId, action: 'NETWORK_DISCOVERY_PROFILE_CREATED' },
    });
    expect(audit).toEqual(
      expect.objectContaining({
        actorId: oidcActorId('SERVICE', auth.issuer, TEST_AUTH_SERVICE_SUBJECT),
        actorType: 'SERVICE',
        entityType: 'NetworkDiscoveryProfile',
        entityId: profileId,
      }),
    );
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(TEST_AUTH_SERVICE_SUBJECT);
    expect(serialized).not.toContain(TEST_AUTH_SERVICE_CLIENT_ID);
    expect(serialized).not.toContain('test-only-sensitive-claim');
  });

  it('audits profile update with complete before and after snapshots', async () => {
    const created = await admin
      .post('/network-discovery/profiles')
      .send(profilePayload(`audit-update-${runId}`))
      .expect(201);
    const profileId = (created.body as { id: string }).id;
    profileIds.add(profileId);

    await admin
      .patch(`/network-discovery/profiles/${profileId}`)
      .send({ enabled: false, rateLimitPerMinute: 20, deniedCidrs: [] })
      .expect(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: profileId, action: 'NETWORK_DISCOVERY_PROFILE_UPDATED' },
    });
    expect(audit).toEqual(expect.objectContaining({ actorId: auth.actor.id, actorType: 'USER' }));
    expect(audit.before).toEqual(
      expect.objectContaining({
        enabled: true,
        rateLimitPerMinute: 10,
        deniedCidrs: ['10.42.0.3/32'],
      }),
    );
    expect(audit.after).toEqual(
      expect.objectContaining({ enabled: false, rateLimitPerMinute: 20, deniedCidrs: [] }),
    );
  });

  it('serializes concurrent profile updates so audit before snapshots form a valid chain', async () => {
    const created = await admin
      .post('/network-discovery/profiles')
      .send(profilePayload(`audit-concurrent-${runId}`))
      .expect(201);
    const profileId = (created.body as { id: string }).id;
    profileIds.add(profileId);

    const [first, second] = await Promise.all([
      admin
        .patch(`/network-discovery/profiles/${profileId}`)
        .send({ rateLimitPerMinute: 20 })
        .expect(200),
      admin
        .patch(`/network-discovery/profiles/${profileId}`)
        .send({ rateLimitPerMinute: 30 })
        .expect(200),
    ]);
    expect(first.body).toEqual(expect.objectContaining({ id: profileId }));
    expect(second.body).toEqual(expect.objectContaining({ id: profileId }));

    const audits = await prisma.auditLog.findMany({
      where: { entityId: profileId, action: 'NETWORK_DISCOVERY_PROFILE_UPDATED' },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    expect(audits).toHaveLength(2);
    const transitions = audits.map((audit) => ({
      before: (audit.before as { rateLimitPerMinute: number }).rateLimitPerMinute,
      after: (audit.after as { rateLimitPerMinute: number }).rateLimitPerMinute,
    }));
    const firstTransition = transitions.find((transition) => transition.before === 10);
    const secondTransition = transitions.find((transition) => transition.before !== 10);
    expect(firstTransition).toBeDefined();
    expect(secondTransition).toBeDefined();
    expect([firstTransition!.after, secondTransition!.after].sort()).toEqual([20, 30]);
    expect(secondTransition!.before).toBe(firstTransition!.after);

    const finalProfile = await prisma.networkDiscoveryProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect([20, 30]).toContain(finalProfile.rateLimitPerMinute);
    expect(audits.every((audit) => audit.actorId === auth.actor.id)).toBe(true);
  });

  it('rolls back profile creation and update when their AuditLog fails', async () => {
    const transactionsBefore = prisma.getTransactionCalls();
    const createAuditsBefore = await prisma.auditLog.count({
      where: { action: 'NETWORK_DISCOVERY_PROFILE_CREATED', actorId: auth.actor.id },
    });
    const failedName = `audit-create-rollback-${runId}`;
    prisma.failNextAudit('NETWORK_DISCOVERY_PROFILE_CREATED');
    await admin.post('/network-discovery/profiles').send(profilePayload(failedName)).expect(500);
    await expect(
      prisma.networkDiscoveryProfile.count({ where: { name: failedName } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { action: 'NETWORK_DISCOVERY_PROFILE_CREATED', actorId: auth.actor.id },
      }),
    ).resolves.toBe(createAuditsBefore);

    const created = await admin
      .post('/network-discovery/profiles')
      .send(profilePayload(`audit-update-rollback-${runId}`))
      .expect(201);
    const profileId = (created.body as { id: string }).id;
    profileIds.add(profileId);
    const before = await prisma.networkDiscoveryProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    const auditCount = await prisma.auditLog.count({ where: { entityId: profileId } });

    prisma.failNextAudit('NETWORK_DISCOVERY_PROFILE_UPDATED');
    await admin
      .patch(`/network-discovery/profiles/${profileId}`)
      .send({ enabled: false, rateLimitPerMinute: 30 })
      .expect(500);

    const after = await prisma.networkDiscoveryProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(after.enabled).toBe(before.enabled);
    expect(after.rateLimitPerMinute).toBe(before.rateLimitPerMinute);
    await expect(prisma.auditLog.count({ where: { entityId: profileId } })).resolves.toBe(
      auditCount,
    );
    expect(prisma.getTransactionCalls()).toBeGreaterThanOrEqual(transactionsBefore + 3);
  });

  it('does not audit denied, invalid or missing discovery profile mutations', async () => {
    const analystActorId = oidcActorId('HUMAN', auth.issuer, analystSubject);
    const viewerActorId = oidcActorId('HUMAN', auth.issuer, viewerSubject);
    const adminAuditsBefore = await prisma.auditLog.count({
      where: {
        action: { in: ['NETWORK_DISCOVERY_PROFILE_CREATED', 'NETWORK_DISCOVERY_PROFILE_UPDATED'] },
        actorId: auth.actor.id,
      },
    });

    await analyst
      .post('/network-discovery/profiles')
      .send(profilePayload(`denied-analyst-${runId}`))
      .expect(403);
    await viewer
      .post('/network-discovery/profiles')
      .send(profilePayload(`denied-viewer-${runId}`))
      .expect(403);
    await admin
      .post('/network-discovery/profiles')
      .send({ ...profilePayload(`invalid-${runId}`), allowedCidrs: ['8.8.8.0/24'] })
      .expect(400);
    await admin
      .patch(`/network-discovery/profiles/${randomUUID()}`)
      .send({ enabled: false })
      .expect(404);

    await expect(
      prisma.auditLog.count({
        where: {
          action: {
            in: ['NETWORK_DISCOVERY_PROFILE_CREATED', 'NETWORK_DISCOVERY_PROFILE_UPDATED'],
          },
          actorId: { in: [analystActorId, viewerActorId] },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.networkDiscoveryProfile.count({
        where: {
          name: { in: [`denied-analyst-${runId}`, `denied-viewer-${runId}`, `invalid-${runId}`] },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: {
          action: {
            in: ['NETWORK_DISCOVERY_PROFILE_CREATED', 'NETWORK_DISCOVERY_PROFILE_UPDATED'],
          },
          actorId: auth.actor.id,
        },
      }),
    ).resolves.toBe(adminAuditsBefore);
  });

  it('keeps AssetEvent and creates one safe AuditLog per ingestion request', async () => {
    const payload = ingestionPayload('success');
    const first = await admin.post('/ingestion/assets').send(payload).expect(201);
    const firstBody = first.body as { asset: { id: string }; eventId: string; evidenceId: string };
    assetIds.add(firstBody.asset.id);

    const second = await admin.post('/ingestion/assets').send(payload).expect(201);
    expect((second.body as { action: string }).action).toBe('synced');
    await expect(prisma.asset.count({ where: { id: firstBody.asset.id } })).resolves.toBe(1);
    await expect(prisma.assetEvent.count({ where: { assetId: firstBody.asset.id } })).resolves.toBe(
      2,
    );
    await expect(
      prisma.auditLog.count({
        where: { entityId: firstBody.asset.id, action: 'ASSET_INGESTION_COMPLETED' },
      }),
    ).resolves.toBe(2);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: firstBody.asset.id, action: 'ASSET_INGESTION_COMPLETED' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit).toEqual(
      expect.objectContaining({
        assetId: firstBody.asset.id,
        actorId: auth.actor.id,
        actorType: 'USER',
        entityType: 'Asset',
      }),
    );
    expect(audit.metadata).toEqual({
      assetId: firstBody.asset.id,
      evidenceId: firstBody.evidenceId,
      eventId: firstBody.eventId,
      source: 'audit-coverage',
      sourceRecordId: payload.sourceAssetId,
      result: 'created',
      eventType: 'ASSET_DISCOVERED',
      changedFields: expect.any(Array),
    });
    expect(JSON.stringify(audit)).not.toContain('Authorization');
    expect(JSON.stringify(audit)).not.toContain('confidenceScore');
  });

  it('rolls back the complete ingestion transaction when AuditLog creation fails', async () => {
    const payload = ingestionPayload('rollback');
    const canonicalKey = `audit-coverage:${payload.sourceAssetId}`;
    const transactionsBefore = prisma.getTransactionCalls();
    const auditCountBefore = await prisma.auditLog.count({
      where: { action: 'ASSET_INGESTION_COMPLETED', actorId: auth.actor.id },
    });
    prisma.failNextAudit('ASSET_INGESTION_COMPLETED');

    await admin.post('/ingestion/assets').send(payload).expect(500);

    expect(prisma.getTransactionCalls()).toBeGreaterThan(transactionsBefore);
    await expect(prisma.asset.findUnique({ where: { canonicalKey } })).resolves.toBeNull();
    await expect(
      prisma.assetEvidence.count({ where: { sourceRecordId: payload.sourceAssetId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { action: 'ASSET_INGESTION_COMPLETED', actorId: auth.actor.id },
      }),
    ).resolves.toBe(auditCountBefore);
  });

  it('keeps Analyst and Viewer ingestion attempts denied without AuditLog', async () => {
    const payload = ingestionPayload('denied');
    const deniedActorIds = [
      oidcActorId('HUMAN', auth.issuer, analystSubject),
      oidcActorId('HUMAN', auth.issuer, viewerSubject),
    ];
    await analyst.post('/ingestion/assets').send(payload).expect(403);
    await viewer.post('/ingestion/assets').send(payload).expect(403);

    await expect(
      prisma.asset.findUnique({
        where: { canonicalKey: `audit-coverage:${payload.sourceAssetId}` },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.auditLog.count({
        where: { action: 'ASSET_INGESTION_COMPLETED', actorId: { in: deniedActorIds } },
      }),
    ).resolves.toBe(0);
  });

  it('audits Analyst and Admin exports with canonical metadata and generated UUIDs', async () => {
    const analystSearch = `no-export-match-${runId}-analyst`;
    const adminSearch = `no-export-match-${runId}-admin`;
    await analyst
      .get('/data-quality/assets/export')
      .query({
        search: `  ${analystSearch}  `,
        issue: 'low_confidence',
        sortBy: 'name',
        sortDirection: 'desc',
      })
      .expect(200);
    await admin
      .get('/data-quality/assets/export')
      .query({ search: adminSearch, type: 'server' })
      .expect(200);

    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'DATA_QUALITY_EXPORT_PREPARED',
        actorId: { in: [auth.actor.id, oidcActorId('HUMAN', auth.issuer, analystSubject)] },
      },
      orderBy: { occurredAt: 'desc' },
      take: 2,
    });
    expect(audits).toHaveLength(2);
    audits.forEach((audit) => exportAuditIds.add(audit.id));
    expect(
      audits.every((audit) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          audit.entityId,
        ),
      ),
    ).toBe(true);
    expect(audits.every((audit) => audit.entityType === 'DataQualityExport')).toBe(true);

    const analystAudit = audits.find((audit) => audit.actorId !== auth.actor.id);
    expect(analystAudit?.metadata).toEqual({
      filters: expect.objectContaining({ search: analystSearch, issue: 'LOW_CONFIDENCE' }),
      ordering: [
        { field: 'name', direction: 'desc' },
        { field: 'id', direction: 'asc' },
      ],
      rowCount: 0,
      limit: 5000,
    });
    expect(JSON.stringify(audits)).not.toContain('Atlas ID');
    expect(JSON.stringify(audits)).not.toContain('Authorization');
  });

  it('fails closed without releasing CSV when export audit persistence fails', async () => {
    const countBefore = await prisma.auditLog.count({
      where: { action: 'DATA_QUALITY_EXPORT_PREPARED' },
    });
    prisma.failNextAudit('DATA_QUALITY_EXPORT_PREPARED');
    const response = await admin
      .get('/data-quality/assets/export')
      .query({ search: `audit-failure-${runId}` })
      .expect(500);

    expect(response.text).not.toContain('"Atlas ID"');
    await expect(
      prisma.auditLog.count({ where: { action: 'DATA_QUALITY_EXPORT_PREPARED' } }),
    ).resolves.toBe(countBefore);
  });

  it('does not record PREPARED for invalid, denied or failed export generation', async () => {
    const countBefore = await prisma.auditLog.count({
      where: { action: 'DATA_QUALITY_EXPORT_PREPARED' },
    });
    await viewer.get('/data-quality/assets/export').expect(403);
    await analyst
      .get('/data-quality/assets/export')
      .query({ minDataQualityScore: 90, maxDataQualityScore: 10 })
      .expect(400);

    const buildCsv = jest
      .spyOn(dataQuality as unknown as { buildCsv: (...args: unknown[]) => string }, 'buildCsv')
      .mockImplementationOnce(() => {
        throw new Error('TEST_EXPORT_GENERATION_FAILURE');
      });
    try {
      const response = await admin
        .get('/data-quality/assets/export')
        .query({ search: `generation-failure-${runId}` })
        .expect(500);
      expect(response.text).not.toContain('"Atlas ID"');
    } finally {
      buildCsv.mockRestore();
    }

    await expect(
      prisma.auditLog.count({ where: { action: 'DATA_QUALITY_EXPORT_PREPARED' } }),
    ).resolves.toBe(countBefore);
  });
});
