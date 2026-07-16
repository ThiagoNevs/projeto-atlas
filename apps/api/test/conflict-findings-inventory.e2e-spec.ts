import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import request from 'supertest';

import { ConflictAnalysisController } from '../src/conflict-analysis/conflict-analysis.controller';
import {
  ConflictAnalysisPolicy,
  IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
} from '../src/conflict-analysis/conflict-analysis.policy';
import { ConflictAnalysisService } from '../src/conflict-analysis/conflict-analysis.service';
import { ConflictFindingsController } from '../src/conflict-analysis/conflict-findings.controller';
import { ConflictFindingsInventoryBuilder } from '../src/conflict-analysis/conflict-findings-inventory.builder';
import { ConflictFindingsService } from '../src/conflict-analysis/conflict-findings.service';
import { normalizeConflictIp } from '../src/conflict-analysis/conflict-normalization';
import { QueryConflictFindingsDto } from '../src/conflict-analysis/dto/query-conflict-findings.dto';
import type {
  AssetIdentitySnapshot,
  ConflictObservation,
  ConflictSourceType,
  ConflictTemporalRelationship,
  IdentityNetworkAnalysis,
} from '../src/conflict-analysis/types/conflict-analysis';
import type { ConflictFindingsPage } from '../src/conflict-analysis/types/conflict-findings-inventory';
import { PrismaService } from '../src/prisma/prisma.service';

const NOW = '2026-07-16T12:00:00.000Z';
const EARLIER = '2026-07-15T12:00:00.000Z';

function observation(
  assetId: string,
  attribute: 'HOSTNAME' | 'IP_ADDRESS',
  value: string,
  overrides: Partial<ConflictObservation> = {},
): ConflictObservation {
  return {
    assetId,
    value,
    normalizedValue:
      attribute === 'HOSTNAME' ? value.trim().toLowerCase() : (normalizeConflictIp(value) ?? ''),
    attribute,
    source: 'signed-agent',
    sourceType: 'TECHNICAL',
    evidenceId: `${assetId}-${attribute}-${value}`,
    observedAt: NOW,
    ingestedAt: NOW,
    current: true,
    ...overrides,
  };
}

function snapshot(
  assetId: string,
  hostnames: string[],
  ips: string[] = [],
  overrides: {
    hostname?: Partial<ConflictObservation>;
    ip?: Partial<ConflictObservation>;
    limitations?: string[];
  } = {},
): AssetIdentitySnapshot {
  return {
    assetId,
    snapshotAt: NOW,
    hostnameObservations: hostnames.map((value) =>
      observation(assetId, 'HOSTNAME', value, overrides.hostname),
    ),
    ipObservations: ips.map((value) => observation(assetId, 'IP_ADDRESS', value, overrides.ip)),
    limitations: overrides.limitations ?? [],
  };
}

function query(overrides: Partial<QueryConflictFindingsDto> = {}): QueryConflictFindingsDto {
  return Object.assign(new QueryConflictFindingsDto(), overrides);
}

function references(snapshots: AssetIdentitySnapshot[]) {
  return snapshots.map((item) => ({
    assetId: item.assetId,
    persistedName: `Asset ${item.assetId}`,
  }));
}

describe('Conflict findings inventory builder', () => {
  const policy = new ConflictAnalysisPolicy();
  const builder = new ConflictFindingsInventoryBuilder(policy);

  function build(snapshots: AssetIdentitySnapshot[], overrides = {}) {
    return builder.build(snapshots, references(snapshots), query(overrides));
  }

  it('returns no finding for compatible assets', () => {
    expect(build([snapshot('a', ['srv-a'], ['10.0.0.1'])]).items).toEqual([]);
  });

  it('returns one duplicate-hostname finding', () => {
    const result = build([snapshot('a', ['srv-01']), snapshot('b', ['srv-01'])]);
    expect(result.items).toEqual([
      expect.objectContaining({
        type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        affectedAssetIds: ['a', 'b'],
      }),
    ]);
  });

  it('returns one shared-IP finding', () => {
    const result = build([
      snapshot('a', ['srv-a'], ['10.0.0.1']),
      snapshot('b', ['srv-b'], ['10.0.0.1']),
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({ type: 'SHARED_IP_DIFFERENT_HOSTNAMES' }),
    ]);
  });

  it('returns internal hostname divergence', () => {
    const result = build([snapshot('a', ['srv-a', 'srv-b'])]);
    expect(result.items.some((item) => item.type === 'HOSTNAME_DIVERGENCE_ON_ASSET')).toBe(true);
  });

  it('deduplicates a finding involving two assets globally', () => {
    const result = build([snapshot('a', ['srv-01']), snapshot('b', ['srv-01'])]);
    expect(result.summary.totalFindings).toBe(1);
  });

  it('represents three affected assets in one finding', () => {
    const result = build([
      snapshot('a', ['srv-01']),
      snapshot('b', ['srv-01']),
      snapshot('c', ['srv-01']),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.affectedAssetIds).toEqual(['a', 'b', 'c']);
  });

  it('equivalent repeated evidence does not inflate finding count', () => {
    const a = snapshot('a', ['srv-01']);
    a.hostnameObservations.push({ ...a.hostnameObservations[0] } as ConflictObservation);
    const result = build([a, snapshot('b', ['srv-01'])]);
    expect(result.summary.totalFindings).toBe(1);
  });

  it('equivalent repeated interfaces do not inflate finding count', () => {
    const a = snapshot('a', ['srv-a'], ['10.0.0.1']);
    a.ipObservations.push({ ...a.ipObservations[0] } as ConflictObservation);
    const result = build([a, snapshot('b', ['srv-b'], ['10.0.0.1'])]);
    expect(result.summary.totalFindings).toBe(1);
  });

  it('is independent from snapshot input order', () => {
    const input = [snapshot('a', ['srv-01']), snapshot('b', ['srv-01'])];
    expect(build([...input].reverse())).toEqual(build(input));
  });

  it('keeps findingId stable', () => {
    const input = [snapshot('a', ['srv-01']), snapshot('b', ['srv-01'])];
    expect(build(input).items[0]?.findingId).toBe(build(input).items[0]?.findingId);
  });

  it.each([
    'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    'SHARED_IP_DIFFERENT_HOSTNAMES',
    'HOSTNAME_DIVERGENCE_ON_ASSET',
  ] as const)('filters by type %s', (type) => {
    const input = [
      snapshot('a', ['shared', 'old-a'], ['10.0.0.1']),
      snapshot('b', ['shared'], ['10.0.0.2']),
      snapshot('c', ['other'], ['10.0.0.1']),
    ];
    const result = build(input, { type });
    expect(result.items.every((item) => item.type === type)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('filters by any affected asset', () => {
    const result = build(
      [snapshot('a', ['shared']), snapshot('b', ['shared']), snapshot('c', ['isolated'])],
      { assetId: 'b' },
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.affectedAssetIds).toContain('b');
  });

  it('filters by normalized hostname', () => {
    const result = build([snapshot('a', ['srv-01']), snapshot('b', ['srv-01'])], {
      hostname: ' SRV-01 ',
    });
    expect(result.items).toHaveLength(1);
    expect(result.filters.hostname).toBe('srv-01');
  });

  it('filters a divergence by a hostname present in its observations', () => {
    const result = build([snapshot('a', ['srv-current', 'srv-old'])], {
      hostname: 'SRV-OLD',
    });
    expect(result.items.some((item) => item.type === 'HOSTNAME_DIVERGENCE_ON_ASSET')).toBe(true);
  });

  it('filters by normalized IPv4', () => {
    const result = build([snapshot('a', ['a'], ['10.0.0.1']), snapshot('b', ['b'], ['10.0.0.1'])], {
      ip: '10.0.0.1',
    });
    expect(result.items).toHaveLength(1);
  });

  it('filters by normalized IPv6', () => {
    const result = build(
      [snapshot('a', ['a'], ['2001:0db8:0:0:0:0:0:1']), snapshot('b', ['b'], ['2001:db8::1'])],
      { ip: '2001:db8::1' },
    );
    expect(result.items).toHaveLength(1);
    expect(result.filters.ip).toBe('2001:db8::1');
  });

  it.each<ConflictSourceType>(['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN'])(
    'filters by source type %s',
    (sourceType) => {
      const input = [
        snapshot('a', ['shared'], [], { hostname: { sourceType } }),
        snapshot('b', ['shared']),
      ];
      expect(build(input, { sourceType }).items).toHaveLength(1);
    },
  );

  it.each<[ConflictTemporalRelationship, string | null, string | null]>([
    ['SAME_OBSERVATION_TIME', NOW, NOW],
    ['DISTINCT_OBSERVATION_TIMES', EARLIER, NOW],
    ['PARTIAL_TEMPORAL_CONTEXT', null, NOW],
    ['NO_TEMPORAL_CONTEXT', null, null],
  ])('filters temporal relationship %s', (relationship, left, right) => {
    const input = [
      snapshot('a', ['shared'], [], { hostname: { observedAt: left } }),
      snapshot('b', ['shared'], [], { hostname: { observedAt: right } }),
    ];
    expect(build(input, { temporalRelationship: relationship }).items).toHaveLength(1);
  });

  it('filters findings with limitations', () => {
    const result = build([snapshot('a', ['shared']), snapshot('b', ['shared'])], {
      hasLimitations: true,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.limitationCount).toBeGreaterThan(0);
  });

  it('combines filters', () => {
    const result = build([snapshot('a', ['shared']), snapshot('b', ['shared'])], {
      type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
      assetId: 'b',
      hostname: 'shared',
      sourceType: 'TECHNICAL',
      hasLimitations: true,
    });
    expect(result.items).toHaveLength(1);
  });

  it('returns an empty filtered result safely', () => {
    const result = build([snapshot('a', ['shared']), snapshot('b', ['shared'])], {
      assetId: 'not-involved',
    });
    expect(result.items).toEqual([]);
    expect(result.pagination.totalItems).toBe(0);
  });

  it.each(['type', 'findingId', 'affectedAssets', 'observationCount'] as const)(
    'sorts ascending by %s with deterministic tie-breaker',
    (sortBy) => {
      const input = [
        snapshot('a', ['shared-a']),
        snapshot('b', ['shared-a']),
        snapshot('c', ['shared-b']),
        snapshot('d', ['shared-b']),
      ];
      const first = build(input, { sortBy, sortDirection: 'asc' });
      expect(build(input, { sortBy, sortDirection: 'asc' })).toEqual(first);
    },
  );

  it.each(['firstObservedAt', 'lastObservedAt'] as const)('sorts descending by %s', (sortBy) => {
    const input = [
      snapshot('a', ['shared-a'], [], { hostname: { observedAt: EARLIER } }),
      snapshot('b', ['shared-a'], [], { hostname: { observedAt: EARLIER } }),
      snapshot('c', ['shared-b']),
      snapshot('d', ['shared-b']),
    ];
    const result = build(input, { sortBy, sortDirection: 'desc' });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.temporalContext.lastObservedAt).toBe(NOW);
  });

  it('returns the first page after global deduplication', () => {
    const result = build(multipleFindingSnapshots(), { page: 1, pageSize: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.pagination.hasNextPage).toBe(true);
  });

  it('returns an intermediate page without duplicates', () => {
    const input = multipleFindingSnapshots();
    const first = build(input, { page: 1, pageSize: 1 });
    const second = build(input, { page: 2, pageSize: 1 });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.findingId).not.toBe(first.items[0]?.findingId);
  });

  it('returns the last page with coherent flags', () => {
    const total = build(multipleFindingSnapshots()).summary.totalFindings;
    const result = build(multipleFindingSnapshots(), { page: total, pageSize: 1 });
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPreviousPage).toBe(true);
  });

  it('returns an empty page beyond the total', () => {
    const result = build(multipleFindingSnapshots(), { page: 999, pageSize: 1 });
    expect(result.items).toEqual([]);
  });

  it('accepts the maximum page size', () => {
    expect(build(multipleFindingSnapshots(), { pageSize: 100 }).pagination.pageSize).toBe(100);
  });

  it('calculates summary after filters and before pagination', () => {
    const result = build(multipleFindingSnapshots(), {
      type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
      pageSize: 1,
    });
    expect(result.summary.totalFindings).toBe(
      result.summary.byType.DUPLICATE_HOSTNAME_ACROSS_ASSETS,
    );
  });

  it('counts every finding type', () => {
    const result = build(multipleFindingSnapshots());
    expect(result.summary.byType).toEqual(
      expect.objectContaining({
        DUPLICATE_HOSTNAME_ACROSS_ASSETS: expect.any(Number),
        SHARED_IP_DIFFERENT_HOSTNAMES: expect.any(Number),
        HOSTNAME_DIVERGENCE_ON_ASSET: expect.any(Number),
      }),
    );
  });

  it('counts distinct affected assets', () => {
    const result = build([snapshot('a', ['shared']), snapshot('b', ['shared'])]);
    expect(result.summary.affectedAssets).toBe(2);
  });

  it('returns global limitations once, outside list items', () => {
    const result = build([snapshot('a', ['shared']), snapshot('b', ['shared'])]);
    expect(result.limitations.join(' ')).toContain('não são persistidos');
    expect(result.items[0]).not.toHaveProperty('limitations');
  });

  it('preserves reviewOptions without selection', () => {
    const item = build([snapshot('a', ['shared']), snapshot('b', ['shared'])]).items[0];
    expect(item?.reviewOptions).toContain('NEEDS_MORE_EVIDENCE');
    expect(item).not.toHaveProperty('selectedReviewOption');
  });

  it('returns SHADOW mode', () => {
    expect(build([]).mode).toBe('SHADOW');
  });

  it('returns decisionsChanged false', () => {
    expect(build([]).decisionsChanged).toBe(false);
  });

  it('returns the shared policy version', () => {
    expect(build([]).policyVersion).toBe(IDENTITY_NETWORK_CONFLICT_POLICY_VERSION);
  });

  it('returns a deterministic response for unchanged data', () => {
    const input = [snapshot('a', ['shared']), snapshot('b', ['shared'])];
    expect(build(input)).toEqual(build(input));
  });

  it('does not expose trust score', () => {
    expect(JSON.stringify(build(multipleFindingSnapshots()))).not.toMatch(/trustScore/i);
  });

  it('does not expose severity or priority', () => {
    expect(JSON.stringify(build(multipleFindingSnapshots()))).not.toMatch(/severity|priority/i);
  });

  it('rejects an invalid hostname when builder is used directly', () => {
    expect(() => build([], { hostname: 'invalid_hostname' })).toThrow('valid hostname');
  });

  it('rejects an invalid IP when builder is used directly', () => {
    expect(() => build([], { ip: '999.1.1.1' })).toThrow('valid IPv4 or IPv6');
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ pageSize: '101' }, 'pageSize'],
    [{ type: 'INVALID' }, 'type'],
    [{ ip: '999.1.1.1' }, 'ip'],
    [{ hostname: '' }, 'hostname'],
  ])('validates the query DTO without consulting a database: %s', (input, property) => {
    const dto = plainToInstance(QueryConflictFindingsDto, input);
    expect(validateSync(dto).some((error) => error.property === property)).toBe(true);
  });

  function multipleFindingSnapshots(): AssetIdentitySnapshot[] {
    return [
      snapshot('a', ['shared-a', 'old-a'], ['10.0.0.1']),
      snapshot('b', ['shared-a'], ['10.0.0.2']),
      snapshot('c', ['other-c'], ['10.0.0.1']),
      snapshot('d', ['shared-d']),
      snapshot('e', ['shared-d']),
    ];
  }
});

describe('Conflict findings inventory endpoint (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const assetA = randomUUID();
  const assetB = randomUUID();
  const findUnique = jest.fn<() => Promise<unknown>>();
  const findMany = jest.fn<(args?: unknown) => Promise<unknown[]>>();
  const writeAttempt = jest.fn<() => Promise<never>>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConflictAnalysisController, ConflictFindingsController],
      providers: [
        ConflictAnalysisPolicy,
        ConflictAnalysisService,
        ConflictFindingsInventoryBuilder,
        ConflictFindingsService,
        {
          provide: PrismaService,
          useValue: {
            asset: { findUnique, findMany, create: writeAttempt, update: writeAttempt },
            conflict: { create: writeAttempt, update: writeAttempt },
            auditLog: { create: writeAttempt },
            assetEvent: { create: writeAttempt },
            assetAttribute: { create: writeAttempt, update: writeAttempt },
            networkInterface: { create: writeAttempt, update: writeAttempt },
            $transaction: writeAttempt,
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
    writeAttempt.mockReset();
    findMany.mockResolvedValue([
      projection(assetA, 'SRV-SHARED', ['10.0.0.1']),
      projection(assetB, 'srv-shared', ['10.0.0.2']),
    ]);
  });

  afterAll(async () => app.close());

  it('returns a paginated, safe, globally deduplicated inventory with one query', async () => {
    const response = await request(server).get('/conflict-analysis/findings').expect(200);
    const body = response.body as ConflictFindingsPage;
    expect(body).toEqual(
      expect.objectContaining({
        mode: 'SHADOW',
        policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
        decisionsChanged: false,
        pagination: expect.objectContaining({ totalItems: 1 }),
      }),
    );
    expect(body.items).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(writeAttempt).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(/payload|fingerprint|canonicalKey|trustScore/i);
  });

  it('accepts filters, sorting and pagination query params', async () => {
    const response = await request(server)
      .get('/conflict-analysis/findings')
      .query({
        type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        assetId: assetB,
        hostname: 'SRV-SHARED',
        sourceType: 'UNKNOWN',
        hasLimitations: 'true',
        sortBy: 'observationCount',
        sortDirection: 'desc',
        page: 1,
        pageSize: 1,
      })
      .expect(200);
    const body = response.body as ConflictFindingsPage;
    expect(body.items).toHaveLength(1);
    expect(body.filters.hostname).toBe('srv-shared');
  });

  it.each([
    ['page', '0'],
    ['pageSize', '101'],
    ['type', 'INVALID'],
    ['assetId', 'not-a-uuid'],
    ['hostname', ''],
    ['ip', '999.1.1.1'],
    ['sourceType', 'INVALID'],
    ['temporalRelationship', 'INVALID'],
    ['hasLimitations', 'maybe'],
    ['sortBy', 'severity'],
    ['sortDirection', 'sideways'],
  ])('rejects invalid query parameter %s', async (name, value) => {
    await request(server)
      .get('/conflict-analysis/findings')
      .query({ [name]: value })
      .expect(400);
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns an empty page coherently', async () => {
    findMany.mockResolvedValue([]);
    const response = await request(server).get('/conflict-analysis/findings').expect(200);
    const body = response.body as ConflictFindingsPage;
    expect(body.items).toEqual([]);
    expect(body.pagination).toEqual(expect.objectContaining({ totalItems: 0, totalPages: 0 }));
  });

  it('matches the individual policy finding for the same facts', async () => {
    const projections = [
      projection(assetA, 'SRV-SHARED', ['10.0.0.1']),
      projection(assetB, 'srv-shared', ['10.0.0.2']),
    ];
    findMany.mockImplementation((args?: unknown) => {
      const input = args as { where?: unknown } | undefined;
      return Promise.resolve(input?.where ? [projections[1]] : projections);
    });
    findUnique.mockResolvedValue(projections[0]);

    const inventory = await request(server).get('/conflict-analysis/findings').expect(200);
    const individual = await request(server).get(`/assets/${assetA}/conflict-analysis`).expect(200);
    const inventoryBody = inventory.body as ConflictFindingsPage;
    const individualBody = individual.body as IdentityNetworkAnalysis;
    const listItem = inventoryBody.items[0];
    const detail = individualBody.findings[0];
    if (!listItem || !detail)
      throw new Error('Expected matching aggregate and individual findings.');
    expect(listItem).toEqual(
      expect.objectContaining({
        findingId: detail.findingId,
        type: detail.type,
        affectedAssetIds: detail.affectedAssetIds,
        normalizedHostname: detail.normalizedHostname,
        normalizedIp: detail.normalizedIp,
        temporalContext: detail.temporalContext,
        reviewOptions: detail.reviewOptions,
      }),
    );
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});

function projection(id: string, name: string, ipAddresses: string[]) {
  const evidenceId = randomUUID();
  const evidence = {
    id: evidenceId,
    source: 'signed-agent',
    evidenceType: 'TECHNICAL_AGENT',
    observedAt: new Date(NOW),
    ingestedAt: new Date(NOW),
  };
  return {
    id,
    name,
    updatedAt: new Date(NOW),
    attributes: [
      {
        value: name,
        valueText: name,
        isCurrent: true,
        observedAt: new Date(NOW),
        evidenceId,
        evidence,
      },
    ],
    networkInterfaces: [
      {
        ipAddresses,
        isCurrent: true,
        observedAt: new Date(NOW),
        evidenceId,
        evidence,
      },
    ],
  };
}
