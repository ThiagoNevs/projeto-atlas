import { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuditLogsController } from '../src/audit-logs/audit-logs.controller';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Audit logs with an empty database (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const prismaMock = {
      auditLog: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
        findUnique: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      },
      $transaction: jest
        .fn<(operations: Promise<unknown>[]) => Promise<unknown[]>>()
        .mockImplementation((operations) => Promise.all(operations)),
    };
    const testingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [AuditLogsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a safe paginated response without records', async () => {
    const response = await request(httpServer).get('/audit-logs').expect(200);

    expect(response.body).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
      summary: {
        total: 0,
        administrativeChanges: 0,
        conflictTreatments: 0,
        discoveryExecutions: 0,
        failuresOrRejections: 0,
      },
    });
  });
});
