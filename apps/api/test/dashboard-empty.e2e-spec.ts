import { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DashboardController } from '../src/dashboard/dashboard.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Dashboard with an empty database (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const prismaMock = {
      asset: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        groupBy: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
        findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
      },
      conflict: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
      networkDiscoveryRun: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      },
      assetEvent: {
        findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
      },
    };

    const testingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [DashboardService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    app = testingModule.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a safe summary when no records exist', async () => {
    const response = await request(httpServer).get('/dashboard/summary').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        assets: expect.objectContaining({
          total: 0,
          seenRecently: 0,
          byAdministrativeStatus: {},
          byOperationalStatus: {},
          byType: {},
          byOperatingSystem: {},
          byOperatingSystemVersion: {},
        }),
        conflicts: expect.objectContaining({ totalOpen: 0, inReview: 0 }),
        networkDiscovery: expect.objectContaining({
          totalRuns: 0,
          lastRunStatus: null,
          lastRunAt: null,
        }),
        recentActivity: [],
      }),
    );
  });
});
