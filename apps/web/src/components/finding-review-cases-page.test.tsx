import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  FindingReviewCasesPage,
  PENDING_REVIEW_CASE_ATTEMPT_TTL_MS,
  PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS,
  buildFindingReviewCaseQueryFromForm,
  createPendingFindingReviewCaseAttempt,
  createPendingFindingReviewDecisionAttempt,
  parsePendingFindingReviewDecisionAttempt,
  parsePendingFindingReviewCaseAttempt,
} from './finding-review-cases-page.tsx';
import { ApiError } from '../lib/api-error.ts';
import type {
  CreateFindingReviewCaseResponse,
  CreateFindingReviewDecisionResponse,
  FindingReviewCaseDetail,
  FindingReviewCaseListResponse,
} from '../lib/api.ts';
import {
  createJsdomTestEnvironment,
  type JsdomTestEnvironment,
} from '../test/jsdom-test-environment.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CASE_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const FINDING_ID = 'finding_0123456789abcdef01234567';
const SECOND_FINDING_ID = 'finding_89abcdef0123456789abcdef';

const MAX_TESTS_PER_JSDOM = 8;
let sharedEnvironment = createJsdomTestEnvironment();
let sharedEnvironmentUses = 0;
let activeTestEnvironments = 0;
sharedEnvironment.container.remove();

function rotateSharedEnvironment(): void {
  sharedEnvironment.cleanup();
  sharedEnvironment = createJsdomTestEnvironment();
  sharedEnvironment.container.remove();
  sharedEnvironmentUses = 0;
}

function createIsolatedTestEnvironment(): JsdomTestEnvironment {
  if (sharedEnvironmentUses >= MAX_TESTS_PER_JSDOM) {
    assert.equal(activeTestEnvironments, 0);
    rotateSharedEnvironment();
  }
  sharedEnvironmentUses += 1;
  activeTestEnvironments += 1;
  sharedEnvironment.window.sessionStorage.clear();
  sharedEnvironment.window.history.replaceState(null, '', '/');
  const environment = sharedEnvironment;
  const container = sharedEnvironment.window.document.createElement('div');
  sharedEnvironment.window.document.body.append(container);
  let cleaned = false;
  return {
    container,
    window: sharedEnvironment.window,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      container.replaceChildren();
      container.remove();
      environment.window.sessionStorage.clear();
      environment.window.history.replaceState(null, '', '/');
      activeTestEnvironments -= 1;
    },
  };
}

after(() => sharedEnvironment.cleanup());

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

const decisionReadyDetail: FindingReviewCaseDetail = {
  ...detailResponse,
  status: 'IN_REVIEW',
  version: 2,
  originalSnapshot: {
    snapshotVersion: 1,
    findingId: FINDING_ID,
    reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
  },
  assets: [
    detailResponse.assets[0]!,
    {
      assetIdAtCreation: '55555555-5555-4555-8555-555555555555',
      assetNameAtCreation: 'SRV-APP-02',
      role: 'AFFECTED',
      currentAssetId: '55555555-5555-4555-8555-555555555555',
      currentAssetName: 'SRV-APP-02',
      currentAssetAvailable: true,
    },
  ],
};

const decisionResponse: CreateFindingReviewDecisionResponse = {
  decision: {
    id: '66666666-6666-4666-8666-666666666666',
    caseId: CASE_ID,
    identityConclusion: 'SAME_ASSET',
    justification: 'Mesma identidade confirmada.',
    caseVersion: 3,
    createdBy: 'atlas-mvp-user',
    createdAt: '2026-07-20T12:10:00.000Z',
  },
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

function setControlValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  if (control.tagName === 'TEXTAREA') {
    const legacyControl = control as HTMLTextAreaElement & {
      attachEvent?: () => void;
      detachEvent?: () => void;
    };
    legacyControl.attachEvent ??= () => undefined;
    legacyControl.detachEvent ??= () => undefined;
    control.focus();
  }
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', {
    bubbles: true,
  }));
  if (control.tagName === 'TEXTAREA') {
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((entry) => entry.textContent?.trim() === text);
  assert.ok(button);
  return button;
}

async function renderPage(
  props: Parameters<typeof FindingReviewCasesPage>[0],
  environment = createIsolatedTestEnvironment(),
) {
  const root: Root = createRoot(environment.container);
  await act(async () => {
    root.render(createElement(FindingReviewCasesPage, props));
    await flush();
  });
  return { environment, root };
}

function installControlledClock(initialTime: string) {
  const originalNow = Date.now;
  let now = Date.parse(initialTime);
  Date.now = () => now;
  return {
    get now() {
      return now;
    },
    advanceBy(milliseconds: number) {
      now += milliseconds;
    },
    restore() {
      Date.now = originalNow;
    },
  };
}

type StorageMethod = 'getItem' | 'setItem' | 'removeItem';

function replaceStorageMethod(
  environment: JsdomTestEnvironment,
  method: StorageMethod,
  replacement: Storage[StorageMethod],
): () => void {
  const prototype = Object.getPrototypeOf(environment.window.sessionStorage) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  assert.ok(descriptor);
  Object.defineProperty(prototype, method, {
    ...descriptor,
    value: replacement,
  });
  return () => Object.defineProperty(prototype, method, descriptor);
}

function controlAnimationFrames(environment: JsdomTestEnvironment) {
  const originalRequest = environment.window.requestAnimationFrame.bind(environment.window);
  const originalCancel = environment.window.cancelAnimationFrame.bind(environment.window);
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  environment.window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  };
  environment.window.cancelAnimationFrame = (id: number): void => {
    callbacks.delete(id);
  };
  return {
    get pendingCount() {
      return callbacks.size;
    },
    runAll(timestamp = 0) {
      const scheduled = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of scheduled) callback(timestamp);
    },
    restore() {
      callbacks.clear();
      environment.window.requestAnimationFrame = originalRequest;
      environment.window.cancelAnimationFrame = originalCancel;
    },
  };
}

async function close(root: Root, cleanup: () => void): Promise<void> {
  await act(async () => root.unmount());
  cleanup();
}

async function submitEligibleDecision(
  container: HTMLElement,
  conclusion: 'SAME_ASSET' | 'DIFFERENT_ASSETS' = 'SAME_ASSET',
  justification = 'Mesma identidade confirmada.',
): Promise<void> {
  const radio = container.querySelector<HTMLInputElement>(`input[value="${conclusion}"]`);
  const textarea = container.querySelector<HTMLTextAreaElement>('#review-decision-justification');
  assert.ok(radio && textarea);
  await act(async () => {
    radio.click();
    await flush();
  });
  await act(async () => {
    setControlValue(textarea, justification);
    await flush();
  });
  await act(async () => {
    findButton(container, 'Revisar decisão').click();
    await flush();
  });
  await act(async () => {
    findButton(container, 'Registrar decisão').click();
    await flush();
  });
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
    const heading = harness.environment.container.querySelector<HTMLHeadingElement>('#review-case-detail-title');
    assert.ok(panel && heading);
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    assert.equal(harness.environment.window.document.activeElement, heading);
    assert.equal(heading.tabIndex, -1);
    assert.equal(panel.hasAttribute('tabindex'), false);
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

test('move o foco para o detalhe somente depois da conclusão do carregamento', async () => {
  const pending = deferred<FindingReviewCaseDetail>();
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async () => pending.promise,
  });
  try {
    const trigger = findButton(harness.environment.container, 'Ver detalhe');
    trigger.focus();
    await act(async () => { trigger.click(); await flush(); });
    const panel = harness.environment.container.querySelector<HTMLElement>('#finding-review-case-detail');
    assert.ok(panel);
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    assert.notEqual(
      harness.environment.window.document.activeElement,
      harness.environment.container.querySelector('#review-case-detail-title'),
    );

    await act(async () => { pending.resolve(detailResponse); await flush(); });
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    const heading = harness.environment.container.querySelector<HTMLHeadingElement>('#review-case-detail-title');
    assert.ok(heading);
    assert.equal(harness.environment.window.document.activeElement, heading);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('cancela o foco agendado do caso anterior durante troca rápida de detalhe', async () => {
  const first = deferred<FindingReviewCaseDetail>();
  const second = deferred<FindingReviewCaseDetail>();
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async (id) => id === CASE_ID ? first.promise : second.promise,
  });
  try {
    const trigger = findButton(harness.environment.container, 'Ver detalhe');
    await act(async () => { trigger.click(); await flush(); });
    await act(async () => { first.resolve(detailResponse); await flush(); });

    harness.environment.window.history.pushState(
      null,
      '',
      `/conflict-review-cases?caseId=${SECOND_CASE_ID}`,
    );
    await act(async () => {
      harness.environment.window.dispatchEvent(
        new harness.environment.window.PopStateEvent('popstate'),
      );
      await flush();
    });
    const loadingHeading = harness.environment.container.querySelector<HTMLHeadingElement>(
      '#review-case-detail-title',
    );
    assert.ok(loadingHeading);
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    assert.notEqual(harness.environment.window.document.activeElement, loadingHeading);

    await act(async () => {
      second.resolve({ ...detailResponse, id: SECOND_CASE_ID });
      await flush();
    });
    await act(async () => {
      await new Promise((resolve) => harness.environment.window.requestAnimationFrame(resolve));
    });
    const finalHeading = harness.environment.container.querySelector<HTMLHeadingElement>(
      '#review-case-detail-title',
    );
    assert.ok(finalHeading);
    assert.equal(harness.environment.window.document.activeElement, finalHeading);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('erro do detalhe direciona o foco ao heading somente depois de concluir o loading', async () => {
  const environment = createIsolatedTestEnvironment();
  const frames = controlAnimationFrames(environment);
  const pending = deferred<FindingReviewCaseDetail>();
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async () => pending.promise,
  }, environment);
  try {
    await act(async () => { frames.runAll(); await flush(); });
    const trigger = findButton(environment.container, 'Ver detalhe');
    trigger.focus();
    await act(async () => { trigger.click(); await flush(); });
    await act(async () => {
      pending.reject(new ApiError('Falha controlada', 500));
      await flush();
    });
    const heading = environment.container.querySelector<HTMLHeadingElement>(
      '#review-case-detail-title',
    );
    assert.ok(heading);
    assert.equal(heading.tabIndex, -1);
    assert.notEqual(environment.window.document.activeElement, heading);
    await act(async () => { frames.runAll(); await flush(); });
    assert.equal(environment.window.document.activeElement, heading);
    assert.match(environment.container.textContent ?? '', /Falha controlada/);
  } finally {
    frames.restore();
    await close(harness.root, environment.cleanup);
  }
});

test('fechar antes do frame cancela o foco do detalhe e restaura o expansor', async () => {
  const environment = createIsolatedTestEnvironment();
  const frames = controlAnimationFrames(environment);
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
  }, environment);
  try {
    await act(async () => { frames.runAll(); await flush(); });
    const trigger = findButton(environment.container, 'Ver detalhe');
    trigger.focus();
    await act(async () => { trigger.click(); await flush(); });
    const heading = environment.container.querySelector<HTMLHeadingElement>(
      '#review-case-detail-title',
    );
    assert.ok(heading);
    assert.ok(frames.pendingCount > 0);

    await act(async () => {
      findButton(environment.container, 'Fechar detalhe').click();
      await flush();
    });
    assert.equal(environment.container.querySelector('#review-case-detail-title'), null);
    await act(async () => { frames.runAll(); await flush(); });
    assert.equal(environment.window.document.activeElement, trigger);
  } finally {
    frames.restore();
    await close(harness.root, environment.cleanup);
  }
});

test('unmount antes do frame cancela o foco pendente do detalhe', async () => {
  const environment = createIsolatedTestEnvironment();
  const frames = controlAnimationFrames(environment);
  const harness = await renderPage({
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
  }, environment);
  await act(async () => { frames.runAll(); await flush(); });
  await act(async () => {
    findButton(environment.container, 'Ver detalhe').click();
    await flush();
  });
  const heading = environment.container.querySelector<HTMLHeadingElement>(
    '#review-case-detail-title',
  );
  assert.ok(heading);
  let focusCalls = 0;
  heading.focus = () => { focusCalls += 1; };
  assert.ok(frames.pendingCount > 0);
  await act(async () => harness.root.unmount());
  assert.equal(frames.pendingCount, 0);
  frames.runAll();
  assert.equal(focusCalls, 0);
  frames.restore();
  environment.cleanup();
});

test('rerender do mesmo detalhe não agenda nem rouba o foco novamente', async () => {
  const environment = createIsolatedTestEnvironment();
  const frames = controlAnimationFrames(environment);
  const props = {
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
  };
  const harness = await renderPage(props, environment);
  try {
    await act(async () => { frames.runAll(); await flush(); });
    await act(async () => {
      findButton(environment.container, 'Ver detalhe').click();
      await flush();
    });
    const heading = environment.container.querySelector<HTMLHeadingElement>(
      '#review-case-detail-title',
    );
    assert.ok(heading);
    const originalFocus = heading.focus.bind(heading);
    let focusCalls = 0;
    heading.focus = (options?: FocusOptions) => {
      focusCalls += 1;
      originalFocus(options);
    };
    await act(async () => { frames.runAll(); await flush(); });
    assert.equal(focusCalls, 1);

    const filterControl = environment.container.querySelector<HTMLSelectElement>('select');
    assert.ok(filterControl);
    filterControl.focus();
    await act(async () => {
      harness.root.render(createElement(FindingReviewCasesPage, props));
      await flush();
    });
    await act(async () => { frames.runAll(); await flush(); });
    assert.equal(focusCalls, 1);
    assert.equal(environment.window.document.activeElement, filterControl);
  } finally {
    frames.restore();
    await close(harness.root, environment.cleanup);
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

test('rejeita datas calendariamente impossíveis sem normalização silenciosa', () => {
  for (const value of ['2026-02-30T09:00', '2025-02-29T09:00', '2026-13-01T09:00']) {
    const parsed = buildFindingReviewCaseQueryFromForm({
      status: '', staleness: '', findingType: '', findingId: '', createdBy: '', assetId: '',
      createdFrom: value,
      createdTo: '',
      sortBy: 'createdAt', sortDirection: 'desc', pageSize: '25',
    });
    assert.equal(parsed.query, null);
    assert.match(parsed.error ?? '', /datas e horários válidos/);
  }
  const leapDay = buildFindingReviewCaseQueryFromForm({
    status: '', staleness: '', findingType: '', findingId: '', createdBy: '', assetId: '',
    createdFrom: '2024-02-29T09:00',
    createdTo: '',
    sortBy: 'createdAt', sortDirection: 'desc', pageSize: '25',
  });
  assert.equal(leapDay.error, null);
  assert.ok(leapDay.query?.createdFrom);
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
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  harness.environment.window.sessionStorage.setItem(
    storageKey,
    JSON.stringify(createPendingFindingReviewCaseAttempt(FINDING_ID, 'atlas-ui-unmount-success')),
  );
  const button = findButton(harness.environment.container, 'Criar caso');
  await act(async () => { button.click(); await flush(); });
  await act(async () => harness.root.unmount());
  assert.equal(signal?.aborted, true);
  await act(async () => { pending.resolve(creationResponse); await flush(); });
  assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
  harness.environment.cleanup();
});

test('navegação durante replay conclusivo limpa a tentativa e ignora sua resposta tardia', async () => {
  const pending = deferred<CreateFindingReviewCaseResponse>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async (_findingId, _key, options) => {
      calls += 1;
      signal = options?.signal;
      if (calls === 1) throw new ApiError('Falha de rede', 0);
      return pending.promise;
    },
  });
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    assert.ok(harness.environment.window.sessionStorage.getItem(storageKey));
    await act(async () => { button.click(); await flush(); });
    harness.environment.window.history.pushState(null, '', '/conflict-review-cases');
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.PopStateEvent('popstate'));
      await flush();
    });
    assert.equal(signal?.aborted, true);
    await act(async () => {
      pending.resolve({ ...creationResponse, idempotentReplay: true });
      await flush();
    });
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
    const text = harness.environment.container.textContent ?? '';
    assert.doesNotMatch(text, /Caso criado com sucesso|Caso recuperado por replay/);
    assert.equal(harness.environment.container.querySelector('#finding-review-case-detail'), null);
    assert.equal(harness.environment.window.location.search.includes('caseId='), false);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resultado incerto preserva a chave entre remontagem e replay', async () => {
  const environment = createIsolatedTestEnvironment();
  const keys: string[] = [];
  const uncertain = deferred<CreateFindingReviewCaseResponse>();
  const firstContainer = environment.container;
  const firstRoot = createRoot(firstContainer);
  await act(async () => {
    firstRoot.render(createElement(FindingReviewCasesPage, {
      initialSearchParams: { create: '1', findingId: FINDING_ID },
      loadCases: async () => listResponse,
      createCase: async (_findingId: string, key: string) => {
        keys.push(key);
        return uncertain.promise;
      },
    }));
    await flush();
  });
  const firstButton = findButton(firstContainer, 'Criar caso');
  await act(async () => { firstButton.click(); await flush(); });
  assert.equal(
    environment.window.sessionStorage.getItem(`atlas:pending-review-case:${FINDING_ID}`),
    null,
  );
  await act(async () => {
    uncertain.reject(new ApiError('Falha de rede', 0));
    await flush();
  });
  assert.match(firstContainer.textContent ?? '', /mesma chave idempotente será reutilizada/);
  const storedAttempt = environment.window.sessionStorage.getItem(
    `atlas:pending-review-case:${FINDING_ID}`,
  );
  assert.ok(storedAttempt);
  const parsedAttempt = parsePendingFindingReviewCaseAttempt(storedAttempt, FINDING_ID);
  assert.equal(parsedAttempt?.idempotencyKey, keys[0]);
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
    assert.equal(
      environment.window.sessionStorage.getItem(`atlas:pending-review-case:${FINDING_ID}`),
      storedAttempt,
    );
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

test('tentativa pendente usa envelope versionado e expira sem renovar silenciosamente', () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z');
  const key = 'atlas-ui-11111111-1111-4111-8111-111111111111';
  const attempt = createPendingFindingReviewCaseAttempt(FINDING_ID, key, now);
  assert.deepEqual(attempt, {
    version: 1,
    findingId: FINDING_ID,
    idempotencyKey: key,
    createdAt: '2026-07-20T12:00:00.000Z',
    expiresAt: '2026-07-20T12:15:00.000Z',
  });
  const serialized = JSON.stringify(attempt);
  assert.deepEqual(
    parsePendingFindingReviewCaseAttempt(serialized, FINDING_ID, now + 1),
    attempt,
  );
  assert.equal(
    parsePendingFindingReviewCaseAttempt(
      serialized,
      FINDING_ID,
      now + PENDING_REVIEW_CASE_ATTEMPT_TTL_MS,
    ),
    null,
  );
});

test('tentativa pendente rejeita conteúdo inválido, adulterado ou associado a outro finding', () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z');
  const key = 'atlas-ui-11111111-1111-4111-8111-111111111111';
  const valid = createPendingFindingReviewCaseAttempt(FINDING_ID, key, now);
  const invalidValues = [
    'not-json',
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, findingId: SECOND_FINDING_ID }),
    JSON.stringify({ ...valid, idempotencyKey: `${key} espaço` }),
    JSON.stringify({ ...valid, expiresAt: '2026-07-20T13:00:00.000Z' }),
    JSON.stringify({ ...valid, unexpected: true }),
  ];
  for (const value of invalidValues) {
    assert.equal(parsePendingFindingReviewCaseAttempt(value, FINDING_ID, now + 1), null);
  }
});

test('conteúdo pendente inválido ou expirado exige um novo gesto antes do POST', async () => {
  const expired = createPendingFindingReviewCaseAttempt(
    FINDING_ID,
    'atlas-ui-expired',
    Date.parse('2020-01-01T00:00:00.000Z'),
  );
  for (const storedValue of ['{invalid', JSON.stringify(expired)]) {
    const environment = createIsolatedTestEnvironment();
    const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
    environment.window.sessionStorage.setItem(storageKey, storedValue);
    const keys: string[] = [];
    const root = createRoot(environment.container);
    await act(async () => {
      root.render(createElement(FindingReviewCasesPage, {
        initialSearchParams: { create: '1', findingId: FINDING_ID },
        loadCases: async () => listResponse,
        createCase: async (_findingId: string, key: string) => {
          keys.push(key);
          throw new ApiError('Falha de rede', 0);
        },
      }));
      await flush();
    });
    try {
      await act(async () => { findButton(environment.container, 'Criar caso').click(); await flush(); });
      assert.equal(keys.length, 0);
      assert.equal(environment.window.sessionStorage.getItem(storageKey), null);
      assert.match(environment.container.textContent ?? '', /foi descartad[oa].*Clique novamente/s);

      await act(async () => { findButton(environment.container, 'Criar caso').click(); await flush(); });
      assert.equal(keys.length, 1);
      assert.notEqual(keys[0], 'atlas-ui-expired');
      const replacement = environment.window.sessionStorage.getItem(storageKey);
      assert.ok(replacement);
      assert.equal(
        parsePendingFindingReviewCaseAttempt(replacement, FINDING_ID)?.idempotencyKey,
        keys[0],
      );
    } finally {
      await act(async () => root.unmount());
      environment.cleanup();
    }
  }
});

test('retries incertos aos 5 e 14 minutos preservam chave e expiração sem renovar o TTL', async () => {
  const clock = installControlledClock('2026-07-20T12:00:00.000Z');
  const keys: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, key) => {
      keys.push(key);
      throw new ApiError('Falha de rede', 0);
    },
  });
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const firstEnvelope = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.ok(firstEnvelope);
    const firstAttempt = parsePendingFindingReviewCaseAttempt(firstEnvelope, FINDING_ID);
    assert.ok(firstAttempt);

    clock.advanceBy(5 * 60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    const secondEnvelope = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.equal(secondEnvelope, firstEnvelope);
    assert.deepEqual(
      parsePendingFindingReviewCaseAttempt(secondEnvelope ?? '', FINDING_ID),
      firstAttempt,
    );

    clock.advanceBy(9 * 60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), firstEnvelope);
    assert.deepEqual(keys, [
      firstAttempt.idempotencyKey,
      firstAttempt.idempotencyKey,
      firstAttempt.idempotencyKey,
    ]);

    clock.advanceBy(60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 3);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
    assert.match(harness.environment.container.textContent ?? '', /tentativa anterior expirou/);
  } finally {
    clock.restore();
    await close(harness.root, harness.environment.cleanup);
  }
});

test('retry aos 14 minutos reutiliza o mesmo header e os timestamps originais', async () => {
  const clock = installControlledClock('2026-07-20T12:00:00.000Z');
  const calls: Array<{ findingId: string; key: string }> = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (findingId, key) => {
      calls.push({ findingId, key });
      throw new ApiError('Falha de rede', 0);
    },
  });
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const originalEnvelope = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.ok(originalEnvelope);
    const originalAttempt = parsePendingFindingReviewCaseAttempt(
      originalEnvelope,
      FINDING_ID,
      clock.now,
    );
    assert.ok(originalAttempt);

    clock.advanceBy(14 * 60 * 1_000);
    await act(async () => { button.click(); await flush(); });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls, [
      { findingId: FINDING_ID, key: originalAttempt.idempotencyKey },
      { findingId: FINDING_ID, key: originalAttempt.idempotencyKey },
    ]);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), originalEnvelope);
    assert.deepEqual(
      parsePendingFindingReviewCaseAttempt(originalEnvelope, FINDING_ID, clock.now),
      originalAttempt,
    );
  } finally {
    clock.restore();
    await close(harness.root, harness.environment.cleanup);
  }
});

test('retry após mais de 15 minutos bloqueia o POST e exige outro gesto para nova chave', async () => {
  const clock = installControlledClock('2026-07-20T12:00:00.000Z');
  const keys: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, key) => {
      keys.push(key);
      throw new ApiError('Falha de rede', 0);
    },
  });
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const expiredKey = keys[0];
    const originalEnvelope = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.ok(originalEnvelope);

    clock.advanceBy(PENDING_REVIEW_CASE_ATTEMPT_TTL_MS + 1);
    await act(async () => { button.click(); await flush(); });
    assert.deepEqual(keys, [expiredKey]);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
    assert.match(harness.environment.container.textContent ?? '', /tentativa anterior expirou/);

    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 2);
    assert.notEqual(keys[1], expiredKey);
    const replacement = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.ok(replacement);
    const replacementAttempt = parsePendingFindingReviewCaseAttempt(
      replacement,
      FINDING_ID,
      clock.now,
    );
    assert.ok(replacementAttempt);
    assert.equal(replacementAttempt.idempotencyKey, keys[1]);
    assert.equal(replacementAttempt.createdAt, new Date(clock.now).toISOString());
    assert.equal(
      replacementAttempt.expiresAt,
      new Date(clock.now + PENDING_REVIEW_CASE_ATTEMPT_TTL_MS).toISOString(),
    );
  } finally {
    clock.restore();
    await close(harness.root, harness.environment.cleanup);
  }
});

test('retry expirado na mesma aba não envia POST e exige novo gesto', async () => {
  const originalNow = Date.now;
  let now = Date.parse('2026-07-20T12:00:00.000Z');
  Date.now = () => now;
  const keys: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, key) => {
      keys.push(key);
      throw new ApiError('Falha de rede', 0);
    },
  });
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const originalEnvelope = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.ok(originalEnvelope);

    now += PENDING_REVIEW_CASE_ATTEMPT_TTL_MS;
    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 1);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
    assert.match(harness.environment.container.textContent ?? '', /tentativa anterior expirou/);

    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 2);
    assert.notEqual(keys[1], keys[0]);
    const replacement = harness.environment.window.sessionStorage.getItem(storageKey);
    assert.ok(replacement);
    assert.notEqual(replacement, originalEnvelope);
  } finally {
    Date.now = originalNow;
    await close(harness.root, harness.environment.cleanup);
  }
});

test('getItem indisponível reutiliza a tentativa em memória antes do TTL e bloqueia depois', async () => {
  const clock = installControlledClock('2026-07-20T12:00:00.000Z');
  const environment = createIsolatedTestEnvironment();
  const storage = environment.window.sessionStorage;
  const originalGetItem = storage.getItem.bind(storage);
  const restoreGetItem = replaceStorageMethod(environment, 'getItem', () => {
    throw new Error('storage blocked');
  });
  const keys: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, key) => {
      keys.push(key);
      throw new ApiError('Falha de rede', 0);
    },
  }, environment);
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const originalEnvelope = originalGetItem(storageKey);
    assert.ok(originalEnvelope);
    const attempt = parsePendingFindingReviewCaseAttempt(originalEnvelope, FINDING_ID, clock.now);
    assert.ok(attempt);

    clock.advanceBy(14 * 60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    assert.deepEqual(keys, [attempt.idempotencyKey, attempt.idempotencyKey]);
    assert.equal(originalGetItem(storageKey), originalEnvelope);

    clock.advanceBy(60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 2);
    assert.match(environment.container.textContent ?? '', /tentativa anterior expirou/);

    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 3);
    assert.notEqual(keys[2], attempt.idempotencyKey);
    assert.doesNotMatch(environment.container.textContent ?? '', /storage blocked|sessionStorage/);
  } finally {
    restoreGetItem();
    clock.restore();
    await close(harness.root, environment.cleanup);
  }
});

test('setItem indisponível mantém o envelope completo em memória e respeita sua expiração', async () => {
  const clock = installControlledClock('2026-07-20T12:00:00.000Z');
  const environment = createIsolatedTestEnvironment();
  const restoreSetItem = replaceStorageMethod(environment, 'setItem', () => {
    throw new Error('storage blocked');
  });
  const keys: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, key) => {
      keys.push(key);
      throw new ApiError('Falha de rede', 0);
    },
  }, environment);
  try {
    const button = findButton(environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const originalKey = keys[0];
    assert.equal(environment.window.sessionStorage.length, 0);

    clock.advanceBy(14 * 60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    assert.deepEqual(keys, [originalKey, originalKey]);

    clock.advanceBy(60 * 1_000);
    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 2);
    assert.match(environment.container.textContent ?? '', /tentativa anterior expirou/);

    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 3);
    assert.notEqual(keys[2], originalKey);
    assert.equal(environment.window.sessionStorage.length, 0);
    assert.doesNotMatch(environment.container.textContent ?? '', /storage blocked|sessionStorage/);
  } finally {
    restoreSetItem();
    clock.restore();
    await close(harness.root, environment.cleanup);
  }
});

test('removeItem indisponível invalida a tentativa expirada em memória sem crash', async () => {
  const clock = installControlledClock('2026-07-20T12:00:00.000Z');
  const environment = createIsolatedTestEnvironment();
  const restoreRemoveItem = replaceStorageMethod(environment, 'removeItem', () => {
    throw new Error('storage blocked');
  });
  const keys: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async (_findingId, key) => {
      keys.push(key);
      throw new ApiError('Falha de rede', 0);
    },
  }, environment);
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  try {
    const button = findButton(environment.container, 'Criar caso');
    await act(async () => { button.click(); await flush(); });
    const originalEnvelope = environment.window.sessionStorage.getItem(storageKey);
    assert.ok(originalEnvelope);

    clock.advanceBy(PENDING_REVIEW_CASE_ATTEMPT_TTL_MS);
    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 1);
    assert.equal(environment.window.sessionStorage.getItem(storageKey), originalEnvelope);
    assert.match(environment.container.textContent ?? '', /tentativa anterior expirou/);

    await act(async () => { button.click(); await flush(); });
    assert.equal(keys.length, 2);
    assert.notEqual(keys[1], keys[0]);
    assert.doesNotMatch(environment.container.textContent ?? '', /storage blocked|sessionStorage/);
  } finally {
    restoreRemoveItem();
    clock.restore();
    await close(harness.root, environment.cleanup);
  }
});

test('tentativas incertas permanecem isoladas por finding durante navegação', async () => {
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    createCase: async () => { throw new ApiError('Falha de rede', 0); },
  });
  try {
    await act(async () => {
      findButton(harness.environment.container, 'Criar caso').click();
      await flush();
    });
    const firstStorageKey = `atlas:pending-review-case:${FINDING_ID}`;
    const firstAttempt = harness.environment.window.sessionStorage.getItem(firstStorageKey);
    assert.ok(firstAttempt);

    harness.environment.window.history.pushState(
      null,
      '',
      `/conflict-review-cases?create=1&findingId=${SECOND_FINDING_ID}`,
    );
    await act(async () => {
      harness.environment.window.dispatchEvent(
        new harness.environment.window.PopStateEvent('popstate'),
      );
      await flush();
      findButton(harness.environment.container, 'Criar caso').click();
      await flush();
    });
    const secondStorageKey = `atlas:pending-review-case:${SECOND_FINDING_ID}`;
    const secondAttempt = harness.environment.window.sessionStorage.getItem(secondStorageKey);
    assert.ok(secondAttempt);
    assert.equal(harness.environment.window.sessionStorage.getItem(firstStorageKey), firstAttempt);
    assert.notEqual(secondAttempt, firstAttempt);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('respostas conclusivas limpam a tentativa mesmo depois do unmount', async () => {
  for (const status of [400, 404, 409, 503]) {
    const environment = createIsolatedTestEnvironment();
    const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
    const attempt = createPendingFindingReviewCaseAttempt(
      FINDING_ID,
      `atlas-ui-conclusive-${status}`,
    );
    environment.window.sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    const pending = deferred<CreateFindingReviewCaseResponse>();
    const root = createRoot(environment.container);
    await act(async () => {
      root.render(createElement(FindingReviewCasesPage, {
        initialSearchParams: { create: '1', findingId: FINDING_ID },
        loadCases: async () => listResponse,
        createCase: async () => pending.promise,
      }));
      await flush();
    });
    await act(async () => {
      findButton(environment.container, 'Criar caso').click();
      await flush();
    });
    await act(async () => root.unmount());
    await act(async () => {
      pending.reject(new ApiError('Resposta conclusiva', status));
      await flush();
    });
    assert.equal(environment.window.sessionStorage.getItem(storageKey), null);
    environment.cleanup();
  }
});

test('replay 200 após unmount limpa a tentativa sem navegar ou atualizar React', async () => {
  const pendingReplay = deferred<CreateFindingReviewCaseResponse>();
  let calls = 0;
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async () => {
      calls += 1;
      if (calls === 1) throw new ApiError('Falha de rede', 0);
      return pendingReplay.promise;
    },
  });
  const storageKey = `atlas:pending-review-case:${FINDING_ID}`;
  const button = findButton(harness.environment.container, 'Criar caso');
  await act(async () => { button.click(); await flush(); });
  assert.ok(harness.environment.window.sessionStorage.getItem(storageKey));
  await act(async () => { button.click(); await flush(); });
  await act(async () => harness.root.unmount());
  await act(async () => {
    pendingReplay.resolve({ ...creationResponse, idempotentReplay: true });
    await flush();
  });
  assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
  assert.equal(harness.environment.window.location.search.includes('caseId='), false);
  assert.equal(harness.environment.container.textContent, '');
  harness.environment.cleanup();
});

test('resposta conclusiva de A remove somente seu envelope e preserva a tentativa de B', async () => {
  const pendingA = deferred<CreateFindingReviewCaseResponse>();
  let callsA = 0;
  const harness = await renderPage({
    initialSearchParams: { create: '1', findingId: FINDING_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    createCase: async (findingId) => {
      if (findingId === FINDING_ID) {
        callsA += 1;
        if (callsA === 1) throw new ApiError('Falha de rede A', 0);
        return pendingA.promise;
      }
      throw new ApiError('Falha de rede B', 0);
    },
  });
  const storageKeyA = `atlas:pending-review-case:${FINDING_ID}`;
  const storageKeyB = `atlas:pending-review-case:${SECOND_FINDING_ID}`;
  try {
    const buttonA = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { buttonA.click(); await flush(); });
    assert.ok(harness.environment.window.sessionStorage.getItem(storageKeyA));
    await act(async () => { buttonA.click(); await flush(); });

    harness.environment.window.history.pushState(
      null,
      '',
      `/conflict-review-cases?create=1&findingId=${SECOND_FINDING_ID}`,
    );
    await act(async () => {
      harness.environment.window.dispatchEvent(
        new harness.environment.window.PopStateEvent('popstate'),
      );
      await flush();
    });
    const buttonB = findButton(harness.environment.container, 'Criar caso');
    await act(async () => { buttonB.click(); await flush(); });
    const envelopeB = harness.environment.window.sessionStorage.getItem(storageKeyB);
    assert.ok(envelopeB);

    await act(async () => {
      pendingA.resolve({ ...creationResponse, idempotentReplay: true });
      await flush();
    });
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKeyA), null);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKeyB), envelopeB);
    assert.match(harness.environment.container.textContent ?? '', new RegExp(SECOND_FINDING_ID));
    assert.doesNotMatch(
      harness.environment.container.textContent ?? '',
      /Caso recuperado por replay|Caso criado com sucesso/,
    );
    assert.equal(harness.environment.window.location.search.includes('caseId='), false);
  } finally {
    await close(harness.root, harness.environment.cleanup);
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

test('altera o estado com a versão atual, confirma o sucesso e recarrega caso e lista', async () => {
  const updates: Array<{ id: string; status: string; version: number }> = [];
  let detailLoads = 0;
  let listLoads = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => { listLoads += 1; return listResponse; },
    loadDetail: async () => {
      detailLoads += 1;
      return detailLoads === 1 ? detailResponse : {
        ...detailResponse,
        status: 'IN_REVIEW',
        version: 2,
        updatedAt: '2026-07-20T12:05:00.000Z',
        events: [...detailResponse.events, {
          id: SECOND_CASE_ID,
          eventType: 'CASE_STATUS_CHANGED',
          versionBefore: 1,
          versionAfter: 2,
          actor: 'atlas-mvp-user',
          metadata: { statusBefore: 'OPEN', statusAfter: 'IN_REVIEW' },
          createdAt: '2026-07-20T12:05:00.000Z',
        }],
      };
    },
    updateStatus: async (id, status, version) => {
      updates.push({ id, status, version });
      return { id, status, version: version + 1, updatedAt: '2026-07-20T12:05:00.000Z' };
    },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    assert.equal(harness.environment.container.querySelector('textarea'), null);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    await act(async () => { findButton(harness.environment.container, 'Confirmar alteração').click(); await flush(); });
    assert.deepEqual(updates, [{ id: CASE_ID, status: 'IN_REVIEW', version: 1 }]);
    assert.match(harness.environment.container.textContent ?? '', /Status alterado para Em análise/);
    assert.match(harness.environment.container.textContent ?? '', /Status do caso alterado/);
    assert.ok(detailLoads >= 2);
    assert.ok(listLoads >= 2);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('exige justificativa ao entrar em espera, normaliza o payload e a mostra no histórico', async () => {
  const updates: Array<{ id: string; status: string; version: number; justification?: string }> = [];
  let detailLoads = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => {
      detailLoads += 1;
      return detailLoads === 1 ? detailResponse : {
        ...detailResponse,
        status: 'WAITING_FOR_EVIDENCE',
        version: 2,
        updatedAt: '2026-07-20T12:05:00.000Z',
        events: [...detailResponse.events, {
          id: SECOND_CASE_ID,
          eventType: 'CASE_STATUS_CHANGED',
          versionBefore: 1,
          versionAfter: 2,
          actor: 'atlas-mvp-user',
          metadata: {
            statusBefore: 'OPEN',
            statusAfter: 'WAITING_FOR_EVIDENCE',
            justification: 'Falta  confirmação\ntécnica.',
          },
          createdAt: '2026-07-20T12:05:00.000Z',
        }],
      };
    },
    updateStatus: async (id, status, version, justification) => {
      updates.push({ id, status, version, justification });
      return { id, status, version: version + 1, updatedAt: '2026-07-20T12:05:00.000Z' };
    },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'WAITING_FOR_EVIDENCE'); await flush(); });
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-case-status-justification',
    );
    assert.ok(textarea);
    assert.equal(textarea.required, true);
    assert.equal(textarea.maxLength, 500);
    assert.equal(textarea.labels?.item(0)?.textContent, 'Justificativa');
    assert.match(
      harness.environment.container.textContent ?? '',
      /Não inclua credenciais, tokens ou dados sensíveis/,
    );
    await act(async () => {
      setControlValue(textarea, '  Falta  confirmação\ntécnica.  ');
      await flush();
    });
    await act(async () => {
      findButton(harness.environment.container, 'Confirmar alteração').click();
      await flush();
    });
    assert.deepEqual(updates, [{
      id: CASE_ID,
      status: 'WAITING_FOR_EVIDENCE',
      version: 1,
      justification: 'Falta  confirmação\ntécnica.',
    }]);
    assert.match(harness.environment.container.textContent ?? '', /Justificativa:/);
    assert.match(harness.environment.container.textContent ?? '', /Falta  confirmação/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('exige justificativa ao sair da espera e impede whitespace com foco acessível', async () => {
  let updates = 0;
  const waitingDetail: FindingReviewCaseDetail = {
    ...detailResponse,
    status: 'WAITING_FOR_EVIDENCE',
  };
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => waitingDetail,
    updateStatus: async (id, status, version) => {
      updates += 1;
      return { id, status, version: version + 1, updatedAt: '2026-07-20T12:05:00.000Z' };
    },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-case-status-justification',
    );
    assert.ok(textarea);
    await act(async () => { setControlValue(textarea, '   \n  '); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Confirmar alteração').click();
      await flush();
    });
    assert.equal(updates, 0);
    assert.match(harness.environment.container.textContent ?? '', /Informe uma justificativa/);
    assert.equal(harness.environment.window.document.activeElement, textarea);
    assert.equal(textarea.getAttribute('aria-invalid'), 'true');
    await act(async () => { setControlValue(textarea, 'a'.repeat(501)); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Confirmar alteração').click();
      await flush();
    });
    assert.equal(updates, 0);
    assert.match(harness.environment.container.textContent ?? '', /no máximo 500 caracteres/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('loading desabilita select, textarea e botão da transição de espera', async () => {
  const pending = deferred<{
    id: string;
    status: 'WAITING_FOR_EVIDENCE';
    version: number;
    updatedAt: string;
  }>();
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => decisionReadyDetail,
    updateStatus: async () => pending.promise,
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'WAITING_FOR_EVIDENCE'); await flush(); });
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-case-status-justification',
    );
    assert.ok(textarea);
    await act(async () => { setControlValue(textarea, 'Aguardando evidência.'); await flush(); });
    const button = findButton(harness.environment.container, 'Confirmar alteração');
    await act(async () => { button.click(); await flush(); });
    assert.equal(select.disabled, true);
    assert.equal(textarea.disabled, true);
    assert.equal(button.disabled, true);
    assert.equal(
      findButton(harness.environment.container, 'Revisar decisão').disabled,
      true,
    );
    await act(async () => {
      pending.resolve({
        id: CASE_ID,
        status: 'WAITING_FOR_EVIDENCE',
        version: 2,
        updatedAt: '2026-07-20T12:05:00.000Z',
      });
      await flush();
    });
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('conflito 409 não faz retry automático e exige recarregamento explícito', async () => {
  let updates = 0;
  let detailLoads = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => { detailLoads += 1; return detailResponse; },
    updateStatus: async () => { updates += 1; throw new ApiError('stale internals', 409); },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'WAITING_FOR_EVIDENCE'); await flush(); });
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-case-status-justification',
    );
    assert.ok(textarea);
    await act(async () => { setControlValue(textarea, 'Aguardando evidência.'); await flush(); });
    await act(async () => { findButton(harness.environment.container, 'Confirmar alteração').click(); await flush(); });
    assert.equal(updates, 1);
    assert.equal(detailLoads, 1);
    assert.match(harness.environment.container.textContent ?? '', /alterado por outra operação/);
    assert.doesNotMatch(harness.environment.container.textContent ?? '', /stale internals/);
    assert.equal(textarea.value, 'Aguardando evidência.');
    const alert = harness.environment.container.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.equal(harness.environment.window.document.activeElement, alert);
    await act(async () => { findButton(harness.environment.container, 'Recarregar caso').click(); await flush(); });
    assert.equal(updates, 1);
    assert.ok(detailLoads >= 2);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('clique duplo mantém uma única transição em voo', async () => {
  const pending = deferred<{ id: string; status: 'IN_REVIEW'; version: number; updatedAt: string }>();
  let updates = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    updateStatus: async () => { updates += 1; return pending.promise; },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    const button = findButton(harness.environment.container, 'Confirmar alteração');
    await act(async () => { button.click(); button.click(); await flush(); });
    assert.equal(updates, 1);
    assert.equal(button.disabled, true);
    await act(async () => { pending.resolve({ id: CASE_ID, status: 'IN_REVIEW', version: 2, updatedAt: '2026-07-20T12:05:00.000Z' }); await flush(); });
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('Enter e clique quase simultâneos enviam uma única transição', async () => {
  const pending = deferred<{ id: string; status: 'IN_REVIEW'; version: number; updatedAt: string }>();
  const updates: Array<{ id: string; status: string; version: number }> = [];
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    updateStatus: async (id, status, version) => {
      updates.push({ id, status, version });
      return pending.promise;
    },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>(
      '#review-case-next-status',
    );
    assert.ok(select);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    const button = findButton(harness.environment.container, 'Confirmar alteração');
    const form = button.closest('form');
    assert.ok(form);

    await act(async () => {
      form.dispatchEvent(new harness.environment.window.Event('submit', {
        bubbles: true,
        cancelable: true,
      }));
      button.click();
      await flush();
    });

    assert.deepEqual(updates, [{ id: CASE_ID, status: 'IN_REVIEW', version: 1 }]);
    await act(async () => {
      pending.resolve({
        id: CASE_ID,
        status: 'IN_REVIEW',
        version: 2,
        updatedAt: '2026-07-20T12:05:00.000Z',
      });
      await flush();
    });
    assert.equal(
      (harness.environment.container.textContent ?? '').match(/Status alterado para Em análise/g)
        ?.length,
      1,
    );
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resultado incerto não repete PATCH e orienta recarregar antes de nova tentativa', async () => {
  let updates = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    updateStatus: async () => { updates += 1; throw new ApiError('timeout detail', 408); },
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    await act(async () => { findButton(harness.environment.container, 'Confirmar alteração').click(); await flush(); });
    assert.equal(updates, 1);
    assert.match(harness.environment.container.textContent ?? '', /Não foi possível confirmar o resultado/);
    assert.doesNotMatch(harness.environment.container.textContent ?? '', /timeout detail/);
    assert.ok(findButton(harness.environment.container, 'Recarregar caso'));
    assert.equal(findButton(harness.environment.container, 'Confirmar alteração').disabled, true);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resposta tardia da transição é ignorada depois de fechar o caso', async () => {
  const pending = deferred<{ id: string; status: 'IN_REVIEW'; version: number; updatedAt: string }>();
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    updateStatus: async () => pending.promise,
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    await act(async () => { findButton(harness.environment.container, 'Confirmar alteração').click(); await flush(); });
    await act(async () => { findButton(harness.environment.container, 'Fechar detalhe').click(); await flush(); });
    await act(async () => { pending.resolve({ id: CASE_ID, status: 'IN_REVIEW', version: 2, updatedAt: '2026-07-20T12:05:00.000Z' }); await flush(); });
    assert.equal(harness.environment.container.querySelector('#review-case-detail-title'), null);
    assert.doesNotMatch(harness.environment.container.textContent ?? '', /Status alterado para/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resposta tardia da transição não atualiza outro caso após navegação', async () => {
  const pending = deferred<{ id: string; status: 'IN_REVIEW'; version: number; updatedAt: string }>();
  const secondDetail: FindingReviewCaseDetail = {
    ...detailResponse,
    id: SECOND_CASE_ID,
    findingId: SECOND_FINDING_ID,
  };
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async (id) => id === SECOND_CASE_ID ? secondDetail : detailResponse,
    updateStatus: async () => pending.promise,
  });
  try {
    await act(async () => { await flush(); });
    const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
    assert.ok(select);
    await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
    await act(async () => { findButton(harness.environment.container, 'Confirmar alteração').click(); await flush(); });
    harness.environment.window.history.pushState(null, '', `/conflict-review-cases?caseId=${SECOND_CASE_ID}`);
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.PopStateEvent('popstate'));
      await flush();
    });
    await act(async () => { pending.resolve({ id: CASE_ID, status: 'IN_REVIEW', version: 2, updatedAt: '2026-07-20T12:05:00.000Z' }); await flush(); });
    assert.match(harness.environment.container.textContent ?? '', new RegExp(SECOND_CASE_ID));
    assert.doesNotMatch(harness.environment.container.textContent ?? '', /Status alterado para/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resposta da transição após unmount não atualiza React', async () => {
  const pending = deferred<{ id: string; status: 'IN_REVIEW'; version: number; updatedAt: string }>();
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => detailResponse,
    updateStatus: async () => pending.promise,
  });
  await act(async () => { await flush(); });
  const select = harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status');
  assert.ok(select);
  await act(async () => { setControlValue(select, 'IN_REVIEW'); await flush(); });
  await act(async () => { findButton(harness.environment.container, 'Confirmar alteração').click(); await flush(); });
  await act(async () => harness.root.unmount());
  await act(async () => { pending.resolve({ id: CASE_ID, status: 'IN_REVIEW', version: 2, updatedAt: '2026-07-20T12:05:00.000Z' }); await flush(); });
  assert.equal(harness.environment.container.textContent, '');
  harness.environment.cleanup();
});

test('decisão elegível usa radios acessíveis, valida justificativa e confirma em dois passos', async () => {
  let calls = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => decisionReadyDetail,
    createDecision: async () => { calls += 1; return decisionResponse; },
  });
  try {
    await act(async () => { await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /Os registros investigados representam a mesma identidade de ativo/);
    assert.match(text, /Mesmo ativo/);
    assert.match(text, /Ativos diferentes/);
    const radios = harness.environment.container.querySelectorAll<HTMLInputElement>(
      'input[name="identity-conclusion"]',
    );
    assert.equal(radios.length, 2);

    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
    });
    assert.equal(harness.environment.window.document.activeElement, radios.item(0));
    assert.match(harness.environment.container.textContent ?? '', /Selecione uma conclusão/);

    await act(async () => { radios.item(0).click(); await flush(); });
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-decision-justification',
    );
    assert.ok(textarea);
    await act(async () => { setControlValue(textarea, '   \n  '); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
    });
    assert.equal(harness.environment.window.document.activeElement, textarea);
    assert.match(harness.environment.container.textContent ?? '', /Informe uma justificativa/);

    await act(async () => { setControlValue(textarea, 'a'.repeat(1001)); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
    });
    assert.match(harness.environment.container.textContent ?? '', /no máximo 1000 caracteres/);
    assert.match(harness.environment.container.textContent ?? '', /1001 \/ 1000/);

    await act(async () => { setControlValue(textarea, 'a'.repeat(1000)); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
    });
    assert.match(harness.environment.container.textContent ?? '', /Confirme a decisão/);
    await act(async () => {
      findButton(harness.environment.container, 'Voltar e editar').click();
      await flush();
    });

    const editedTextarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-decision-justification',
    );
    assert.ok(editedTextarea);
    await act(async () => {
      setControlValue(editedTextarea, '  Mesma identidade confirmada.  ');
      await flush();
    });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
    });
    assert.equal(calls, 0);
    assert.match(harness.environment.container.textContent ?? '', /Confirme a decisão/);
    assert.match(harness.environment.container.textContent ?? '', /não resolve o caso/);
    assert.ok(findButton(harness.environment.container, 'Registrar decisão'));
    await act(async () => {
      findButton(harness.environment.container, 'Voltar e editar').click();
      await flush();
    });
    assert.ok(harness.environment.container.querySelector('#review-decision-justification'));
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('registra decisão 201 uma vez, atualiza leitura local e preserva status', async () => {
  const calls: Array<{ conclusion: string; justification: string; version: number; key: string }> = [];
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => decisionReadyDetail,
    createDecision: async (_id, conclusion, justification, version, key) => {
      calls.push({ conclusion, justification, version, key });
      return decisionResponse;
    },
  });
  try {
    await act(async () => { await flush(); });
    const radio = harness.environment.container.querySelector<HTMLInputElement>(
      'input[value="SAME_ASSET"]',
    );
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-decision-justification',
    );
    assert.ok(radio && textarea);
    await act(async () => { radio.click(); await flush(); });
    await act(async () => { setControlValue(textarea, '  Mesma identidade confirmada.  '); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
    });
    const register = findButton(harness.environment.container, 'Registrar decisão');
    await act(async () => { register.click(); register.click(); await flush(); });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0] && {
      conclusion: calls[0].conclusion,
      justification: calls[0].justification,
      version: calls[0].version,
    }, {
      conclusion: 'SAME_ASSET',
      justification: 'Mesma identidade confirmada.',
      version: 2,
    });
    assert.match(calls[0]?.key ?? '', /^atlas-ui-/);
    const updated = harness.environment.container.textContent ?? '';
    assert.match(updated, /Decisão registrada com sucesso/);
    assert.match(updated, /Esta decisão não alterou automaticamente o inventário/);
    assert.match(updated, /Estado atual: Em análise/);
    assert.equal(harness.environment.container.querySelector('#review-decision-justification'), null);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resultado incerto persiste envelope e retry reutiliza chave e payload', async () => {
  const attempts: Array<{ conclusion: string; justification: string; version: number; key: string }> = [];
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => decisionReadyDetail,
    createDecision: async (_id, conclusion, justification, version, key) => {
      attempts.push({ conclusion, justification, version, key });
      if (attempts.length === 1) throw new ApiError('timeout', 408);
      return { ...decisionResponse, idempotentReplay: true };
    },
  });
  try {
    await act(async () => { await flush(); });
    const radio = harness.environment.container.querySelector<HTMLInputElement>(
      'input[value="SAME_ASSET"]',
    );
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>(
      '#review-decision-justification',
    );
    assert.ok(radio && textarea);
    await act(async () => { radio.click(); await flush(); });
    await act(async () => { setControlValue(textarea, 'Mesma identidade confirmada.'); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
      findButton(harness.environment.container, 'Registrar decisão').click();
      await flush();
    });
    const storageKey = `atlas:pending-review-decision:${CASE_ID}`;
    assert.ok(harness.environment.window.sessionStorage.getItem(storageKey));
    assert.match(harness.environment.container.textContent ?? '', /mesma chave idempotente será reutilizada/i);
    await act(async () => {
      findButton(harness.environment.container, 'Tentar novamente').click();
      await flush();
    });
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKey), null);
    assert.match(harness.environment.container.textContent ?? '', /recuperada com segurança/);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('resposta tardia da decisão de A não altera B e limpa somente o envelope de A', async () => {
  const pendingA = deferred<CreateFindingReviewDecisionResponse>();
  const secondDetail: FindingReviewCaseDetail = {
    ...decisionReadyDetail,
    id: SECOND_CASE_ID,
    findingId: SECOND_FINDING_ID,
    originalSnapshot: {
      snapshotVersion: 1,
      findingId: SECOND_FINDING_ID,
      reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
    },
  };
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async (id) => id === SECOND_CASE_ID ? secondDetail : decisionReadyDetail,
    createDecision: async () => pendingA.promise,
  });
  try {
    await act(async () => { await flush(); });
    await submitEligibleDecision(harness.environment.container);
    const storageKeyA = `atlas:pending-review-decision:${CASE_ID}`;
    const storageKeyB = `atlas:pending-review-decision:${SECOND_CASE_ID}`;

    harness.environment.window.history.pushState(
      null,
      '',
      `/conflict-review-cases?caseId=${SECOND_CASE_ID}`,
    );
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.PopStateEvent('popstate'));
      await flush();
    });
    assert.ok(harness.environment.window.sessionStorage.getItem(storageKeyA));

    const attemptB = createPendingFindingReviewDecisionAttempt(
      SECOND_CASE_ID,
      'DIFFERENT_ASSETS',
      'Tentativa incerta exclusiva de B.',
      2,
      'atlas-ui-decision-case-b',
    );
    harness.environment.window.sessionStorage.setItem(storageKeyB, JSON.stringify(attemptB));

    await act(async () => {
      pendingA.resolve(decisionResponse);
      await flush();
    });

    const visible = harness.environment.container.textContent ?? '';
    assert.match(visible, new RegExp(SECOND_CASE_ID));
    assert.doesNotMatch(visible, /Decisão registrada com sucesso/);
    assert.doesNotMatch(visible, /Mesma identidade confirmada/);
    assert.equal(harness.environment.window.sessionStorage.getItem(storageKeyA), null);
    assert.equal(
      harness.environment.window.sessionStorage.getItem(storageKeyB),
      JSON.stringify(attemptB),
    );
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('conflito de versão da decisão é conclusivo, não repete POST e exige recarga', async () => {
  const requests: string[] = [];
  let detailLoads = 0;
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => {
      detailLoads += 1;
      return decisionReadyDetail;
    },
    createDecision: async (_id, _conclusion, _justification, _version, key) => {
      requests.push(key);
      throw new ApiError('Versão obsoleta', 409, 'FINDING_REVIEW_CASE_VERSION_CONFLICT');
    },
  });
  try {
    await act(async () => { await flush(); });
    await submitEligibleDecision(harness.environment.container);
    assert.equal(requests.length, 1);
    assert.equal(new Set(requests).size, 1);
    assert.equal(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
      null,
    );
    assert.match(harness.environment.container.textContent ?? '', /caso foi alterado/i);
    assert.ok(findButton(harness.environment.container, 'Recarregar caso'));
    await act(async () => {
      findButton(harness.environment.container, 'Recarregar caso').click();
      await flush();
    });
    assert.equal(requests.length, 1);
    assert.ok(detailLoads >= 2);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('reutilização incompatível da chave é conclusiva e não cria nova tentativa', async () => {
  const requests: string[] = [];
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => decisionReadyDetail,
    createDecision: async (_id, _conclusion, _justification, _version, key) => {
      requests.push(key);
      throw new ApiError('Chave reutilizada', 409, 'IDEMPOTENCY_KEY_REUSED');
    },
  });
  try {
    await act(async () => { await flush(); });
    await submitEligibleDecision(harness.environment.container);
    assert.equal(requests.length, 1);
    assert.equal(new Set(requests).size, 1);
    assert.equal(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
      null,
    );
    assert.match(harness.environment.container.textContent ?? '', /não corresponde à operação original/i);
    assert.ok(findButton(harness.environment.container, 'Recarregar caso'));
    assert.equal(requests.length, 1);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('decisão já registrada recarrega o GET e apresenta a decisão persistida sem novo POST', async () => {
  let posts = 0;
  let detailLoads = 0;
  const persistedDetail: FindingReviewCaseDetail = {
    ...decisionReadyDetail,
    version: decisionResponse.decision.caseVersion,
    currentDecision: decisionResponse.decision,
    decisionHistory: [decisionResponse.decision],
  };
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => {
      detailLoads += 1;
      return detailLoads === 1 ? decisionReadyDetail : persistedDetail;
    },
    createDecision: async () => {
      posts += 1;
      throw new ApiError(
        'Decisão existente',
        409,
        'FINDING_REVIEW_CASE_DECISION_ALREADY_RECORDED',
      );
    },
  });
  try {
    await act(async () => { await flush(); });
    await submitEligibleDecision(harness.environment.container);
    await act(async () => { await flush(); });
    assert.equal(posts, 1);
    assert.ok(detailLoads >= 2);
    assert.equal(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
      null,
    );
    assert.match(harness.environment.container.textContent ?? '', /Mesma identidade confirmada/);
    assert.equal(harness.environment.container.querySelector('#review-decision-justification'), null);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('decisão não permitida é conclusiva e o GET atualizado remove o formulário', async () => {
  let posts = 0;
  let detailLoads = 0;
  const noLongerEligible: FindingReviewCaseDetail = {
    ...decisionReadyDetail,
    status: 'WAITING_FOR_EVIDENCE',
  };
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => {
      detailLoads += 1;
      return detailLoads === 1 ? decisionReadyDetail : noLongerEligible;
    },
    createDecision: async () => {
      posts += 1;
      throw new ApiError('Decisão não permitida', 422, 'FINDING_REVIEW_CASE_DECISION_NOT_ALLOWED');
    },
  });
  try {
    await act(async () => { await flush(); });
    await submitEligibleDecision(harness.environment.container);
    await act(async () => { await flush(); });
    assert.equal(posts, 1);
    assert.ok(detailLoads >= 2);
    assert.equal(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
      null,
    );
    assert.match(harness.environment.container.textContent ?? '', /Retome a revisão/);
    assert.equal(harness.environment.container.querySelector('#review-decision-justification'), null);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('respostas 404 e 503 da decisão são conclusivas, seguras e sem retry', async (context) => {
  const scenarios = [
    { status: 404, expected: /caso não foi encontrado/i },
    { status: 503, expected: /indisponível neste ambiente/i },
  ] as const;
  for (const scenario of scenarios) {
    await context.test(`HTTP ${scenario.status}`, async () => {
      const requests: string[] = [];
      const harness = await renderPage({
        initialSearchParams: { caseId: CASE_ID },
        loadCases: async () => listResponse,
        loadDetail: async () => decisionReadyDetail,
        createDecision: async (_id, _conclusion, _justification, _version, key) => {
          requests.push(key);
          throw new ApiError(`HTTP ${scenario.status}`, scenario.status);
        },
      });
      try {
        await act(async () => { await flush(); });
        await submitEligibleDecision(harness.environment.container);
        assert.equal(requests.length, 1);
        assert.equal(new Set(requests).size, 1);
        assert.equal(
          harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
          null,
        );
        assert.match(harness.environment.container.textContent ?? '', scenario.expected);
      } finally {
        await close(harness.root, harness.environment.cleanup);
      }
    });
  }
});

test('envelope de decisão valida TTL e permanece isolado por caso', () => {
  const now = Date.parse('2026-08-22T12:00:00.000Z');
  const attempt = createPendingFindingReviewDecisionAttempt(
    CASE_ID,
    'DIFFERENT_ASSETS',
    'São ativos distintos.',
    2,
    'atlas-ui-decision-key',
    now,
  );
  assert.equal(parsePendingFindingReviewDecisionAttempt(JSON.stringify(attempt), CASE_ID, now)?.caseId, CASE_ID);
  assert.equal(parsePendingFindingReviewDecisionAttempt(
    JSON.stringify(attempt),
    CASE_ID,
    now + PENDING_REVIEW_DECISION_ATTEMPT_TTL_MS,
  ), null);
  assert.equal(parsePendingFindingReviewDecisionAttempt(JSON.stringify(attempt), SECOND_CASE_ID, now), null);
  assert.equal(parsePendingFindingReviewDecisionAttempt(JSON.stringify({ ...attempt, extra: true }), CASE_ID, now), null);
});

test('exibe decisão atual, histórico múltiplo e evento traduzido sem fingerprint', async () => {
  const firstDecision = decisionResponse.decision;
  const secondDecision = {
    ...firstDecision,
    id: '77777777-7777-4777-8777-777777777777',
    identityConclusion: 'DIFFERENT_ASSETS' as const,
    justification: 'Conclusão\nreavaliada no histórico.',
    caseVersion: 4,
    createdAt: '2026-07-20T12:20:00.000Z',
  };
  const withDecision: FindingReviewCaseDetail = {
    ...decisionReadyDetail,
    version: 4,
    currentDecision: secondDecision,
    decisionHistory: [firstDecision, secondDecision],
    events: [...decisionReadyDetail.events, {
      id: '88888888-8888-4888-8888-888888888888',
      eventType: 'CASE_DECISION_RECORDED',
      versionBefore: 3,
      versionAfter: 4,
      actor: 'atlas-mvp-user',
      metadata: {
        identityConclusion: 'DIFFERENT_ASSETS',
        decisionId: secondDecision.id,
      },
      createdAt: secondDecision.createdAt,
    }],
  };
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => withDecision,
  });
  try {
    await act(async () => { await flush(); });
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /Ativos diferentes/);
    assert.match(text, /Conclusão\s+reavaliada no histórico/);
    assert.match(text, /Histórico de decisões \(2\)/);
    assert.match(text, /Decisão de identidade registrada/);
    assert.match(text, /Conclusão: Ativos diferentes/);
    assert.doesNotMatch(text, /requestFingerprint/);
    assert.doesNotMatch(text, new RegExp(secondDecision.id));
    assert.equal(harness.environment.container.querySelector('#review-decision-justification'), null);
  } finally {
    await close(harness.root, harness.environment.cleanup);
  }
});

test('decisão em voo bloqueia transição de status', async () => {
  const pending = deferred<CreateFindingReviewDecisionResponse>();
  const harness = await renderPage({
    initialSearchParams: { caseId: CASE_ID },
    loadCases: async () => listResponse,
    loadDetail: async () => decisionReadyDetail,
    createDecision: async () => pending.promise,
  });
  let unmounted = false;
  try {
    await act(async () => { await flush(); });
    const radio = harness.environment.container.querySelector<HTMLInputElement>('input[value="SAME_ASSET"]');
    const textarea = harness.environment.container.querySelector<HTMLTextAreaElement>('#review-decision-justification');
    assert.ok(radio && textarea);
    await act(async () => { radio.click(); await flush(); });
    await act(async () => { setControlValue(textarea, 'Mesma identidade confirmada.'); await flush(); });
    await act(async () => {
      findButton(harness.environment.container, 'Revisar decisão').click();
      await flush();
      findButton(harness.environment.container, 'Registrar decisão').click();
      await flush();
    });
    assert.equal(
      harness.environment.container.querySelector<HTMLSelectElement>('#review-case-next-status')?.disabled,
      true,
    );
    assert.equal(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
      null,
    );
    await act(async () => harness.root.unmount());
    unmounted = true;
    assert.ok(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
    );
    await act(async () => { pending.resolve(decisionResponse); await flush(); });
    assert.equal(
      harness.environment.window.sessionStorage.getItem(`atlas:pending-review-decision:${CASE_ID}`),
      null,
    );
    assert.equal(harness.environment.container.textContent, '');
  } finally {
    if (!unmounted) await act(async () => harness.root.unmount());
    harness.environment.cleanup();
  }
});
