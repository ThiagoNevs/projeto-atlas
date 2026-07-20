import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFindingReviewCase,
  getFindingReviewCase,
  getFindingReviewCases,
} from './api.ts';
import { ApiError } from './api-error.ts';
import {
  createFindingReviewIdempotencyKey,
  getFindingReviewCaseStatusLabel,
  getFindingReviewEventLabel,
  getFindingReviewStalenessLabel,
  isFindingReviewTimestamp,
  parseCreateFindingReviewCaseResponse,
  parseFindingReviewCaseDetail,
  parseFindingReviewCaseListResponse,
  serializeFindingReviewCaseQuery,
} from './finding-review-cases.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const FINDING_ID = 'finding_0123456789abcdef01234567';
const NOW = '2026-07-20T12:00:00.000Z';

const listItem = {
  id: CASE_ID,
  findingId: FINDING_ID,
  findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  policyVersion: '2026-07-v1',
  status: 'OPEN',
  staleness: 'CURRENT',
  version: 1,
  createdBy: 'atlas-mvp-user',
  createdAt: NOW,
  updatedAt: NOW,
  assetCount: 1,
  eventCount: 1,
};

const listResponse = {
  items: [listItem],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

const detailResponse = {
  ...listItem,
  assetCount: undefined,
  eventCount: undefined,
  originalSnapshot: { findingId: FINDING_ID },
  originalSnapshotHash: 'a'.repeat(64),
  assets: [{
    assetIdAtCreation: ASSET_ID,
    assetNameAtCreation: 'SRV-APP-01',
    role: 'AFFECTED',
    currentAssetId: ASSET_ID,
    currentAssetName: 'SRV-APP-01',
    currentAssetAvailable: true,
  }],
  events: [{
    id: EVENT_ID,
    eventType: 'CASE_CREATED',
    versionBefore: null,
    versionAfter: 1,
    actor: 'atlas-mvp-user',
    metadata: { findingId: FINDING_ID },
    createdAt: NOW,
  }],
};

const createResponse = {
  id: CASE_ID,
  findingId: FINDING_ID,
  findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  policyVersion: '2026-07-v1',
  reviewSubjectKey: 'subject',
  status: 'OPEN',
  staleness: 'CURRENT',
  version: 1,
  affectedAssets: [{ assetId: ASSET_ID, assetName: 'SRV-APP-01', role: 'AFFECTED' }],
  createdBy: 'atlas-mvp-user',
  findingGeneratedAt: NOW,
  createdAt: NOW,
  idempotentReplay: false,
};

test('traduz status, atualidade e eventos sem exibir enums técnicos', () => {
  assert.equal(getFindingReviewCaseStatusLabel('IN_REVIEW'), 'Em análise');
  assert.equal(getFindingReviewStalenessLabel('NO_LONGER_DETECTED'), 'Não detectado atualmente');
  assert.equal(getFindingReviewEventLabel('CASE_CREATED'), 'Caso criado');
});

test('serializa filtros e paginação com os nomes do contrato da API', () => {
  const query = serializeFindingReviewCaseQuery({
    status: 'OPEN',
    staleness: 'CURRENT',
    findingId: 'finding_0123456789abcdef01234567',
    page: 2,
    pageSize: 10,
    sortBy: 'updatedAt',
    sortDirection: 'asc',
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get('status'), 'OPEN');
  assert.equal(params.get('staleness'), 'CURRENT');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('sortBy'), 'updatedAt');
});

test('serialização usa whitelist e inclui os filtros completos do contrato', () => {
  const query = serializeFindingReviewCaseQuery({
    assetId: ASSET_ID,
    createdFrom: '2026-07-19T00:00:00.000Z',
    createdTo: NOW,
    page: 1,
    pageSize: 25,
    sortBy: 'createdAt',
    sortDirection: 'desc',
    ...({ unexpected: 'secret' } as object),
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get('assetId'), ASSET_ID);
  assert.equal(params.get('createdFrom'), '2026-07-19T00:00:00.000Z');
  assert.equal(params.get('createdTo'), NOW);
  assert.equal(params.has('unexpected'), false);
});

test('gera chave idempotente ASCII e preserva o UUID opaco', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const key = createFindingReviewIdempotencyKey(() => uuid);
  assert.equal(key, `atlas-ui-${uuid}`);
  assert.match(key, /^[A-Za-z0-9._~:+/=-]{1,128}$/);
});

test('valida timestamps completos com timezone e rejeita datas ambíguas', () => {
  assert.equal(isFindingReviewTimestamp(NOW), true);
  assert.equal(isFindingReviewTimestamp('2026-07-20T09:00:00-03:00'), true);
  assert.equal(isFindingReviewTimestamp('2026-07-20'), false);
  assert.equal(isFindingReviewTimestamp('2026-02-30T12:00:00Z'), false);
  assert.equal(isFindingReviewTimestamp('2026-07-20T12:00:00'), false);
});

test('parsers aceitam e sanitizam lista, detalhe e criação válidos', () => {
  const parsedList = parseFindingReviewCaseListResponse({ ...listResponse, raw: 'não expor' });
  const parsedDetail = parseFindingReviewCaseDetail({ ...detailResponse, creationRequestFingerprint: 'não expor' });
  const parsedCreate = parseCreateFindingReviewCaseResponse({ ...createResponse, secret: 'não expor' });
  assert.equal(parsedList?.items[0]?.id, CASE_ID);
  assert.equal('raw' in (parsedList as unknown as Record<string, unknown>), false);
  assert.equal(parsedDetail?.assets[0]?.currentAssetId, ASSET_ID);
  assert.equal('creationRequestFingerprint' in (parsedDetail as unknown as Record<string, unknown>), false);
  assert.equal(parsedCreate?.idempotentReplay, false);
  assert.equal('secret' in (parsedCreate as unknown as Record<string, unknown>), false);
});

test('parsers rejeitam enum, UUID, paginação e datas incompatíveis', () => {
  assert.equal(parseFindingReviewCaseListResponse({
    ...listResponse,
    items: [{ ...listItem, status: 'UNKNOWN_STATUS' }],
  }), null);
  assert.equal(parseFindingReviewCaseListResponse({
    ...listResponse,
    pagination: { ...listResponse.pagination, totalPages: 2 },
  }), null);
  assert.equal(parseFindingReviewCaseDetail({
    ...detailResponse,
    assets: [{ ...detailResponse.assets[0], currentAssetId: 'not-a-uuid' }],
  }), null);
  assert.equal(parseCreateFindingReviewCaseResponse({
    ...createResponse,
    createdAt: '2026-07-20',
  }), null);
});

test('clientes GET aplicam parser, codificam o ID e encaminham AbortSignal', async () => {
  const controller = new AbortController();
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchImplementation = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return Response.json(input.includes(`/${CASE_ID}`) ? detailResponse : listResponse);
  };
  const list = await getFindingReviewCases(
    { status: 'OPEN' },
    { signal: controller.signal, fetchImplementation },
  );
  const detail = await getFindingReviewCase(
    CASE_ID,
    { signal: controller.signal, fetchImplementation },
  );
  assert.equal(list.items[0]?.status, 'OPEN');
  assert.equal(detail.id, CASE_ID);
  assert.match(calls[0]?.input ?? '', /status=OPEN/);
  assert.match(calls[1]?.input ?? '', new RegExp(CASE_ID));
  assert.ok(calls.every((call) => call.init.signal instanceof AbortSignal));
});

test('cliente rejeita resposta runtime inválida com erro controlado', async () => {
  await assert.rejects(
    getFindingReviewCases({}, { fetchImplementation: async () => Response.json({ items: 'invalid' }) }),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});

test('criação usa timeout, cancela a requisição e informa resultado incerto', async () => {
  let scheduled: (() => void) | undefined;
  let requestSignal: AbortSignal | undefined;
  const pendingFetch = async (_input: string, init: RequestInit): Promise<Response> => {
    requestSignal = init.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const request = createFindingReviewCase(FINDING_ID, 'atlas-ui-key', {
    fetchImplementation: pendingFetch,
    scheduleTimeout: (callback) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancelTimeout: () => undefined,
  });
  scheduled?.();
  await assert.rejects(
    request,
    (error: unknown) => error instanceof ApiError
      && error.status === 408
      && /resultado pode ser incerto/i.test(error.message),
  );
  assert.equal(requestSignal?.aborted, true);
});

test('criação diferencia 201 e replay 200 sem alterar o contrato enviado', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchImplementation = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return Response.json({ ...createResponse, idempotentReplay: calls.length === 2 }, {
      status: calls.length === 2 ? 200 : 201,
    });
  };
  const created = await createFindingReviewCase(FINDING_ID, 'atlas-ui-key', { fetchImplementation });
  const replayed = await createFindingReviewCase(FINDING_ID, 'atlas-ui-key', { fetchImplementation });
  assert.equal(created.idempotentReplay, false);
  assert.equal(replayed.idempotentReplay, true);
  assert.equal((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key'], 'atlas-ui-key');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { findingId: FINDING_ID });
});
