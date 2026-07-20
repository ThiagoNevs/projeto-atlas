import assert from 'node:assert/strict';
import test from 'node:test';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { FindingReviewCasesPage } from './finding-review-cases-page.tsx';
import { ApiError } from '../lib/api-error.ts';
import type {
  CreateFindingReviewCaseResponse,
  FindingReviewCaseDetail,
  FindingReviewCaseListResponse,
} from '../lib/api.ts';
import { createJsdomTestEnvironment } from '../test/jsdom-test-environment.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const FINDING_ID = 'finding_0123456789abcdef01234567';

const listResponse: FindingReviewCaseListResponse = {
  items: [{
    id: CASE_ID,
    findingId: FINDING_ID,
    findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    policyVersion: '2026-07-v1',
    status: 'OPEN',
    staleness: 'CURRENT',
    version: 1,
    createdBy: 'atlas-mvp-user',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    assetCount: 1,
    eventCount: 1,
  }],
  pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};

const detailResponse: FindingReviewCaseDetail = {
  ...listResponse.items[0]!,
  originalSnapshot: { findingId: FINDING_ID, normalizedHostname: 'srv-app-01' },
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
    id: '33333333-3333-4333-8333-333333333333',
    eventType: 'CASE_CREATED',
    versionBefore: null,
    versionAfter: 1,
    actor: 'atlas-mvp-user',
    metadata: { findingId: FINDING_ID },
    createdAt: '2026-07-20T12:00:00.000Z',
  }],
};

const creationResponse: CreateFindingReviewCaseResponse = {
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
  findingGeneratedAt: '2026-07-20T11:59:00.000Z',
  createdAt: '2026-07-20T12:00:00.000Z',
  idempotentReplay: false,
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderPage(props: Parameters<typeof FindingReviewCasesPage>[0]) {
  const environment = createJsdomTestEnvironment();
  const root: Root = createRoot(environment.container);
  await act(async () => {
    root.render(createElement(FindingReviewCasesPage, props));
    await flush();
  });
  return { environment, root };
}

async function close(root: Root, cleanup: () => void): Promise<void> {
  await act(async () => root.unmount());
  cleanup();
}

test('lista casos e abre detalhe com snapshot, ativo atual e evento', async () => {
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
  });
  try {
    assert.match(harness.environment.container.textContent ?? '', /Casos de revisão/);
    const button = [...harness.environment.container.querySelectorAll('button')]
      .find((entry) => entry.textContent === 'Ver detalhe');
    assert.ok(button);
    await act(async () => { (button as HTMLButtonElement).click(); await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /Visualizar snapshot histórico/);
    assert.match(text, /Ver vínculo atual: SRV-APP-01/);
    assert.match(text, /Caso criado/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('cria caso com chave idempotente e apresenta sucesso', async () => {
  let receivedFinding = '';
  let receivedKey = '';
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async (findingId, key) => {
      receivedFinding = findingId;
      receivedKey = key;
      return creationResponse;
    },
  });
  try {
    const button = [...harness.environment.container.querySelectorAll('button')]
      .find((entry) => entry.textContent === 'Criar caso');
    assert.ok(button);
    await act(async () => { (button as HTMLButtonElement).click(); await flush(); });
    assert.equal(receivedFinding, FINDING_ID);
    assert.match(receivedKey, /^atlas-ui-/);
    assert.match(harness.environment.container.textContent ?? '', /Caso criado com sucesso/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('oferece acesso ao caso existente no conflito 409', async () => {
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async () => { throw new ApiError('Conflito', 409, 'ACTIVE_REVIEW_CASE_EXISTS', CASE_ID); },
  });
  try {
    const button = [...harness.environment.container.querySelectorAll('button')]
      .find((entry) => entry.textContent === 'Criar caso');
    await act(async () => { (button as HTMLButtonElement).click(); await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /Já existe um caso ativo/);
    assert.match(text, /Abrir caso existente/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('explica indisponibilidade 503 sem afirmar criação', async () => {
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async () => { throw new ApiError('Disabled', 503); },
  });
  try {
    const button = [...harness.environment.container.querySelectorAll('button')]
      .find((entry) => entry.textContent === 'Criar caso');
    await act(async () => { (button as HTMLButtonElement).click(); await flush(); });
    assert.match(harness.environment.container.textContent ?? '', /desabilitada neste ambiente/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('aplica filtro por status e pagina mantendo o contrato da API', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const paged = {
    ...listResponse,
    pagination: { page: 1, pageSize: 25, totalItems: 30, totalPages: 2 },
  };
  const harness = await renderPage({
    loadCases: async (query) => {
      calls.push({ ...query });
      return query.page === 2
        ? { ...paged, pagination: { ...paged.pagination, page: 2 } }
        : paged;
    },
  });
  try {
    const status = harness.environment.container.querySelector('select');
    const form = harness.environment.container.querySelector('form');
    assert.ok(status && form);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(status), 'value')?.set;
      setter?.call(status, 'OPEN');
      status.dispatchEvent(new Event('change', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    assert.equal(calls.at(-1)?.status, 'OPEN');
    const next = [...harness.environment.container.querySelectorAll('button')]
      .find((entry) => entry.textContent === 'Próxima');
    assert.ok(next);
    await act(async () => { (next as HTMLButtonElement).click(); await flush(); });
    assert.equal(calls.at(-1)?.page, 2);
    assert.equal(calls.at(-1)?.status, 'OPEN');
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});
