import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { ConflictAnalysisController } from '../src/conflict-analysis/conflict-analysis.controller';
import {
  ConflictAnalysisPolicy,
  IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
} from '../src/conflict-analysis/conflict-analysis.policy';
import { ConflictAnalysisService } from '../src/conflict-analysis/conflict-analysis.service';
import {
  normalizeConflictHostname,
  normalizeConflictIp,
} from '../src/conflict-analysis/conflict-normalization';
import {
  AssetIdentitySnapshot,
  ConflictObservation,
  ConflictSourceType,
  IdentityNetworkAnalysis,
} from '../src/conflict-analysis/types/conflict-analysis';
import { PrismaService } from '../src/prisma/prisma.service';

const NOW = '2026-07-16T12:00:00.000Z';

function hostname(
  assetId: string,
  value: string,
  overrides: Partial<ConflictObservation> = {},
): ConflictObservation {
  return {
    assetId,
    value,
    normalizedValue: normalizeConflictHostname(value) ?? '',
    attribute: 'HOSTNAME',
    source: 'signed-agent',
    sourceType: 'TECHNICAL',
    evidenceId: `evidence-host-${assetId}-${value}`,
    observedAt: NOW,
    ingestedAt: NOW,
    current: true,
    ...overrides,
  };
}

function ip(
  assetId: string,
  value: string,
  overrides: Partial<ConflictObservation> = {},
): ConflictObservation {
  return {
    assetId,
    value,
    normalizedValue: normalizeConflictIp(value) ?? '',
    attribute: 'IP_ADDRESS',
    source: 'signed-agent',
    sourceType: 'TECHNICAL',
    evidenceId: `evidence-ip-${assetId}-${value}`,
    observedAt: NOW,
    ingestedAt: NOW,
    current: true,
    ...overrides,
  };
}

function snapshot(
  assetId: string,
  hostnames: ConflictObservation[] = [],
  ips: ConflictObservation[] = [],
  limitations: string[] = [],
): AssetIdentitySnapshot {
  return {
    assetId,
    snapshotAt: NOW,
    hostnameObservations: hostnames,
    ipObservations: ips,
    limitations,
  };
}

describe('Identity and network conflict normalization', () => {
  it.each([
    [' SRV-01 ', 'srv-01'],
    ['srv-01.empresa.local', 'srv-01.empresa.local'],
    ['SRV-01.EMPRESA.LOCAL', 'srv-01.empresa.local'],
  ])('normalizes valid hostname %s', (input, expected) => {
    expect(normalizeConflictHostname(input)).toBe(expected);
  });

  it.each(['', '   ', '-srv', 'srv-', 'srv_01', 'srv..empresa']) (
    'rejects empty or invalid hostname %s',
    (input) => expect(normalizeConflictHostname(input)).toBeNull(),
  );

  it('does not equate short name and FQDN', () => {
    expect(normalizeConflictHostname('srv01')).not.toBe(
      normalizeConflictHostname('srv01.empresa.local'),
    );
  });

  it.each([
    ['10.20.30.15', '10.20.30.15'],
    [' 10.20.30.15 ', '10.20.30.15'],
    ['2001:0db8:0:0:0:0:0:1', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
  ])('normalizes valid IP %s', (input, expected) => {
    expect(normalizeConflictIp(input)).toBe(expected);
  });

  it.each(['', '   ', 'server.local', '10.20.0.0/24', '999.1.1.1']) (
    'rejects empty or invalid IP %s',
    (input) => expect(normalizeConflictIp(input)).toBeNull(),
  );
});

describe('Identity and network conflict policy', () => {
  const policy = new ConflictAnalysisPolicy();

  it('does not find duplicate hostname inside the same asset', () => {
    const result = policy.analyze('a', snapshotList(snapshot('a', [hostname('a', 'SRV-01'), hostname('a', 'srv-01')])));
    expect(result.findings).toHaveLength(0);
  });

  it('finds normalized duplicate hostname across assets with different IPs', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01')], [ip('a', '10.0.0.1')]),
      snapshot('b', [hostname('b', 'srv-01')], [ip('b', '10.0.0.2')]),
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        normalizedHostname: 'srv-01',
        affectedAssetIds: ['a', 'b'],
        requiresHumanReview: true,
      }),
    ]);
  });

  it('does not find hostname conflict for different hostnames and different IPs', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01')], [ip('a', '10.0.0.1')]),
      snapshot('b', [hostname('b', 'SRV-02')], [ip('b', '10.0.0.2')]),
    ]);
    expect(result.findings).toHaveLength(0);
  });

  it('does not create conflict for equivalent hostname and IP observations in one asset', () => {
    const result = policy.analyze('a', [
      snapshot(
        'a',
        [hostname('a', 'SRV-01'), hostname('a', 'srv-01', { source: 'manual', sourceType: 'MANUAL' })],
        [ip('a', '10.0.0.1'), ip('a', '10.0.0.1', { source: 'manual', sourceType: 'MANUAL' })],
      ),
    ]);
    expect(result.findings).toHaveLength(0);
  });

  it('same hostname and IP across assets creates only hostname finding', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01')], [ip('a', '10.0.0.1')]),
      snapshot('b', [hostname('b', 'SRV-01')], [ip('b', '10.0.0.1')]),
    ]);
    expect(result.findings.map((finding) => finding.type)).toEqual([
      'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    ]);
  });

  it('finds hostname divergence and shared IP for one asset with different hostnames', () => {
    const result = policy.analyze('a', [
      snapshot(
        'a',
        [hostname('a', 'SRV-01'), hostname('a', 'SRV-02', { current: false })],
        [ip('a', '10.0.0.1')],
      ),
    ]);
    expect(result.findings.map((finding) => finding.type).sort()).toEqual([
      'HOSTNAME_DIVERGENCE_ON_ASSET',
      'SHARED_IP_DIFFERENT_HOSTNAMES',
    ]);
  });

  it('finds shared IP with different hostnames across assets without joining identity', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01')], [ip('a', '10.0.0.1')]),
      snapshot('b', [hostname('b', 'SRV-02')], [ip('b', '10.0.0.1')]),
    ]);
    const finding = result.findings[0];
    expect(finding).toEqual(
      expect.objectContaining({
        type: 'SHARED_IP_DIFFERENT_HOSTNAMES',
        normalizedIp: '10.0.0.1',
        affectedAssetIds: ['a', 'b'],
      }),
    );
    expect(finding?.explanation.join(' ')).toContain('não comprova');
    expect(finding).not.toHaveProperty('mergedAssetId');
  });

  it('describes persisted versus technical hostname divergence without applying it', () => {
    const result = policy.analyze('a', [
      snapshot('a', [
        hostname('a', 'SRV-01', { source: 'ASSET_PERSISTED_VALUE', sourceType: 'UNKNOWN', observedAt: null }),
        hostname('a', 'SRV-02', { sourceType: 'TECHNICAL' }),
      ]),
    ]);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({ type: 'HOSTNAME_DIVERGENCE_ON_ASSET' }),
    );
    expect(result.decisionsChanged).toBe(false);
  });

  it('keeps manual versus technical divergence descriptive', () => {
    const result = policy.analyze('a', [
      snapshot('a', [
        hostname('a', 'SRV-01', { source: 'manual', sourceType: 'MANUAL' }),
        hostname('a', 'SRV-02', { sourceType: 'TECHNICAL' }),
      ]),
    ]);
    expect(result.findings[0]?.observations.map((item) => item.sourceType).sort()).toEqual([
      'MANUAL',
      'TECHNICAL',
    ]);
    expect(result.findings[0]).not.toHaveProperty('recommendedOption');
  });

  it.each<ConflictSourceType>(['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN'])(
    'preserves source type %s',
    (sourceType) => {
      const result = policy.analyze('a', [
        snapshot('a', [hostname('a', 'SRV-01', { sourceType })]),
        snapshot('b', [hostname('b', 'SRV-01')]),
      ]);
      expect(result.findings[0]?.observations.some((item) => item.sourceType === sourceType)).toBe(true);
    },
  );

  it('adds explicit limitations for simulated and unknown sources', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01', { sourceType: 'SIMULATED' })]),
      snapshot('b', [hostname('b', 'SRV-01', { sourceType: 'UNKNOWN' })]),
    ]);
    expect(result.findings[0]?.limitations.join(' ')).toContain('fonte simulada');
    expect(result.findings[0]?.limitations.join(' ')).toContain('fonte é desconhecida');
  });

  it('marks equal timestamps descriptively', () => {
    const result = duplicateAt('2026-07-10T10:00:00.000Z', '2026-07-10T10:00:00.000Z');
    expect(result.findings[0]?.temporalContext.relationship).toBe('SAME_OBSERVATION_TIME');
    expect(result.findings[0]?.temporalContext.differenceMilliseconds).toBe(0);
  });

  it('marks distinct timestamps and exposes their objective difference', () => {
    const result = duplicateAt('2026-07-10T10:00:00.000Z', '2026-07-15T10:00:00.000Z');
    expect(result.findings[0]?.temporalContext).toEqual(
      expect.objectContaining({
        relationship: 'DISTINCT_OBSERVATION_TIMES',
        differenceMilliseconds: 432_000_000,
      }),
    );
  });

  it('marks partial temporal context', () => {
    const result = duplicateAt('2026-07-10T10:00:00.000Z', null);
    expect(result.findings[0]?.temporalContext.relationship).toBe('PARTIAL_TEMPORAL_CONTEXT');
  });

  it('marks missing temporal context', () => {
    const result = duplicateAt(null, null);
    expect(result.findings[0]?.temporalContext.relationship).toBe('NO_TEMPORAL_CONTEXT');
    expect(result.findings[0]?.limitations.join(' ')).toContain('Não há contexto temporal suficiente');
  });

  it('preserves historical observation and its limitation', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01'), hostname('a', 'SRV-OLD', { current: false })]),
    ]);
    expect(result.findings[0]?.observations.some((item) => !item.current)).toBe(true);
    expect(result.findings[0]?.limitations.join(' ')).toContain('observação histórica');
  });

  it('does not inflate findings for equivalent repeated observations', () => {
    const repeated = hostname('a', 'SRV-01');
    const result = policy.analyze('a', [
      snapshot('a', [repeated, { ...repeated }]),
      snapshot('b', [hostname('b', 'SRV-01')]),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.observations).toHaveLength(2);
  });

  it('is independent from input order and produces deterministic findingId', () => {
    const input = [
      snapshot('a', [hostname('a', 'SRV-01')]),
      snapshot('b', [hostname('b', 'SRV-01')]),
    ];
    const first = policy.analyze('a', input);
    const second = policy.analyze('a', [...input].reverse());
    expect(second).toEqual(first);
    expect(first.findings[0]?.findingId).toMatch(/^finding_[a-f0-9]{24}$/);
  });

  it('returns review options without a preselected resolution', () => {
    const result = policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01')]),
      snapshot('b', [hostname('b', 'SRV-01')]),
    ]);
    expect(result.findings[0]?.reviewOptions).toContain('NEEDS_MORE_EVIDENCE');
    expect(result.findings[0]).not.toHaveProperty('selectedReviewOption');
    expect(result.findings[0]).not.toHaveProperty('recommendation');
  });

  it('returns no finding without hostname or interfaces', () => {
    const result = policy.analyze('a', [snapshot('a', [], [], ['Sem identidade observável.'])]);
    expect(result.summary).toEqual({ totalFindings: 0, requiresHumanReview: 0 });
    expect(result.limitations).toContain('Sem identidade observável.');
  });

  it('keeps policy version, SHADOW mode and no decision', () => {
    const result = policy.analyze('a', [snapshot('a')]);
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'SHADOW',
        policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
        decisionsChanged: false,
      }),
    );
  });

  function duplicateAt(left: string | null, right: string | null) {
    return policy.analyze('a', [
      snapshot('a', [hostname('a', 'SRV-01', { observedAt: left })]),
      snapshot('b', [hostname('b', 'SRV-01', { observedAt: right })]),
    ]);
  }
});

describe('Identity and network conflict analysis endpoint (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  const assetId = randomUUID();
  const relatedAssetId = randomUUID();
  const findUnique = jest.fn<() => Promise<unknown>>();
  const findMany = jest.fn<() => Promise<unknown[]>>();
  const writeAttempt = jest.fn<() => Promise<never>>();

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [ConflictAnalysisController],
      providers: [
        ConflictAnalysisPolicy,
        ConflictAnalysisService,
        {
          provide: PrismaService,
          useValue: {
            asset: {
              findUnique,
              findMany,
              create: writeAttempt,
              update: writeAttempt,
              upsert: writeAttempt,
              delete: writeAttempt,
            },
            assetAttribute: { create: writeAttempt, update: writeAttempt, upsert: writeAttempt, delete: writeAttempt },
            networkInterface: { create: writeAttempt, update: writeAttempt, upsert: writeAttempt, delete: writeAttempt },
            assetEvidence: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            assetEvent: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            conflict: { create: writeAttempt, update: writeAttempt, upsert: writeAttempt, delete: writeAttempt },
            auditLog: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            $transaction: writeAttempt,
          },
        },
      ],
    }).compile();

    app = testingModule.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
    writeAttempt.mockReset();
    findMany.mockResolvedValue([]);
  });

  afterAll(async () => app.close());

  it('returns a deterministic read-only response without findings', async () => {
    findUnique.mockResolvedValue(assetProjection(assetId, 'SRV-01'));

    const first = await request(httpServer).get(`/assets/${assetId}/conflict-analysis`).expect(200);
    const second = await request(httpServer).get(`/assets/${assetId}/conflict-analysis`).expect(200);

    expect(second.body).toEqual(first.body);
    expect(first.body).toEqual(
      expect.objectContaining({
        assetId,
        mode: 'SHADOW',
        policyVersion: IDENTITY_NETWORK_CONFLICT_POLICY_VERSION,
        decisionsChanged: false,
        summary: { totalFindings: 0, requiresHumanReview: 0 },
      }),
    );
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns duplicate hostname across assets without exposing Prisma or raw payload', async () => {
    findUnique.mockResolvedValue(assetProjection(assetId, 'SRV-FINANCEIRO-01', ['10.20.30.15']));
    findMany.mockResolvedValue([
      assetProjection(relatedAssetId, 'srv-financeiro-01', ['10.20.30.16']),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/conflict-analysis`)
      .expect(200);
    const body = response.body as IdentityNetworkAnalysis;
    const serialized = JSON.stringify(body);

    expect(body.findings).toEqual([
      expect.objectContaining({
        type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
        affectedAssetIds: [assetId, relatedAssetId].sort(),
      }),
    ]);
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('fingerprint');
    expect(serialized).not.toContain('canonicalKey');
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns shared IP with different hostnames and temporal context', async () => {
    findUnique.mockResolvedValue(assetProjection(assetId, 'SRV-FINANCEIRO-01', ['10.20.30.15']));
    findMany.mockResolvedValue([
      assetProjection(relatedAssetId, 'SRV-FINANCEIRO-02', ['10.20.30.15'], '2026-07-15T12:00:00.000Z'),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/conflict-analysis`)
      .expect(200);
    const body = response.body as IdentityNetworkAnalysis;
    const finding = body.findings.find(
      (item) => item.type === 'SHARED_IP_DIFFERENT_HOSTNAMES',
    );

    expect(finding).toEqual(
      expect.objectContaining({
        normalizedIp: '10.20.30.15',
        temporalContext: expect.objectContaining({ relationship: 'PARTIAL_TEMPORAL_CONTEXT' }),
      }),
    );
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns hostname divergence within the target asset', async () => {
    findUnique.mockResolvedValue(
      assetProjection(assetId, 'SRV-FINANCEIRO-01', [], NOW, 'SRV-FINANCEIRO-02'),
    );

    const response = await request(httpServer)
      .get(`/assets/${assetId}/conflict-analysis`)
      .expect(200);
    const body = response.body as IdentityNetworkAnalysis;

    expect(body.findings).toEqual([
      expect.objectContaining({ type: 'HOSTNAME_DIVERGENCE_ON_ASSET' }),
    ]);
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown asset and performs no write', async () => {
    findUnique.mockResolvedValue(null);
    await request(httpServer).get(`/assets/${assetId}/conflict-analysis`).expect(404);
    expect(findMany).not.toHaveBeenCalled();
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID before consulting Prisma', async () => {
    await request(httpServer).get('/assets/not-a-uuid/conflict-analysis').expect(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});

function snapshotList(item: AssetIdentitySnapshot): AssetIdentitySnapshot[] {
  return [item];
}

function assetProjection(
  id: string,
  name: string,
  ipAddresses: string[] = [],
  observedAt = NOW,
  attributeHostname = name,
) {
  const evidenceId = randomUUID();
  const evidence = {
    id: evidenceId,
    source: 'signed-agent',
    evidenceType: 'TECHNICAL_AGENT',
    observedAt: new Date(observedAt),
    ingestedAt: new Date(observedAt),
  };
  return {
    id,
    name,
    updatedAt: new Date(NOW),
    attributes: [
      {
        value: attributeHostname,
        valueText: attributeHostname,
        isCurrent: attributeHostname === name,
        observedAt: new Date(observedAt),
        evidenceId,
        evidence,
      },
    ],
    networkInterfaces: ipAddresses.length
      ? [
          {
            ipAddresses,
            isCurrent: true,
            observedAt: new Date(observedAt),
            evidenceId,
            evidence,
          },
        ]
      : [],
  };
}
