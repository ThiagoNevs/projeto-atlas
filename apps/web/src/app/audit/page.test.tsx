import assert from 'node:assert/strict';
import test from 'node:test';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  AuditPage,
  getAuditEntityHref,
  getAuditPresentedValueLabel,
  type AuditLogsLoader,
} from './page.tsx';
import type { AuditLogRecord, AuditLogResponse } from '../../lib/api.ts';
import {
  getAuditActionLabel,
  getAuditEntityTypeLabel,
} from '../../lib/labels.ts';
import {
  createJsdomTestEnvironment,
  type JsdomTestEnvironment,
} from '../../test/jsdom-test-environment.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const emptyResponse: AuditLogResponse = {
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
};

function auditLog(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    actorType: 'USER',
    actorId: 'atlas-mvp-user',
    action: 'CASE_STATUS_CHANGED',
    entityType: 'FindingReviewCase',
    entityId: CASE_ID,
    before: { status: 'OPEN' },
    after: { status: 'WAITING_FOR_EVIDENCE' },
    metadata: null,
    occurredAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

function response(items: AuditLogRecord[]): AuditLogResponse {
  return {
    ...emptyResponse,
    items,
    total: items.length,
    totalPages: items.length > 0 ? 1 : 0,
    summary: { ...emptyResponse.summary, total: items.length },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function setControlValue(control: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

async function renderPage(
  loadAuditLogs: AuditLogsLoader,
  environment = createJsdomTestEnvironment(),
) {
  const root: Root = createRoot(environment.container);
  await act(async () => {
    root.render(createElement(AuditPage, { loadAuditLogs }));
    await flush();
  });
  return { environment, root };
}

async function close(root: Root, environment: JsdomTestEnvironment): Promise<void> {
  await act(async () => root.unmount());
  environment.cleanup();
}

test('traduz ações, entidade e todos os estados dos casos de revisão', () => {
  assert.equal(getAuditActionLabel('CASE_CREATED'), 'Caso de revisão criado');
  assert.equal(getAuditActionLabel('CASE_STATUS_CHANGED'), 'Status do caso de revisão alterado');
  assert.equal(getAuditEntityTypeLabel('FindingReviewCase'), 'Caso de revisão');
  assert.deepEqual(
    ['OPEN', 'IN_REVIEW', 'WAITING_FOR_EVIDENCE', 'RESOLVED', 'DISMISSED', 'CANCELLED']
      .map((status) => getAuditPresentedValueLabel('FindingReviewCase', status)),
    ['Aberto', 'Em análise', 'Aguardando evidências', 'Resolvido', 'Descartado', 'Cancelado'],
  );
});

test('gera deep link somente para caso de revisão com identificador válido', () => {
  assert.equal(
    getAuditEntityHref('FindingReviewCase', CASE_ID),
    `/conflict-review-cases?caseId=${encodeURIComponent(CASE_ID)}`,
  );
  assert.equal(getAuditEntityHref('Asset', CASE_ID), null);
  assert.equal(getAuditEntityHref('FindingReviewCase', ''), null);
  assert.equal(getAuditEntityHref('FindingReviewCase', 'id-invalido'), null);
  assert.equal(getAuditEntityHref('FindingReviewCase', undefined), null);
});

test('exibe eventos de caso em português, deep link válido e preserva evento existente', async () => {
  const harness = await renderPage(async () => response([
    auditLog(),
    auditLog({
      id: '33333333-3333-4333-8333-333333333333',
      action: 'ADMIN_STATUS_CHANGED',
      entityType: 'Asset',
      entityId: '44444444-4444-4444-8444-444444444444',
      before: { administrativeStatus: 'IN_USE' },
      after: { administrativeStatus: 'MAINTENANCE' },
    }),
    auditLog({
      id: '55555555-5555-4555-8555-555555555555',
      entityId: 'inválido',
    }),
  ]));
  try {
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /Status do caso de revisão alterado/);
    assert.match(text, /Caso de revisão/);
    assert.match(text, /Aberto/);
    assert.match(text, /Aguardando evidências/);
    assert.match(text, /Status administrativo alterado/);
    assert.match(text, /Em uso/);
    assert.match(text, /Em manutenção/);

    const caseDetails = harness.environment.container.querySelector('details');
    assert.ok(caseDetails);
    caseDetails.open = true;
    const caseJson = [...caseDetails.querySelectorAll('pre')].map((entry) => entry.textContent).join(' ');
    assert.match(caseJson, /Aberto/);
    assert.match(caseJson, /Aguardando evidências/);
    assert.doesNotMatch(caseJson, /WAITING_FOR_EVIDENCE/);

    const links = [...harness.environment.container.querySelectorAll('a')]
      .filter((link) => link.textContent?.trim() === 'Abrir caso de revisão');
    assert.equal(links.length, 1);
    assert.equal(links[0]?.getAttribute('href'), `/conflict-review-cases?caseId=${CASE_ID}`);
  } finally {
    await close(harness.root, harness.environment);
  }
});

test('apresenta metadata.justification explicitamente como Justificativa', async () => {
  const harness = await renderPage(async () => response([auditLog({
    metadata: { justification: 'Aguardando confirmação da fonte técnica.' },
  })]));
  try {
    const text = harness.environment.container.textContent ?? '';
    assert.match(text, /Justificativa: Aguardando confirmação da fonte técnica\./);
    assert.doesNotMatch(text, /Comentário: Aguardando confirmação/);
  } finally {
    await close(harness.root, harness.environment);
  }
});

test('filtros apresentam labels e enviam valores técnicos inalterados', async () => {
  const queries: Parameters<AuditLogsLoader>[0][] = [];
  const harness = await renderPage(async (query) => {
    queries.push(query);
    return emptyResponse;
  });
  try {
    const selects = harness.environment.container.querySelectorAll('select');
    const action = selects.item(0);
    const entityType = selects.item(1);
    const form = harness.environment.container.querySelector('form');
    assert.ok(form);

    assert.match(action.textContent ?? '', /Caso de revisão criado/);
    assert.match(action.textContent ?? '', /Status do caso de revisão alterado/);
    assert.match(entityType.textContent ?? '', /Caso de revisão/);

    await act(async () => {
      setControlValue(action, 'CASE_CREATED');
      setControlValue(entityType, 'FindingReviewCase');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    assert.equal(queries.at(-1)?.action, 'CASE_CREATED');
    assert.equal(queries.at(-1)?.entityType, 'FindingReviewCase');

    await act(async () => {
      setControlValue(action, 'CASE_STATUS_CHANGED');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    assert.equal(queries.at(-1)?.action, 'CASE_STATUS_CHANGED');
    assert.equal(queries.at(-1)?.entityType, 'FindingReviewCase');
  } finally {
    await close(harness.root, harness.environment);
  }
});

test('mantém o estado vazio da auditoria', async () => {
  const harness = await renderPage(async () => emptyResponse);
  try {
    assert.match(
      harness.environment.container.textContent ?? '',
      /Nenhum registro de auditoria encontrado/,
    );
  } finally {
    await close(harness.root, harness.environment);
  }
});

test('mantém o tratamento de erro da auditoria', async () => {
  const harness = await renderPage(async () => {
    throw new Error('Falha controlada ao carregar auditoria.');
  });
  try {
    assert.match(
      harness.environment.container.textContent ?? '',
      /Falha controlada ao carregar auditoria\./,
    );
  } finally {
    await close(harness.root, harness.environment);
  }
});
