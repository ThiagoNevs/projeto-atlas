import { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DataQualityController } from '../src/data-quality/data-quality.controller';
import { DataQualityService } from '../src/data-quality/data-quality.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Data quality with an empty database (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const prismaMock = {
      asset: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
        aggregate: jest
          .fn<
            () => Promise<{
              _avg: { dataQualityScore: null; confidenceScore: null };
            }>
          >()
          .mockResolvedValue({
            _avg: { dataQualityScore: null, confidenceScore: null },
          }),
      },
      $transaction: jest
        .fn<(operations: Promise<unknown>[]) => Promise<unknown[]>>()
        .mockImplementation((operations) => Promise.all(operations)),
    };
    const testingModule = await Test.createTestingModule({
      controllers: [DataQualityController],
      providers: [DataQualityService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    app = testingModule.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a safe summary without assets', async () => {
    const response = await request(httpServer).get('/data-quality/summary').expect(200);

    expect(response.body).toEqual({
      totalAssets: 0,
      lowDataQuality: 0,
      lowConfidence: 0,
      missingSerialNumber: 0,
      missingManufacturer: 0,
      missingModel: 0,
      missingOperatingSystem: 0,
      missingNetworkInfo: 0,
      missingAdministrativeStatus: 0,
      assetsWithoutRecentEvidence: 0,
      averageDataQualityScore: 0,
      averageConfidenceScore: 0,
    });
  });

  it('returns a safe CSV export without assets', async () => {
    const response = await request(httpServer).get('/data-quality/assets/export').expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('"Atlas ID";"Nome";"Hostname";"Tipo"');
    expect(response.text.trim().split('\n')).toHaveLength(1);
  });
});
