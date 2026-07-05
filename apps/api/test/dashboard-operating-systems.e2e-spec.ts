import { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DashboardController } from '../src/dashboard/dashboard.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { PrismaService } from '../src/prisma/prisma.service';

type OperatingSystemSummary = {
  assets: {
    byOperatingSystem: Record<string, number>;
    byOperatingSystemVersion: Record<string, number>;
  };
};

describe('Dashboard operating system distributions (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const assets = [
      {
        attributes: [
          { key: 'OPERATINGSYSTEM', value: 'Windows 11 Pro', valueText: 'Windows 11 Pro' },
          { key: 'osVersion', value: '23H2', valueText: '23H2' },
        ],
      },
      {
        attributes: [
          { key: 'OS', value: 'Ubuntu Server', valueText: 'Ubuntu Server' },
          {
            key: 'operatingSystemVersion',
            value: '24.04',
            valueText: '24.04',
          },
        ],
      },
      { attributes: [] },
    ];
    const prismaMock = {
      asset: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(3),
        groupBy: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
        findMany: jest.fn<() => Promise<typeof assets>>().mockResolvedValue(assets),
      },
      conflict: { count: jest.fn<() => Promise<number>>().mockResolvedValue(0) },
      networkDiscoveryRun: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      },
      assetEvent: { findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]) },
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

  it('returns the operating system family distribution', async () => {
    const response = await request(httpServer).get('/dashboard/summary').expect(200);
    const body = response.body as OperatingSystemSummary;

    expect(body.assets.byOperatingSystem).toEqual({
      Windows: 1,
      Linux: 1,
      'Não identificado': 1,
    });
  });

  it('groups Windows and Linux aliases into friendly families', async () => {
    const response = await request(httpServer).get('/dashboard/summary').expect(200);
    const body = response.body as OperatingSystemSummary;

    expect(body.assets.byOperatingSystem.Windows).toBe(1);
    expect(body.assets.byOperatingSystem.Linux).toBe(1);
  });

  it('returns observed operating system versions', async () => {
    const response = await request(httpServer).get('/dashboard/summary').expect(200);
    const body = response.body as OperatingSystemSummary;

    expect(body.assets.byOperatingSystemVersion).toEqual({
      'Windows 11 Pro 23H2': 1,
      'Ubuntu Server 24.04': 1,
    });
  });
});
