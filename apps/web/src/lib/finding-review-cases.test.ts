import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFindingReviewDecision,
  createFindingReviewCase,
  getFindingReviewCase,
  getFindingReviewCases,
  updateFindingReviewCaseStatus,
} from './api.ts';
import { ApiError } from './api-error.ts';
import {
  createFindingReviewIdempotencyKey,
  getFindingReviewCaseStatusLabel,
  getAllowedFindingReviewCaseStatusDestinations,
  getFindingReviewEventLabel,
  getFindingReviewIdentityConclusionLabel,
  getFindingReviewStalenessLabel,
  isFindingReviewTimestamp,
  parseCreateFindingReviewCaseResponse,
  parseCreateFindingReviewDecisionResponse,
  parseFindingReviewCaseDetail,
  parseFindingReviewCaseListResponse,
  parseUpdateFindingReviewCaseStatusResponse,
  requiresFindingReviewCaseWaitingJustification,
  serializeFindingReviewCaseQuery,
} from './finding-review-cases.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CASE_ID = '55555555-5555-4555-8555-555555555555';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const DECISION_ID = '44444444-4444-4444-8444-444444444444';
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
  currentDecision: null,
  decisionHistory: [],
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
  assert.equal(getFindingReviewEventLabel('CASE_STATUS_CHANGED'), 'Status do caso alterado');
  assert.equal(getFindingReviewEventLabel('CASE_DECISION_RECORDED'), 'Decisão de identidade registrada');
  assert.equal(getFindingReviewIdentityConclusionLabel('SAME_ASSET'), 'Mesmo ativo');
  assert.equal(getFindingReviewIdentityConclusionLabel('DIFFERENT_ASSETS'), 'Ativos diferentes');
  assert.deepEqual(getAllowedFindingReviewCaseStatusDestinations('OPEN'), [
    'IN_REVIEW',
    'WAITING_FOR_EVIDENCE',
  ]);
  assert.deepEqual(getAllowedFindingReviewCaseStatusDestinations('RESOLVED'), []);
});

test('parser sanitiza decisão atual e histórico sem propagar fingerprint', () => {
  const first = {
    id: DECISION_ID,
    caseId: CASE_ID,
    identityConclusion: 'SAME_ASSET',
    justification: 'Mesma identidade confirmada.',
    caseVersion: 2,
    createdBy: 'atlas-mvp-user',
    createdAt: NOW,
    requestFingerprint: 'não expor',
  };
  const second = {
    ...first,
    id: '55555555-5555-4555-8555-555555555555',
    identityConclusion: 'DIFFERENT_ASSETS',
    justification: 'Revisão histórica futura.',
    caseVersion: 3,
    createdAt: '2026-07-20T13:00:00.000Z',
  };
  const parsed = parseFindingReviewCaseDetail({
    ...detailResponse,
    currentDecision: second,
    decisionHistory: [first, second],
  });
  assert.equal(parsed?.currentDecision?.identityConclusion, 'DIFFERENT_ASSETS');
  assert.equal(parsed?.decisionHistory.length, 2);
  assert.equal('requestFingerprint' in (parsed?.decisionHistory[0] as unknown as object), false);
});

test('parser rejeita decisões inválidas e inconsistência entre current e history', () => {
  const decision = {
    id: DECISION_ID,
    caseId: CASE_ID,
    identityConclusion: 'SAME_ASSET',
    justification: 'Confirmada.',
    caseVersion: 2,
    createdBy: 'atlas-mvp-user',
    createdAt: NOW,
  };
  for (const invalid of [
    { ...decision, id: 'invalid' },
    { ...decision, createdAt: '2026-02-30T10:00:00Z' },
    { ...decision, caseVersion: 0 },
    { ...decision, identityConclusion: 'UNKNOWN' },
  ]) {
    assert.equal(parseFindingReviewCaseDetail({
      ...detailResponse,
      currentDecision: invalid,
      decisionHistory: [invalid],
    }), null);
  }
  assert.equal(parseFindingReviewCaseDetail({
    ...detailResponse,
    currentDecision: decision,
    decisionHistory: [],
  }), null);
  assert.equal(parseFindingReviewCaseDetail({
    ...detailResponse,
    currentDecision: { ...decision, caseId: SECOND_CASE_ID },
    decisionHistory: [{ ...decision, caseId: SECOND_CASE_ID }],
  }), null);
});

test('parser de criação de decisão aceita 201/200 e descarta campos externos', () => {
  const decision = {
    id: DECISION_ID,
    caseId: CASE_ID,
    identityConclusion: 'SAME_ASSET',
    justification: 'Confirmada.',
    caseVersion: 2,
    createdBy: 'atlas-mvp-user',
    createdAt: NOW,
    requestFingerprint: 'não expor',
  };
  const parsed = parseCreateFindingReviewDecisionResponse({ decision, idempotentReplay: false });
  assert.equal(parsed?.decision.identityConclusion, 'SAME_ASSET');
  assert.equal('requestFingerprint' in (parsed?.decision as unknown as object), false);
});

test('parser da transição aceita apenas resposta mínima estruturalmente válida', () => {
  const response = { id: CASE_ID, status: 'IN_REVIEW', version: 2, updatedAt: NOW };
  assert.deepEqual(parseUpdateFindingReviewCaseStatusResponse(response), response);
  assert.equal(parseUpdateFindingReviewCaseStatusResponse({ ...response, status: 'RESOLVED' }), null);
  assert.equal(parseUpdateFindingReviewCaseStatusResponse({ ...response, version: 0 }), null);
  assert.equal(parseUpdateFindingReviewCaseStatusResponse({ ...response, updatedAt: '2026-02-30T12:00:00Z' }), null);
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

test('transição usa PATCH, expectedVersion e não envia Idempotency-Key', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchImplementation = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return Response.json({ id: CASE_ID, status: 'IN_REVIEW', version: 2, updatedAt: NOW });
  };
  const updated = await updateFindingReviewCaseStatus(CASE_ID, 'IN_REVIEW', 1, undefined, {
    fetchImplementation,
  });
  assert.equal(updated.version, 2);
  assert.equal(calls[0]?.init.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    status: 'IN_REVIEW',
    expectedVersion: 1,
  });
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], undefined);
  assert.match(calls[0]?.input ?? '', new RegExp(`${CASE_ID}/status$`));
});

test('identifica somente transições que entram ou saem da espera por evidências', () => {
  assert.equal(requiresFindingReviewCaseWaitingJustification('OPEN', 'WAITING_FOR_EVIDENCE'), true);
  assert.equal(requiresFindingReviewCaseWaitingJustification('IN_REVIEW', 'WAITING_FOR_EVIDENCE'), true);
  assert.equal(requiresFindingReviewCaseWaitingJustification('WAITING_FOR_EVIDENCE', 'OPEN'), true);
  assert.equal(requiresFindingReviewCaseWaitingJustification('WAITING_FOR_EVIDENCE', 'IN_REVIEW'), true);
  assert.equal(requiresFindingReviewCaseWaitingJustification('OPEN', 'IN_REVIEW'), false);
  assert.equal(requiresFindingReviewCaseWaitingJustification('IN_REVIEW', 'OPEN'), false);
});

test('transição de espera envia justification normalizada no payload técnico', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchImplementation = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return Response.json({
      id: CASE_ID,
      status: 'WAITING_FOR_EVIDENCE',
      version: 2,
      updatedAt: NOW,
    });
  };
  await updateFindingReviewCaseStatus(
    CASE_ID,
    'WAITING_FOR_EVIDENCE',
    1,
    '  Falta  confirmação\ntécnica.  ',
    { fetchImplementation },
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    status: 'WAITING_FOR_EVIDENCE',
    expectedVersion: 1,
    justification: 'Falta  confirmação\ntécnica.',
  });
});

test('transição rejeita resposta runtime inválida e preserva erros HTTP controlados', async () => {
  await assert.rejects(
    updateFindingReviewCaseStatus(CASE_ID, 'IN_REVIEW', 1, undefined, {
      fetchImplementation: async () => Response.json({ id: CASE_ID, status: 'IN_REVIEW', version: 1 }),
    }),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
  await assert.rejects(
    updateFindingReviewCaseStatus(CASE_ID, 'IN_REVIEW', 1, undefined, {
      fetchImplementation: async () => Response.json({ message: 'Versão obsoleta.' }, { status: 409 }),
    }),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
});

test('cliente de decisão envia contrato técnico, chave opaca e interpreta replay', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchImplementation = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return Response.json({
      decision: {
        id: DECISION_ID,
        caseId: CASE_ID,
        identityConclusion: 'SAME_ASSET',
        justification: 'Mesma  identidade.\nConfirmada.',
        caseVersion: 2,
        createdBy: 'atlas-mvp-user',
        createdAt: NOW,
      },
      idempotentReplay: true,
    }, { status: 200 });
  };
  const result = await createFindingReviewDecision(
    CASE_ID,
    'SAME_ASSET',
    '  Mesma  identidade.\nConfirmada.  ',
    1,
    'atlas-ui-decision-key',
    { fetchImplementation },
  );
  assert.equal(result.idempotentReplay, true);
  assert.equal(calls[0]?.init.method, 'POST');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key'], 'atlas-ui-decision-key');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    identityConclusion: 'SAME_ASSET',
    justification: 'Mesma  identidade.\nConfirmada.',
    expectedVersion: 1,
  });
  assert.match(calls[0]?.input ?? '', new RegExp(`${CASE_ID}/decisions$`));
});
