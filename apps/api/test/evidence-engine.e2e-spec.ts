import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { EvidenceAnalysisService } from '../src/evidence-engine/evidence-analysis.service';
import { EvidenceEngineController } from '../src/evidence-engine/evidence-engine.controller';
import { EvidenceEngineService } from '../src/evidence-engine/evidence-engine.service';
import {
  SHADOW_DECISION_POLICY_VERSION,
  ShadowDecisionPolicy,
} from '../src/evidence-engine/shadow-decision.policy';
import { EvidenceCandidate } from '../src/evidence-engine/types/evidence-candidate';
import { evidenceSource } from '../src/evidence-engine/utils/evidence-utils';
import { PrismaService } from '../src/prisma/prisma.service';

type EvidenceAnalysisResponse = {
  asset: { id: string; name: string };
  mode: 'SHADOW';
  decisionsChanged: false;
  analyses: Array<{
    attribute: string;
    currentValue: unknown;
    persistedConfidenceScore: number | null;
    candidates: Array<{
      attributeId: string;
      source: { kind: string; trustScore: number | null };
      attributeObservedAt: string | null;
      evidenceObservedAt: string | null;
      evidenceIngestedAt: string | null;
      persistedConfidenceScore: number | null;
      isManual: boolean;
      evidenceAvailable: boolean;
      isCurrent: boolean;
    }>;
    selectedCandidate: { attributeId: string } | null;
    shadowDecision: {
      mode: 'SHADOW';
      status: string;
      recommendedCandidate: {
        normalizedValue: string;
        policyScore: number;
        supportingCandidateIds: string[];
      } | null;
      divergesFromCurrentValue: boolean | null;
      tiedValues: Array<{ normalizedValue: string; policyScore: number }>;
      policyVersion: string;
      assessments: Array<{
        sourceType: string;
        normalizedValue: string | null;
        eligible: boolean;
        policyScore: number | null;
        criteria: Array<{ criterion: string; points: number }>;
        limitations: string[];
      }>;
    };
    explanation: {
      status: string;
      decisionApplied: false;
      selectionBasis: string;
      observedValueCount: number;
      supportingEvidenceCount: number;
      limitations: string[];
    };
  }>;
};

function candidate(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    attributeId: 'attribute-current',
    value: 'Windows 11',
    valueText: 'Windows 11',
    normalizedValue: 'windows 11',
    source: evidenceSource('manual', 'MANUAL_ENRICHMENT'),
    attributeObservedAt: new Date('2026-07-10T12:00:00.000Z'),
    evidenceObservedAt: new Date('2026-07-11T12:00:00.000Z'),
    evidenceIngestedAt: new Date('2026-07-11T12:01:00.000Z'),
    persistedConfidenceScore: 82,
    dataQuality: 90,
    isManual: true,
    evidenceId: 'evidence-current',
    evidenceAvailable: true,
    isCurrent: true,
    confirmationCount: 1,
    ...overrides,
  };
}

describe('Evidence Engine strict provenance rules', () => {
  const engine = new EvidenceEngineService();

  it('selects one current candidate only when its evidence is available', () => {
    const analysis = engine.analyze({
      attribute: 'operatingSystem',
      currentValue: 'Windows 11',
      normalizedCurrentValue: 'windows 11',
      candidates: [candidate()],
    });

    expect(analysis.selectedCandidate?.attributeId).toBe('attribute-current');
    expect(analysis.persistedConfidenceScore).toBe(82);
    expect(analysis.explanation).toEqual(
      expect.objectContaining({
        status: 'CURRENT_VALUE_WITH_PROVENANCE',
        decisionApplied: false,
        selectionBasis: 'CURRENT_PERSISTED_VALUE',
        supportingEvidenceCount: 1,
      }),
    );
  });

  it('does not select a current value without evidenceId', () => {
    const analysis = engine.analyze({
      attribute: 'location',
      currentValue: 'Rio de Janeiro',
      normalizedCurrentValue: 'rio de janeiro',
      candidates: [
        candidate({
          value: 'Rio de Janeiro',
          valueText: 'Rio de Janeiro',
          normalizedValue: 'rio de janeiro',
          evidenceId: null,
          evidenceAvailable: false,
          evidenceObservedAt: null,
          evidenceIngestedAt: null,
        }),
      ],
    });

    expect(analysis.currentValue).toBe('Rio de Janeiro');
    expect(analysis.selectedCandidate).toBeNull();
    expect(analysis.explanation.supportingEvidenceCount).toBe(0);
    expect(analysis.explanation.limitations).toContain(
      'O valor atual não possui uma evidência vinculada que permita comprovar sua proveniência.',
    );
  });

  it('does not select a candidate whose linked evidence is unavailable', () => {
    const analysis = engine.analyze({
      attribute: 'location',
      currentValue: 'Rio de Janeiro',
      normalizedCurrentValue: 'rio de janeiro',
      candidates: [
        candidate({
          value: 'Rio de Janeiro',
          valueText: 'Rio de Janeiro',
          normalizedValue: 'rio de janeiro',
          evidenceId: 'missing-evidence',
          evidenceAvailable: false,
          evidenceObservedAt: null,
          evidenceIngestedAt: null,
        }),
      ],
    });

    expect(analysis.selectedCandidate).toBeNull();
    expect(analysis.explanation.supportingEvidenceCount).toBe(0);
    expect(analysis.explanation.limitations).toContain(
      'A evidência vinculada ao valor atual não está disponível para comprovar sua proveniência.',
    );
  });

  it('does not choose between multiple current candidates', () => {
    const candidates = [
      candidate({ attributeId: 'older', attributeObservedAt: new Date('2026-07-01T00:00:00Z') }),
      candidate({
        attributeId: 'newer',
        value: 'Windows 10',
        valueText: 'Windows 10',
        normalizedValue: 'windows 10',
        evidenceId: 'evidence-newer',
        attributeObservedAt: new Date('2026-07-12T00:00:00Z'),
      }),
    ];
    const analyze = (inputCandidates: EvidenceCandidate[]) =>
      engine.analyze({
        attribute: 'operatingSystem',
        currentValue: 'Windows 11',
        normalizedCurrentValue: 'windows 11',
        candidates: inputCandidates,
      });

    expect(analyze(candidates).selectedCandidate).toBeNull();
    expect(analyze([...candidates].reverse()).selectedCandidate).toBeNull();
    expect(analyze(candidates).explanation.status).toBe('AMBIGUOUS_CURRENT_CANDIDATES');
  });

  it('does not select one of multiple current candidates with the same value', () => {
    const analysis = engine.analyze({
      attribute: 'operatingSystem',
      currentValue: 'Windows 11',
      normalizedCurrentValue: 'windows 11',
      candidates: [
        candidate(),
        candidate({ attributeId: 'attribute-current-2', evidenceId: 'evidence-current-2' }),
      ],
    });

    expect(analysis.currentValue).toBe('Windows 11');
    expect(analysis.selectedCandidate).toBeNull();
    expect(analysis.explanation.status).toBe('AMBIGUOUS_CURRENT_CANDIDATES');
    expect(analysis.explanation.supportingEvidenceCount).toBe(2);
  });

  it('keeps a historical candidate without presenting it as current provenance', () => {
    const analysis = engine.analyze({
      attribute: 'department',
      currentValue: null,
      normalizedCurrentValue: null,
      candidates: [candidate({ isCurrent: false })],
    });

    expect(analysis.currentValue).toBeNull();
    expect(analysis.selectedCandidate).toBeNull();
    expect(analysis.candidates).toHaveLength(1);
    expect(analysis.explanation.status).toBe('NO_CURRENT_VALUE');
    expect(analysis.explanation.supportingEvidenceCount).toBe(0);
  });

  it('does not select a current candidate whose value differs from currentValue', () => {
    const analysis = engine.analyze({
      attribute: 'operatingSystem',
      currentValue: 'Windows 11',
      normalizedCurrentValue: 'windows 11',
      candidates: [
        candidate({
          value: 'Windows 10',
          valueText: 'Windows 10',
          normalizedValue: 'windows 10',
        }),
      ],
    });

    expect(analysis.selectedCandidate).toBeNull();
    expect(analysis.explanation.status).toBe('CURRENT_VALUE_CANDIDATE_MISMATCH');
  });

  it('does not count conflicting historical evidence as support', () => {
    const analysis = engine.analyze({
      attribute: 'operatingSystem',
      currentValue: 'Windows 11',
      normalizedCurrentValue: 'windows 11',
      candidates: [
        candidate(),
        candidate({
          attributeId: 'attribute-historical',
          value: 'Windows 10',
          valueText: 'Windows 10',
          normalizedValue: 'windows 10',
          evidenceId: 'evidence-historical',
          isCurrent: false,
        }),
      ],
    });

    expect(analysis.explanation.status).toBe('MULTIPLE_OBSERVED_VALUES');
    expect(analysis.explanation.supportingEvidenceCount).toBe(1);
    expect(analysis.explanation.limitations).toContain(
      'Foram encontradas evidências históricas com valor diferente do valor atual. Elas não foram contabilizadas como suporte ao valor atual.',
    );
  });

  it('counts distinct evidence with the same value as support', () => {
    const analysis = engine.analyze({
      attribute: 'operatingSystem',
      currentValue: 'Windows 11',
      normalizedCurrentValue: 'windows 11',
      candidates: [
        candidate(),
        candidate({
          attributeId: 'attribute-historical',
          evidenceId: 'evidence-historical',
          isCurrent: false,
        }),
      ],
    });

    expect(analysis.explanation.supportingEvidenceCount).toBe(2);
  });

  it('counts the same evidenceId only once', () => {
    const analysis = engine.analyze({
      attribute: 'operatingSystem',
      currentValue: 'Windows 11',
      normalizedCurrentValue: 'windows 11',
      candidates: [candidate(), candidate({ attributeId: 'duplicate', isCurrent: false })],
    });

    expect(analysis.explanation.supportingEvidenceCount).toBe(1);
  });

  it('returns zero support when there is no current value', () => {
    const analysis = engine.analyze({
      attribute: 'owner',
      currentValue: null,
      normalizedCurrentValue: null,
      candidates: [candidate({ isCurrent: false })],
    });

    expect(analysis.explanation.supportingEvidenceCount).toBe(0);
  });

  it('orders candidates deterministically without using order as a selection rule', () => {
    const candidates = [
      candidate({ attributeId: 'b', isCurrent: false }),
      candidate({ attributeId: 'a', isCurrent: false }),
    ];
    const analyze = (inputCandidates: EvidenceCandidate[]) =>
      engine.analyze({
        attribute: 'operatingSystem',
        currentValue: null,
        normalizedCurrentValue: null,
        candidates: inputCandidates,
      });

    expect(analyze(candidates)).toEqual(analyze([...candidates].reverse()));
    expect(analyze(candidates).selectedCandidate).toBeNull();
  });

  it('keeps unknown source authority and all trust scores null', () => {
    expect(evidenceSource('future-connector', 'SOURCE_SNAPSHOT')).toEqual({
      identifier: 'future-connector',
      kind: 'UNKNOWN',
      evidenceType: 'SOURCE_SNAPSHOT',
      trustScore: null,
    });
    expect(evidenceSource('manual', 'MANUAL_DECLARATION').kind).toBe('MANUAL');
    expect(evidenceSource('atlas-demo-agent', 'DEMO_ASSET_SNAPSHOT').kind).toBe('SIMULATED');
    expect(evidenceSource('network-discovery-lite', 'NETWORK_DISCOVERY').kind).toBe('SIMULATED');
    expect(evidenceSource('signed-agent', 'TECHNICAL_AGENT')).toEqual(
      expect.objectContaining({ kind: 'TECHNICAL', trustScore: null }),
    );
  });
});

describe('Evidence Engine provenance analysis endpoint (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  const assetId = randomUUID();
  const findUnique = jest.fn<() => Promise<unknown>>();
  const writeAttempt = jest.fn<() => Promise<never>>();

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [EvidenceEngineController],
      providers: [
        ShadowDecisionPolicy,
        EvidenceEngineService,
        EvidenceAnalysisService,
        {
          provide: PrismaService,
          useValue: {
            asset: { findUnique, create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            assetAttribute: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            assetEvidence: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            assetEvent: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
            conflict: { create: writeAttempt, update: writeAttempt, delete: writeAttempt },
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
    writeAttempt.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  function mockAsset(attributes: unknown[]) {
    findUnique.mockResolvedValue({ id: assetId, name: 'NB-RH-001', attributes });
  }

  function currentAttribute(overrides: Record<string, unknown> = {}) {
    return {
      id: 'attribute-current',
      evidenceId: 'evidence-current',
      key: 'OPERATINGSYSTEM',
      value: 'Windows 11',
      valueText: 'Windows 11',
      confidenceScore: 82,
      dataQualityScore: 90,
      isCurrent: true,
      observedAt: new Date('2026-07-10T12:00:00.000Z'),
      confirmationCount: 2,
      evidence: {
        id: 'evidence-current',
        source: 'manual',
        evidenceType: 'MANUAL_ENRICHMENT',
        observedAt: new Date('2026-07-11T12:00:00.000Z'),
        ingestedAt: new Date('2026-07-11T12:01:00.000Z'),
      },
      ...overrides,
    };
  }

  it('returns strict provenance, separate timestamps and persisted score semantics', async () => {
    mockAsset([
      currentAttribute(),
      currentAttribute({
        id: 'attribute-historical',
        evidenceId: 'evidence-historical',
        value: 'Windows 10',
        valueText: 'Windows 10',
        confidenceScore: 70,
        dataQualityScore: 75,
        isCurrent: false,
        observedAt: new Date('2026-07-09T12:00:00.000Z'),
        confirmationCount: 1,
        evidence: {
          id: 'evidence-historical',
          source: 'network-discovery-lite',
          evidenceType: 'NETWORK_DISCOVERY',
          observedAt: new Date('2026-07-09T13:00:00.000Z'),
          ingestedAt: new Date('2026-07-09T13:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const body = response.body as EvidenceAnalysisResponse;
    const analysis = body.analyses[0];
    const current = analysis?.candidates.find((item) => item.isCurrent);

    expect(body.mode).toBe('SHADOW');
    expect(body.decisionsChanged).toBe(false);
    expect(analysis).toEqual(
      expect.objectContaining({
        attribute: 'operatingSystem',
        currentValue: 'Windows 11',
        persistedConfidenceScore: 82,
        selectedCandidate: expect.objectContaining({ attributeId: 'attribute-current' }),
        shadowDecision: expect.objectContaining({
          mode: 'SHADOW',
          status: 'CURRENT_VALUE_CONFIRMED',
          policyVersion: SHADOW_DECISION_POLICY_VERSION,
          divergesFromCurrentValue: false,
        }),
        explanation: expect.objectContaining({
          status: 'MULTIPLE_OBSERVED_VALUES',
          decisionApplied: false,
          supportingEvidenceCount: 1,
        }),
      }),
    );
    expect(analysis).not.toHaveProperty('confidence');
    expect(current).toEqual(
      expect.objectContaining({
        attributeObservedAt: '2026-07-10T12:00:00.000Z',
        evidenceObservedAt: '2026-07-11T12:00:00.000Z',
        evidenceIngestedAt: '2026-07-11T12:01:00.000Z',
        persistedConfidenceScore: 82,
        evidenceAvailable: true,
        source: expect.objectContaining({ kind: 'MANUAL', trustScore: null }),
      }),
    );
    expect(current).not.toHaveProperty('observedAt');
    expect(current).not.toHaveProperty('ingestedAt');
    expect(current).not.toHaveProperty('confidence');
    expect(JSON.stringify(body)).not.toContain('"payload"');
    expect(analysis?.shadowDecision.recommendedCandidate?.normalizedValue).toBe('windows 11');
    expect(analysis?.shadowDecision.assessments[0]?.sourceType).toBe('MANUAL');
    expect(current?.source.trustScore).toBeNull();
  });

  it('returns null evidence timestamps and no selection without evidenceId', async () => {
    mockAsset([
      currentAttribute({ evidenceId: null, evidence: null }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const body = response.body as EvidenceAnalysisResponse;
    const analysis = body.analyses[0];

    expect(analysis?.currentValue).toBe('Windows 11');
    expect(analysis?.selectedCandidate).toBeNull();
    expect(analysis?.explanation.supportingEvidenceCount).toBe(0);
    expect(analysis?.candidates[0]).toEqual(
      expect.objectContaining({
        evidenceObservedAt: null,
        evidenceIngestedAt: null,
        evidenceAvailable: false,
      }),
    );
  });

  it('does not select a persisted evidenceId when its relation is unavailable', async () => {
    mockAsset([
      currentAttribute({ evidenceId: 'missing-evidence', evidence: null }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const body = response.body as EvidenceAnalysisResponse;

    expect(body.analyses[0]?.selectedCandidate).toBeNull();
    expect(body.analyses[0]?.explanation.supportingEvidenceCount).toBe(0);
    expect(body.analyses[0]?.candidates[0]).toEqual(
      expect.objectContaining({ evidenceId: 'missing-evidence', evidenceAvailable: false }),
    );
  });

  it('returns no current value or selection when current records disagree', async () => {
    mockAsset([
      currentAttribute(),
      currentAttribute({
        id: 'attribute-current-2',
        evidenceId: 'evidence-current-2',
        key: 'OS',
        value: 'Windows 10',
        valueText: 'Windows 10',
        evidence: {
          id: 'evidence-current-2',
          source: 'network-discovery-lite',
          evidenceType: 'NETWORK_DISCOVERY',
          observedAt: new Date('2026-07-12T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-12T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const body = response.body as EvidenceAnalysisResponse;

    expect(body.analyses[0]?.currentValue).toBeNull();
    expect(body.analyses[0]?.selectedCandidate).toBeNull();
    expect(body.analyses[0]?.explanation.status).toBe('AMBIGUOUS_CURRENT_CANDIDATES');
    expect(body.analyses[0]?.explanation.supportingEvidenceCount).toBe(0);
  });

  it('recommends a divergent technical value without changing the persisted selection', async () => {
    mockAsset([
      currentAttribute({
        value: 'Windows 10',
        valueText: 'Windows 10',
      }),
      currentAttribute({
        id: 'attribute-technical',
        evidenceId: 'evidence-technical',
        value: 'Windows 11',
        valueText: 'Windows 11',
        isCurrent: false,
        evidence: {
          id: 'evidence-technical',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const analysis = (response.body as EvidenceAnalysisResponse).analyses[0];

    expect(analysis?.currentValue).toBe('Windows 10');
    expect(analysis?.selectedCandidate?.attributeId).toBe('attribute-current');
    expect(analysis?.shadowDecision).toEqual(
      expect.objectContaining({
        status: 'RECOMMENDED',
        divergesFromCurrentValue: true,
        recommendedCandidate: expect.objectContaining({ normalizedValue: 'windows 11' }),
      }),
    );
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns an explicit tie without choosing by database order', async () => {
    mockAsset([
      currentAttribute({
        isCurrent: false,
        evidence: {
          id: 'evidence-current',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
      currentAttribute({
        id: 'attribute-linux',
        evidenceId: 'evidence-linux',
        value: 'Linux',
        valueText: 'Linux',
        isCurrent: false,
        evidence: {
          id: 'evidence-linux',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const analysis = (response.body as EvidenceAnalysisResponse).analyses[0];

    expect(analysis?.currentValue).toBeNull();
    expect(analysis?.shadowDecision.status).toBe('TIED');
    expect(analysis?.shadowDecision.recommendedCandidate).toBeNull();
    expect(analysis?.shadowDecision.tiedValues).toHaveLength(2);
  });

  it.each([
    ['SIMULATED', 'network-discovery-lite', 'NETWORK_DISCOVERY'],
    ['UNKNOWN', 'future-connector', 'SOURCE_SNAPSHOT'],
  ])('keeps a %s source ineligible in the endpoint response', async (kind, sourceName, evidenceType) => {
    mockAsset([
      currentAttribute({
        evidence: {
          id: 'evidence-current',
          source: sourceName,
          evidenceType,
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const decision = (response.body as EvidenceAnalysisResponse).analyses[0]?.shadowDecision;

    expect(decision?.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision?.recommendedCandidate).toBeNull();
    expect(decision?.assessments[0]).toEqual(
      expect.objectContaining({ sourceType: kind, eligible: false, policyScore: null }),
    );
  });

  it('recommends an eligible historical value when no current value exists', async () => {
    mockAsset([
      currentAttribute({
        isCurrent: false,
        evidence: {
          id: 'evidence-current',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const decision = (response.body as EvidenceAnalysisResponse).analyses[0]?.shadowDecision;

    expect(decision).toEqual(
      expect.objectContaining({
        status: 'RECOMMENDED',
        divergesFromCurrentValue: null,
        recommendedCandidate: expect.objectContaining({ normalizedValue: 'windows 11' }),
      }),
    );
  });

  it('keeps a recent technical empty value visible but outside the recommendation', async () => {
    mockAsset([
      currentAttribute({
        value: '   ',
        valueText: '   ',
        evidence: {
          id: 'evidence-current',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const body = response.body as EvidenceAnalysisResponse;
    const analysis = body.analyses[0];
    const assessment = analysis?.shadowDecision.assessments[0];

    expect(body.decisionsChanged).toBe(false);
    expect(analysis?.currentValue).toBeNull();
    expect(analysis?.selectedCandidate).toBeNull();
    expect(analysis?.candidates[0]?.source.trustScore).toBeNull();
    expect(analysis?.shadowDecision.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(analysis?.shadowDecision.recommendedCandidate).toBeNull();
    expect(assessment).toEqual(
      expect.objectContaining({
        sourceType: 'TECHNICAL',
        normalizedValue: null,
        eligible: false,
        policyScore: null,
      }),
    );
    expect(assessment?.criteria.every((criterion) => criterion.points === 0)).toBe(true);
    expect(assessment?.limitations).toContain('O candidato não possui valor normalizado válido.');
    expect(JSON.stringify(body)).not.toContain('"payload"');
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('recommends only the valid candidate when another technical candidate is empty', async () => {
    mockAsset([
      currentAttribute({
        value: '',
        valueText: '',
        evidence: {
          id: 'evidence-current',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
      currentAttribute({
        id: 'attribute-valid',
        evidenceId: 'evidence-valid',
        value: 'Windows 11',
        valueText: 'Windows 11',
        isCurrent: false,
        evidence: {
          id: 'evidence-valid',
          source: 'signed-agent',
          evidenceType: 'TECHNICAL_AGENT',
          observedAt: new Date('2026-07-14T12:00:00.000Z'),
          ingestedAt: new Date('2026-07-14T12:01:00.000Z'),
        },
      }),
    ]);

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const analysis = (response.body as EvidenceAnalysisResponse).analyses[0];
    const empty = analysis?.shadowDecision.assessments.find(
      (assessment) => assessment.normalizedValue === null,
    );

    expect(analysis?.currentValue).toBeNull();
    expect(analysis?.shadowDecision).toEqual(
      expect.objectContaining({
        status: 'RECOMMENDED',
        divergesFromCurrentValue: null,
        recommendedCandidate: expect.objectContaining({ normalizedValue: 'windows 11' }),
      }),
    );
    expect(empty).toEqual(expect.objectContaining({ eligible: false, policyScore: null }));
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns the same response twice and performs no write', async () => {
    mockAsset([currentAttribute()]);

    const first = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const second = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);

    expect(first.body).toEqual(second.body);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('returns 404 when the asset does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await request(httpServer).get(`/assets/${assetId}/evidence-analysis`).expect(404);
    expect(writeAttempt).not.toHaveBeenCalled();
  });

  it('rejects an invalid asset identifier before consulting Prisma', async () => {
    await request(httpServer).get('/assets/not-a-uuid/evidence-analysis').expect(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});
