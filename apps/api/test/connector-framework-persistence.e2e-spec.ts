import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { config as loadEnv } from 'dotenv';

import { ConnectorRunStatus, ConnectorRunTrigger } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('Connector Framework persistence foundation (e2e)', () => {
  let prisma: PrismaService;
  const testRunId = randomUUID();
  const actorId = `service:test-connector-persistence:${testRunId}`;
  const evidenceSource = `CONNECTOR_PERSISTENCE_TEST:${testRunId}`;
  const instanceIds = new Set<string>();
  const assetIds = new Set<string>();

  beforeAll(async () => {
    loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.assetEvidence.deleteMany({ where: { source: evidenceSource } });
    await prisma.connectorRun.deleteMany({ where: { triggerActorId: actorId } });
    await prisma.connectorSecretReference.deleteMany({
      where: { connectorInstanceId: { in: [...instanceIds] } },
    });
    await prisma.connectorInstance.deleteMany({ where: { id: { in: [...instanceIds] } } });
    await prisma.asset.deleteMany({ where: { id: { in: [...assetIds] } } });
    instanceIds.clear();
    assetIds.clear();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$disconnect();
  });

  async function createInstance(suffix: string) {
    const instance = await prisma.connectorInstance.create({
      data: {
        connectorType: 'TEST_CONNECTOR',
        name: `Connector persistence ${suffix}`,
        configuration: { schemaVersion: 1, endpointLabel: 'test' },
      },
    });
    instanceIds.add(instance.id);
    return instance;
  }

  async function createRun(connectorInstanceId: string, suffix: string) {
    return prisma.connectorRun.create({
      data: {
        connectorInstanceId,
        trigger: ConnectorRunTrigger.REQUESTED,
        triggerActorType: 'SERVICE',
        triggerActorId: actorId,
        requestFingerprint: sha256(`${testRunId}:run:${suffix}`),
      },
    });
  }

  async function createAsset(suffix: string) {
    const asset = await prisma.asset.create({
      data: {
        canonicalKey: `connector-persistence:${testRunId}:${suffix}`,
        name: `Connector persistence asset ${suffix}`,
        kind: 'SERVER',
      },
    });
    assetIds.add(asset.id);
    return asset;
  }

  it('exposes exactly the approved run statuses and triggers', () => {
    expect(Object.values(ConnectorRunStatus)).toEqual([
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'PARTIAL',
      'FAILED',
      'CANCELLED',
    ]);
    expect(Object.values(ConnectorRunTrigger)).toEqual(['REQUESTED', 'SCHEDULE', 'INTERNAL']);
  });

  it('persists exactly the approved PostgreSQL enum values', async () => {
    const [statuses, triggers] = await Promise.all([
      prisma.$queryRaw<Array<{ value: string }>>`
        SELECT unnest(enum_range(NULL::"ConnectorRunStatus"))::text AS value
      `,
      prisma.$queryRaw<Array<{ value: string }>>`
        SELECT unnest(enum_range(NULL::"ConnectorRunTrigger"))::text AS value
      `,
    ]);

    expect(statuses.map(({ value }) => value)).toEqual(Object.values(ConnectorRunStatus));
    expect(triggers.map(({ value }) => value)).toEqual(Object.values(ConnectorRunTrigger));
  });

  it('persists instance UUIDs and conservative defaults', async () => {
    const instance = await createInstance('defaults');

    expect(instance).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        connectorType: 'TEST_CONNECTOR',
        enabled: false,
        configurationVersion: 1,
        configuration: { schemaVersion: 1, endpointLabel: 'test' },
        scheduleEnabled: false,
        scheduleExpression: null,
        scheduleTimeZone: 'UTC',
        version: 1,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('supports independent secret-reference slots and rejects duplicate slots', async () => {
    const instance = await createInstance('secret-slots');
    await prisma.connectorSecretReference.createMany({
      data: [
        {
          connectorInstanceId: instance.id,
          slot: 'client-id',
          providerKind: 'ENVIRONMENT',
          logicalKey: 'atlas/connectors/test/client-id',
        },
        {
          connectorInstanceId: instance.id,
          slot: 'client-secret',
          providerKind: 'ENVIRONMENT',
          logicalKey: 'atlas/connectors/test/client-secret',
        },
      ],
    });

    await expect(
      prisma.connectorSecretReference.create({
        data: {
          connectorInstanceId: instance.id,
          slot: 'client-id',
          providerKind: 'VAULT',
          logicalKey: 'atlas/connectors/test/duplicate',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(
      await prisma.connectorSecretReference.findMany({
        where: { connectorInstanceId: instance.id },
        orderBy: { slot: 'asc' },
        select: { slot: true },
      }),
    ).toEqual([{ slot: 'client-id' }, { slot: 'client-secret' }]);
  });

  it('stores only locator metadata for secret references', async () => {
    const columns = await prisma.$queryRaw<Array<{ columnName: string }>>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'connector_secret_references'
      ORDER BY ordinal_position
    `;

    expect(columns.map(({ columnName }) => columnName)).toEqual([
      'connector_instance_id',
      'slot',
      'provider_kind',
      'logical_key',
      'created_at',
      'updated_at',
    ]);
  });

  it('deletes references independently and cascades remaining references with an unused instance', async () => {
    const instance = await createInstance('secret-delete');
    await prisma.connectorSecretReference.createMany({
      data: [
        {
          connectorInstanceId: instance.id,
          slot: 'username',
          providerKind: 'VAULT',
          logicalKey: 'atlas/connectors/test/username',
        },
        {
          connectorInstanceId: instance.id,
          slot: 'password',
          providerKind: 'VAULT',
          logicalKey: 'atlas/connectors/test/password',
        },
      ],
    });

    await prisma.connectorSecretReference.delete({
      where: {
        connectorInstanceId_slot: {
          connectorInstanceId: instance.id,
          slot: 'username',
        },
      },
    });
    expect(await prisma.connectorInstance.count({ where: { id: instance.id } })).toBe(1);

    await prisma.connectorInstance.delete({ where: { id: instance.id } });
    instanceIds.delete(instance.id);
    expect(
      await prisma.connectorSecretReference.count({
        where: { connectorInstanceId: instance.id },
      }),
    ).toBe(0);
  });

  it('persists multiple runs with QUEUED state and zeroed counters by default', async () => {
    const instance = await createInstance('run-defaults');
    const [first, second] = await Promise.all([
      createRun(instance.id, 'defaults-first'),
      createRun(instance.id, 'defaults-second'),
    ]);

    for (const run of [first, second]) {
      expect(run).toEqual(
        expect.objectContaining({
          connectorInstanceId: instance.id,
          status: ConnectorRunStatus.QUEUED,
          trigger: ConnectorRunTrigger.REQUESTED,
          triggerActorType: 'SERVICE',
          triggerActorId: actorId,
          observedCount: 0,
          ingestedCount: 0,
          rejectedCount: 0,
          version: 1,
        }),
      );
      expect(run.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(await prisma.connectorRun.count({ where: { connectorInstanceId: instance.id } })).toBe(
      2,
    );
  });

  it('rejects duplicate request fingerprints globally', async () => {
    const firstInstance = await createInstance('fingerprint-first');
    const secondInstance = await createInstance('fingerprint-second');
    const requestFingerprint = sha256(`${testRunId}:duplicate-request-fingerprint`);

    await prisma.connectorRun.create({
      data: {
        connectorInstanceId: firstInstance.id,
        trigger: ConnectorRunTrigger.INTERNAL,
        triggerActorType: 'SERVICE',
        triggerActorId: actorId,
        requestFingerprint,
      },
    });

    await expect(
      prisma.connectorRun.create({
        data: {
          connectorInstanceId: secondInstance.id,
          trigger: ConnectorRunTrigger.INTERNAL,
          triggerActorType: 'SERVICE',
          triggerActorId: actorId,
          requestFingerprint,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.connectorRun.count({ where: { requestFingerprint } })).toBe(1);
  });

  it('prevents deleting an instance that owns a run', async () => {
    const instance = await createInstance('instance-delete-restrict');
    const run = await createRun(instance.id, 'instance-delete-restrict');

    await expect(
      prisma.connectorInstance.delete({ where: { id: instance.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.connectorInstance.count({ where: { id: instance.id } })).toBe(1);
    expect(await prisma.connectorRun.count({ where: { id: run.id } })).toBe(1);
  });

  it('accepts legacy evidence and multiple null observation keys', async () => {
    const asset = await createAsset('legacy-evidence');
    const observedAt = new Date('2026-10-08T12:00:00.000Z');

    await prisma.assetEvidence.createMany({
      data: [
        {
          assetId: asset.id,
          source: evidenceSource,
          sourceRecordId: 'legacy-1',
          evidenceType: 'TEST',
          payload: { schemaVersion: 1 },
          observedAt,
        },
        {
          assetId: asset.id,
          source: evidenceSource,
          sourceRecordId: 'legacy-2',
          evidenceType: 'TEST',
          payload: { schemaVersion: 1 },
          observedAt,
        },
      ],
    });

    const evidence = await prisma.assetEvidence.findMany({
      where: { assetId: asset.id, source: evidenceSource },
      orderBy: { sourceRecordId: 'asc' },
      select: { connectorRunId: true, connectorObservationKey: true },
    });
    expect(evidence).toEqual([
      { connectorRunId: null, connectorObservationKey: null },
      { connectorRunId: null, connectorObservationKey: null },
    ]);
  });

  it('links evidence to a run and keeps non-null observation keys unique', async () => {
    const instance = await createInstance('evidence-link');
    const run = await createRun(instance.id, 'evidence-link');
    const asset = await createAsset('evidence-link');
    const connectorObservationKey = sha256(`${testRunId}:observation:duplicate`);
    const observedAt = new Date('2026-10-08T13:00:00.000Z');

    const evidence = await prisma.assetEvidence.create({
      data: {
        assetId: asset.id,
        connectorRunId: run.id,
        connectorObservationKey,
        source: evidenceSource,
        sourceRecordId: 'connector-observation-1',
        evidenceType: 'CONNECTOR_OBSERVATION',
        payload: { schemaVersion: 1 },
        observedAt,
      },
    });
    expect(evidence.connectorRunId).toBe(run.id);

    await expect(
      prisma.assetEvidence.create({
        data: {
          assetId: asset.id,
          connectorRunId: run.id,
          connectorObservationKey,
          source: evidenceSource,
          sourceRecordId: 'connector-observation-2',
          evidenceType: 'CONNECTOR_OBSERVATION',
          payload: { schemaVersion: 1 },
          observedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.assetEvidence.count({ where: { connectorObservationKey } })).toBe(1);
  });

  it('prevents deleting a run referenced by evidence', async () => {
    const instance = await createInstance('run-delete-restrict');
    const run = await createRun(instance.id, 'run-delete-restrict');
    const asset = await createAsset('run-delete-restrict');
    const evidence = await prisma.assetEvidence.create({
      data: {
        assetId: asset.id,
        connectorRunId: run.id,
        connectorObservationKey: sha256(`${testRunId}:observation:delete-restrict`),
        source: evidenceSource,
        sourceRecordId: 'connector-observation-delete-restrict',
        evidenceType: 'CONNECTOR_OBSERVATION',
        payload: { schemaVersion: 1 },
        observedAt: new Date('2026-10-08T14:00:00.000Z'),
      },
    });

    await expect(prisma.connectorRun.delete({ where: { id: run.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    expect(await prisma.connectorRun.count({ where: { id: run.id } })).toBe(1);
    expect(await prisma.assetEvidence.count({ where: { id: evidence.id } })).toBe(1);
  });
});
