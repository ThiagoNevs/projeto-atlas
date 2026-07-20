import assert from 'node:assert/strict';
import test from 'node:test';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  FindingReviewCasesPage,
  buildFindingReviewCaseQueryFromForm,
} from './finding-review-cases-page.tsx';
import { ApiError } from '../lib/api-error.ts';
import type {
  CreateFindingReviewCaseResponse,
  FindingReviewCaseDetail,
  FindingReviewCaseListResponse,
} from '../lib/api.ts';
import { createJsdomTestEnvironment } from '../test/jsdom-test-environment.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CASE_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const FINDING_ID = 'finding_0123456789abcdef01234567';
const SECOND_FINDING_ID = 'finding_89abcdef0123456789abcdef';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event(control.tagName === 'INPUT' ? 'input' : 'change', {
    bubbles: true,
  }));
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((entry) => entry.textContent?.trim() === text);
  assert.ok(button);
  return button;
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

test('resposta antiga da lista é abortada e não substitui a consulta nova', async () => {
  const first = deferred<FindingReviewCaseListResponse>();
  const second = deferred<FindingReviewCaseListResponse>();
  const signals: AbortSignal[] = [];
  let calls = 0;
  const secondResponse: FindingReviewCaseListResponse = {
    items: [{ ...listResponse.items[0]!, id: SECOND_CASE_ID, findingId: SECOND_FINDING_ID }],
    pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  };
  const harness = await renderPage({
    loadCases: async (_query, options) => {
      signals.push(options?.signal as AbortSignal);
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    },
  });
  try {
    const status = harness.environment.container.querySelector('select');
    const form = harness.environment.container.querySelector('form');
    assert.ok(status && form);
    await act(async () => {
      setControlValue(status, 'OPEN');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    assert.equal(signals[0]?.aborted, true);
    await act(async () => { second.resolve(secondResponse); await flush(); });
    await act(async () => { first.resolve(listResponse); await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, new RegExp(SECOND_CASE_ID.slice(0, 8)));
    assert.doesNotMatch(text, new RegExp(CASE_ID.slice(0, 8)));
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('unmount aborta a listagem e ignora resolução posterior', async () => {
  const request = deferred<FindingReviewCaseListResponse>();
  let signal: AbortSignal | undefined;
  const harness = await renderPage({
    loadCases: async (_query, options) => {
      signal = options?.signal;
      return request.promise;
    },
  });
  await act(async () => harness.root.unmount());
  assert.equal(signal?.aborted, true);
  await act(async () => { request.resolve(listResponse); await flush(); });
  harness.environment.cleanup();
});

test('troca rápida de detalhes aborta A e nunca apresenta seus dados em B', async () => {
  const detailA = deferred<FindingReviewCaseDetail>();
  const detailB = deferred<FindingReviewCaseDetail>();
  const signals = new Map<string, AbortSignal>();
  const responseWithTwoCases: FindingReviewCaseListResponse = {
    items: [
      listResponse.items[0]!,
      { ...listResponse.items[0]!, id: SECOND_CASE_ID, findingId: SECOND_FINDING_ID },
    ],
    pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
  };
  const harness = await renderPage({
    loadCases: async () => responseWithTwoCases,
    loadDetail: async (id, options) => {
      signals.set(id, options?.signal as AbortSignal);
      return id === CASE_ID ? detailA.promise : detailB.promise;
    },
  });
  try {
    const triggers = [...harness.environment.container.querySelectorAll<HTMLButtonElement>(
      `button[aria-controls="finding-review-case-detail"]`,
    )];
    assert.equal(triggers.length, 2);
    await act(async () => { triggers[0]?.click(); await flush(); });
    await act(async () => { triggers[1]?.click(); await flush(); });
    assert.equal(signals.get(CASE_ID)?.aborted, true);
    const secondDetail = {
      ...detailResponse,
      id: SECOND_CASE_ID,
      findingId: SECOND_FINDING_ID,
      originalSnapshot: { findingId: SECOND_FINDING_ID, normalizedHostname: 'srv-second-01' },
      assets: [{
        ...detailResponse.assets[0]!,
        assetNameAtCreation: 'SRV-SECOND-01',
        currentAssetName: 'SRV-SECOND-01',
      }],
    };
    await act(async () => { detailB.resolve(secondDetail); await flush(); });
    await act(async () => { detailA.resolve(detailResponse); await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /SRV-SECOND-01/);
    assert.doesNotMatch(text, /SRV-APP-01/);
    assert.match(harness.environment.window.location.search, new RegExp(`caseId=${SECOND_CASE_ID}`));
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('deep link acompanha abertura e fechamento e restaura foco ao acionador', async () => {
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
  });
  try {
    const trigger = findButton(harness.environment.container, 'Ver detalhe');
    trigger.focus();
    await act(async () => { trigger.click(); await flush(); });
    assert.equal(trigger.getAttribute('aria-controls'), 'finding-review-case-detail');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.match(harness.environment.window.location.search, new RegExp(`caseId=${CASE_ID}`));
    const panel = harness.environment.container.querySelector<HTMLElement>('#finding-review-case-detail');
    assert.ok(panel);
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    assert.equal(harness.environment.window.document.activeElement, panel);
    const closeButton = findButton(harness.environment.container, 'Fechar detalhe');
    await act(async () => { closeButton.click(); await flush(); });
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    assert.equal(harness.environment.window.location.search.includes('caseId='), false);
    assert.equal(document.activeElement, trigger);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('popstate restaura filtros, paginação, ordenação e caso sem criar loop', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let detailCalls = 0;
  const harness = await renderPage({
    loadCases: async (query) => {
      calls.push({ ...query });
      return listResponse;
    },
    loadDetail: async () => {
      detailCalls += 1;
      return detailResponse;
    },
  });
  try {
    const createdFrom = '2026-07-19T12:00:00.000Z';
    const createdTo = '2026-07-20T12:00:00.000Z';
    const url = `/conflict-review-cases?status=IN_REVIEW&assetId=${ASSET_ID}`
      + `&createdFrom=${encodeURIComponent(createdFrom)}&createdTo=${encodeURIComponent(createdTo)}`
      + `&page=2&pageSize=10&sortBy=updatedAt&sortDirection=asc&caseId=${CASE_ID}`;
    harness.environment.window.history.pushState(null, '', url);
    const historyLength = harness.environment.window.history.length;
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.PopStateEvent('popstate'));
      await flush();
    });
    const status = harness.environment.container.querySelector('select');
    assert.equal((status as HTMLSelectElement).value, 'IN_REVIEW');
    assert.equal(calls.at(-1)?.page, 2);
    assert.equal(calls.at(-1)?.pageSize, 10);
    assert.equal(calls.at(-1)?.sortBy, 'updatedAt');
    assert.equal(calls.at(-1)?.sortDirection, 'asc');
    assert.equal(calls.at(-1)?.assetId, ASSET_ID);
    assert.equal(calls.at(-1)?.createdFrom, createdFrom);
    assert.equal(calls.at(-1)?.createdTo, createdTo);
    const assetInput = harness.environment.container.querySelector<HTMLInputElement>(
      'input[placeholder="UUID do ativo"]',
    );
    assert.equal(assetInput?.value, ASSET_ID);
    assert.equal(detailCalls, 1);
    assert.equal(harness.environment.window.history.length, historyLength);

    harness.environment.window.history.pushState(null, '', '/conflict-review-cases?status=INVALID&page=01&caseId=invalid');
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.PopStateEvent('popstate'));
      await flush();
    });
    assert.equal((status as HTMLSelectElement).value, '');
    assert.equal(calls.at(-1)?.page, 1);
    assert.equal(harness.environment.container.querySelector('#finding-review-case-detail'), null);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('exibe assetId e datas e converte o formulário em timestamps ISO com timezone', async () => {
  const harness = await renderPage({
    loadCases: async () => listResponse,
  });
  try {
    const inputs = [...harness.environment.container.querySelectorAll<HTMLInputElement>('input')];
    const asset = inputs.find((input) => input.placeholder === 'UUID do ativo');
    const dateInputs = inputs.filter((input) => input.type === 'datetime-local');
    assert.ok(asset && dateInputs.length === 2);
    const parsed = buildFindingReviewCaseQueryFromForm({
      status: '', staleness: '', findingType: '', findingId: '', createdBy: '',
      assetId: ASSET_ID,
      createdFrom: '2026-07-19T09:00:00',
      createdTo: '2026-07-20T09:00:00',
      sortBy: 'createdAt', sortDirection: 'desc', pageSize: '25',
    });
    assert.equal(parsed.error, null);
    assert.equal(parsed.query?.assetId, ASSET_ID);
    assert.match(String(parsed.query?.createdFrom), /^2026-07-19T\d{2}:00:00\.000Z$/);
    assert.match(String(parsed.query?.createdTo), /^2026-07-20T\d{2}:00:00\.000Z$/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('rejeita intervalo invertido antes de formar a consulta', () => {
  const parsed = buildFindingReviewCaseQueryFromForm({
    status: '', staleness: '', findingType: '', findingId: '', createdBy: '', assetId: '',
    createdFrom: '2026-07-21T09:00:00',
    createdTo: '2026-07-20T09:00:00',
    sortBy: 'createdAt', sortDirection: 'desc', pageSize: '25',
  });
  assert.equal(parsed.query, null);
  assert.match(parsed.error ?? '', /data inicial não pode ser posterior/);
});

test('clique duplo dispara um único POST', async () => {
  const pending = deferred<CreateFindingReviewCaseResponse>();
  let calls = 0;
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async () => {
      calls += 1;
      return pending.promise;
    },
  });
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); button.click(); await flush(); });
    assert.equal(calls, 1);
    await act(async () => { pending.resolve(creationResponse); await flush(); });
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('unmount cancela a criação pendente sem atualizar a interface', async () => {
  const pending = deferred<CreateFindingReviewCaseResponse>();
  let signal: AbortSignal | undefined;
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, _key, options) => {
      signal = options?.signal;
      return pending.promise;
    },
  });
  const button = findButton(harness.environment.container, 'Criar caso');
  await act(async () => { button.click(); await flush(); });
  await act(async () => harness.root.unmount());
  assert.equal(signal?.aborted, true);
  await act(async () => { pending.resolve(creationResponse); await flush(); });
  harness.environment.cleanup();
});

test('navegação pelo histórico cancela criação pendente e ignora sua resposta tardia', async () => {
  const pending = deferred<CreateFindingReviewCaseResponse>();
  let signal: AbortSignal | undefined;
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async (_findingId, _key, options) => {
      signal = options?.signal;
      return pending.promise;
    },
  });
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    harness.environment.window.history.pushState(null, '', '/conflict-review-cases');
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.PopStateEvent('popstate'));
      await flush();
    });
    assert.equal(signal?.aborted, true);
    await act(async () => { pending.resolve(creationResponse); await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.doesNotMatch(text, /Caso criado com sucesso/);
    assert.equal(harness.environment.container.querySelector('#finding-review-case-detail'), null);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resultado incerto preserva a chave entre remontagem e replay', async () => {
  const environment = createJsdomTestEnvironment();
  const keys: string[] = [];
  const firstContainer = environment.container;
  const firstRoot = createRoot(firstContainer);
  await act(async () => {
    firstRoot.render(createElement(FindingReviewCasesPage, {
      initialSearchParams: { create: '1', findingId: FINDING_ID },
      loadCases: async () => listResponse,
      createCase: async (_findingId: string, key: string) => {
        keys.push(key);
        throw new ApiError('Falha de rede', 0);
      },
    }));
    await flush();
  });
  const firstButton = findButton(firstContainer, 'Criar caso');
  await act(async () => { firstButton.click(); await flush(); });
  assert.match(firstContainer.textContent ?? '', /mesma chave idempotente será reutilizada/);
  await act(async () => firstRoot.unmount());

  const secondContainer = environment.window.document.createElement('div');
  environment.window.document.body.append(secondContainer);
  const secondRoot = createRoot(secondContainer);
  await act(async () => {
    secondRoot.render(createElement(FindingReviewCasesPage, {
      initialSearchParams: { create: '1', findingId: FINDING_ID },
      loadCases: async () => listResponse,
      loadDetail: async () => detailResponse,
      createCase: async (_findingId: string, key: string) => {
        keys.push(key);
        return { ...creationResponse, idempotentReplay: true };
      },
    }));
    await flush();
  });
  try {
    const secondButton = findButton(secondContainer, 'Criar caso');
    await act(async () => { secondButton.click(); await flush(); });
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.match(secondContainer.textContent ?? '', /Caso recuperado por replay idempotente/);
    assert.equal(
      environment.window.sessionStorage.getItem(`atlas:pending-review-case:${FINDING_ID}`),
      null,
    );
  } finally {
    await act(async () => secondRoot.unmount());
    secondContainer.remove();
    environment.cleanup();
  }
});

test('erros 400 e 404 são conclusivos e recebem mensagens controladas', async () => {
  for (const [status, expected] of [
    [400, /solicitação de criação é inválida/],
    [404, /achado não está mais disponível/],
  ] as const) {
    const harness = await renderPage({
      initialSearchParams: { create: '1', findingId: FINDING_ID },
      loadCases: async () => listResponse,
      createCase: async () => { throw new ApiError('internal detail', status); },
    });
    try {
      const button = findButton(harness.environment.container, 'Criar caso');
      await act(async () => { button.click(); await flush(); });
      assert.match(harness.environment.container.textContent ?? '', expected);
      assert.doesNotMatch(harness.environment.container.textContent ?? '', /internal detail/);
    } finally {
      await close(harness.root, harness.environment.cleanup);
    }
  }
});
