import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { EvidenceAnalysisService } from '../src/evidence-engine/evidence-analysis.service';
import { EvidenceEngineController } from '../src/evidence-engine/evidence-engine.controller';
import { EvidenceEngineService } from '../src/evidence-engine/evidence-engine.service';
import { evidenceSource } from '../src/evidence-engine/utils/evidence-utils';
import { PrismaService } from '../src/prisma/prisma.service';

type EvidenceAnalysisResponse = {
  asset: { id: string; name: string };
  mode: 'SHADOW';
  decisionsChanged: false;
  analyses: Array<{
    attribute: string;
    currentValue: unknown;
    confidence: number | null;
    candidates: Array<{
      attributeId: string;
      source: { kind: string; trustScore: number | null };
      isManual: boolean;
      isCurrent: boolean;
    }>;
    selectedCandidate: { attributeId: string } | null;
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

describe('Evidence Engine provenance analysis (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  const assetId = randomUUID();
  const findUnique = jest.fn<() => Promise<unknown>>();

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [EvidenceEngineController],
      providers: [
        EvidenceEngineService,
        EvidenceAnalysisService,
        {
          provide: PrismaService,
          useValue: { asset: { findUnique } },
        },
      ],
    }).compile();

    app = testingModule.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    findUnique.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('organizes persisted candidates without recalculating or changing a decision', async () => {
    findUnique.mockResolvedValue({
      id: assetId,
      name: 'NB-RH-001',
      attributes: [
        {
          id: 'attribute-current',
          key: 'OPERATINGSYSTEM',
          value: 'Windows 11',
          valueText: 'Windows 11',
          confidenceScore: 82,
          dataQualityScore: 90,
          isCurrent: true,
          observedAt: new Date('2026-07-10T12:00:00.000Z'),
          confirmationCount: 2,
          evidence: {
            id: 'evidence-manual',
            source: 'manual',
            evidenceType: 'MANUAL_ENRICHMENT',
            observedAt: new Date('2026-07-10T12:00:00.000Z'),
            ingestedAt: new Date('2026-07-10T12:01:00.000Z'),
          },
        },
        {
          id: 'attribute-historical',
          key: 'os',
          value: 'Windows 10',
          valueText: 'Windows 10',
          confidenceScore: 70,
          dataQualityScore: 75,
          isCurrent: false,
          observedAt: new Date('2026-07-11T12:00:00.000Z'),
          confirmationCount: 1,
          evidence: {
            id: 'evidence-discovery',
            source: 'network-discovery-lite',
            evidenceType: 'NETWORK_DISCOVERY',
            observedAt: new Date('2026-07-11T12:00:00.000Z'),
            ingestedAt: new Date('2026-07-11T12:01:00.000Z'),
          },
        },
      ],
    });

    const response = await request(httpServer)
      .get(`/assets/${assetId}/evidence-analysis`)
      .expect(200);
    const body = response.body as EvidenceAnalysisResponse;

    expect(body.mode).toBe('SHADOW');
    expect(body.decisionsChanged).toBe(false);
    expect(body.analyses).toHaveLength(1);
    expect(body.analyses[0]).toEqual(
      expect.objectContaining({
        attribute: 'operatingSystem',
        currentValue: 'Windows 11',
        confidence: 82,
        selectedCandidate: expect.objectContaining({ attributeId: 'attribute-current' }),
        explanation: expect.objectContaining({
          status: 'MULTIPLE_OBSERVED_VALUES',
          decisionApplied: false,
          selectionBasis: 'CURRENT_PERSISTED_VALUE',
          observedValueCount: 2,
          supportingEvidenceCount: 2,
        }),
      }),
    );
    expect(body.analyses[0]?.candidates[0]).toEqual(
      expect.objectContaining({
        attributeId: 'attribute-current',
        isCurrent: true,
        isManual: true,
        source: expect.objectContaining({ kind: 'MANUAL', trustScore: null }),
      }),
    );
    expect(body.analyses[0]?.candidates[1]).toEqual(
      expect.objectContaining({
        attributeId: 'attribute-historical',
        isCurrent: false,
        isManual: false,
        source: expect.objectContaining({ kind: 'SIMULATED', trustScore: null }),
      }),
    );
  });

  it('keeps source trust separate and does not invent trust for unknown sources', () => {
    expect(evidenceSource('future-connector', 'SOURCE_SNAPSHOT')).toEqual({
      identifier: 'future-connector',
      kind: 'UNKNOWN',
      evidenceType: 'SOURCE_SNAPSHOT',
      trustScore: null,
    });
  });

  it('returns 404 when the asset does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await request(httpServer).get(`/assets/${assetId}/evidence-analysis`).expect(404);
  });

  it('rejects an invalid asset identifier before consulting Prisma', async () => {
    await request(httpServer).get('/assets/not-a-uuid/evidence-analysis').expect(400);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
