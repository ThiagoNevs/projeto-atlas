import { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DataSourcesResponse } from '../src/data-sources/data-sources.service';
import { DataSourcesModule } from '../src/data-sources/data-sources.module';

describe('Data sources catalog (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [DataSourcesModule],
    }).compile();

    app = testingModule.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the internal catalog', async () => {
    const response = await request(httpServer).get('/data-sources').expect(200);
    const body = response.body as DataSourcesResponse;

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manual-declaration',
          name: 'Cadastro manual',
          status: 'AVAILABLE',
          current: true,
        }),
        expect.objectContaining({
          id: 'csv-import',
          status: 'AVAILABLE',
          current: true,
          evidenceType: 'CSV_MANUAL_IMPORT',
        }),
        expect.objectContaining({
          id: 'microsoft-intune',
          status: 'PLANNED',
          current: false,
        }),
        expect.objectContaining({
          id: 'cloud-providers',
          status: 'FUTURE',
          current: false,
        }),
      ]),
    );
  });

  it('returns the correct summary', async () => {
    const response = await request(httpServer).get('/data-sources').expect(200);
    const body = response.body as DataSourcesResponse;

    expect(body.summary).toEqual({
      available: 4,
      planned: 3,
      future: 3,
      total: 10,
    });
  });

  it('counts available, planned and future sources from the catalog', async () => {
    const response = await request(httpServer).get('/data-sources').expect(200);
    const body = response.body as DataSourcesResponse;

    expect(body.items.filter((item) => item.status === 'AVAILABLE')).toHaveLength(
      body.summary.available,
    );
    expect(body.items.filter((item) => item.status === 'PLANNED')).toHaveLength(
      body.summary.planned,
    );
    expect(body.items.filter((item) => item.status === 'FUTURE')).toHaveLength(body.summary.future);
  });

  it('does not depend on database providers', async () => {
    const response = await request(httpServer).get('/data-sources').expect(200);
    const body = response.body as DataSourcesResponse;

    expect(body.items).toHaveLength(10);
  });
});
