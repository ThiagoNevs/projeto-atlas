import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Server } from 'node:http';
import request from 'supertest';

import { AssetsController } from '../src/assets/assets.controller';
import { AssetsService } from '../src/assets/assets.service';
import { AuthModule } from '../src/auth/auth.module';
import {
  startTestAuthHarness,
  TEST_AUTH_ACCESS_VALUE,
  TEST_AUTH_ADMIN_ROLE,
  TEST_AUTH_ANALYST_ROLE,
  TEST_AUTH_VIEWER_ROLE,
  type TestAuthHarness,
} from './auth-test-harness';

describe('granular authorization before domain writes', () => {
  let app: INestApplication;
  let auth: TestAuthHarness;
  const calls = { reads: 0, creates: 0, statuses: 0, imports: 0 };
  const assets = {
    findAll: () => {
      calls.reads += 1;
      return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    },
    createManual: () => {
      calls.creates += 1;
      return { id: 'created' };
    },
    updateAdministrativeStatus: () => {
      calls.statuses += 1;
      return { id: 'updated' };
    },
    previewCsv: () => {
      calls.imports += 1;
      return { rows: [] };
    },
  };

  beforeAll(async () => {
    auth = await startTestAuthHarness();
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AssetsController],
      providers: [{ provide: AssetsService, useValue: assets }],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (auth) await auth.close();
  });

  async function token(role: string): Promise<string> {
    return auth.issueToken({ roles: [TEST_AUTH_ACCESS_VALUE, role] });
  }

  it('allows Viewer reads and rejects a representative mutation before the service executes', async () => {
    const viewer = await token(TEST_AUTH_VIEWER_ROLE);
    await request(serverOf(app))
      .get('/assets')
      .set('Authorization', `Bearer ${viewer}`)
      .expect(200);
    const before = { ...calls };
    const response = await request(serverOf(app))
      .post('/assets/manual')
      .set('Authorization', `Bearer ${viewer}`)
      .send({})
      .expect(403);
    expect(response.body).toEqual(expect.objectContaining({ code: 'INSUFFICIENT_PERMISSION' }));
    expect(calls).toEqual(before);
  });

  it('allows Analyst manual maintenance but blocks administrative status and import', async () => {
    const analyst = await token(TEST_AUTH_ANALYST_ROLE);
    const createsBefore = calls.creates;
    await request(serverOf(app))
      .post('/assets/manual')
      .set('Authorization', `Bearer ${analyst}`)
      .send({})
      .expect(201);
    expect(calls.creates).toBe(createsBefore + 1);

    const before = { ...calls };
    await request(serverOf(app))
      .patch('/assets/11111111-1111-4111-8111-111111111111/administrative-status')
      .set('Authorization', `Bearer ${analyst}`)
      .send({})
      .expect(403);
    await request(serverOf(app))
      .post('/assets/import/preview')
      .set('Authorization', `Bearer ${analyst}`)
      .send({})
      .expect(403);
    expect(calls).toEqual(before);
  });

  it('allows Admin-only representative operations through the same guards', async () => {
    const admin = await token(TEST_AUTH_ADMIN_ROLE);
    await request(serverOf(app))
      .patch('/assets/11111111-1111-4111-8111-111111111111/administrative-status')
      .set('Authorization', `Bearer ${admin}`)
      .send({})
      .expect(200);
    await request(serverOf(app))
      .post('/assets/import/preview')
      .set('Authorization', `Bearer ${admin}`)
      .send({})
      .expect(201);
    expect(calls.statuses).toBe(1);
    expect(calls.imports).toBe(1);
  });
});

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}
