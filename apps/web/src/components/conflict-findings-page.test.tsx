import assert from 'node:assert/strict';
import test from 'node:test';

import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

import {
  ConflictFindingsPage,
  type ConflictFindingDetailLoader,
  type ConflictFindingsLoader,
} from './conflict-findings-page.tsx';
import type {
  ConflictFindingDetail,
  ConflictFindingListItem,
  ConflictFindingType,
  ConflictFindingsResponse,
  IdentityNetworkAnalysisResponse,
} from '../lib/api.ts';
import {
  createJsdomTestEnvironment,
  type JsdomTestEnvironment,
} from '../test/jsdom-test-environment.ts';

const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = '22222222-2222-4222-8222-222222222222';
const ASSET_C = '33333333-3333-4333-8333-333333333333';
const FINDING_A = 'finding_0123456789abcdef01234567';
const FINDING_B = 'finding_aaaaaaaaaaaaaaaaaaaaaaaa';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type ListCall = {
  query: Parameters<ConflictFindingsLoader>[0];
  signal: AbortSignal;
  request: Deferred<ConflictFindingsResponse>;
};

type DetailCall = {
  assetId: string;
  signal: AbortSignal;
  request: Deferred<IdentityNetworkAnalysisResponse>;
};

type Harness = {
  container: HTMLDivElement;
  environment: JsdomTestEnvironment;
  render: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function item(
  type: ConflictFindingType = 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  overrides: Partial<ConflictFindingListItem> = {},
): ConflictFindingListItem {
  return {
    findingId: FINDING_A,
    type,
    requiresHumanReview: true,
    affectedAssetIds: [ASSET_A, ASSET_B],
    affectedAssets: [
      { assetId: ASSET_A, persistedName: 'SRV-APP-01' },
      { assetId: ASSET_B, persistedName: 'SRV-APP-02' },
    ],
    normalizedHostname: type === 'SHARED_IP_DIFFERENT_HOSTNAMES' ? null : 'srv-app',
    normalizedIp: type === 'SHARED_IP_DIFFERENT_HOSTNAMES' ? '2001:db8::10' : null,
    temporalContext: {
      firstObservedAt: '2026-07-15T10:00:00.000Z',
      lastObservedAt: '2026-07-15T11:00:00.000Z',
      differenceMilliseconds: 3_600_000,
      relationship: 'DISTINCT_OBSERVATION_TIMES',
    },
    sourceTypes: ['TECHNICAL', 'SIMULATED', 'UNKNOWN'],
    observationCount: 3,
    currentObservationCount: 2,
    historicalObservationCount: 1,
    explanationSummary: 'O Atlas identificou dados que podem ser incompatíveis.',
    limitationCount: 1,
    reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS', 'NEEDS_MORE_EVIDENCE'],
    ...overrides,
  };
}

function response(
  items: ConflictFindingListItem[] = [item()],
  overrides: Partial<ConflictFindingsResponse> = {},
): ConflictFindingsResponse {
  return {
    mode: 'SHADOW',
    policyVersion: '2026-07-conflict-v1',
    generatedAt: '2026-07-15T12:00:00.000Z',
    decisionsChanged: false,
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: items.length ? 1 : 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    filters: {
      type: null,
      assetId: null,
      hostname: null,
      ip: null,
      sourceType: null,
      temporalRelationship: null,
      hasLimitations: null,
    },
    summary: {
      totalFindings: items.length,
      affectedAssets: new Set(items.flatMap((entry) => entry.affectedAssetIds)).size,
      findingsWithLimitations: items.filter((entry) => entry.limitationCount > 0).length,
      byType: {
        DUPLICATE_HOSTNAME_ACROSS_ASSETS: items.filter((entry) => entry.type === 'DUPLICATE_HOSTNAME_ACROSS_ASSETS').length,
        SHARED_IP_DIFFERENT_HOSTNAMES: items.filter((entry) => entry.type === 'SHARED_IP_DIFFERENT_HOSTNAMES').length,
        HOSTNAME_DIVERGENCE_ON_ASSET: items.filter((entry) => entry.type === 'HOSTNAME_DIVERGENCE_ON_ASSET').length,
      },
    },
    items,
    limitations: ['A análise não determina a identidade correta.', 'Nenhuma decisão é persistida.'],
    ...overrides,
  };
}

function detail(
  listItem: ConflictFindingListItem = item(),
  overrides: Partial<ConflictFindingDetail> = {},
): ConflictFindingDetail {
  return {
    findingId: listItem.findingId,
    type: listItem.type,
    mode: 'SHADOW',
    requiresHumanReview: true,
    affectedAssetIds: listItem.affectedAssetIds,
    normalizedHostname: listItem.normalizedHostname,
    normalizedIp: listItem.normalizedIp,
    observations: [
      {
        assetId: listItem.affectedAssetIds[0]!,
        value: 'SRV-APP',
        normalizedValue: 'srv-app',
        attribute: 'HOSTNAME',
        source: 'inventory-agent',
        sourceType: 'TECHNICAL',
        evidenceId: '44444444-4444-4444-8444-444444444444',
        observedAt: '2026-07-15T10:00:00.000Z',
        ingestedAt: '2026-07-15T10:01:00.000Z',
        current: true,
      },
    ],
    temporalContext: listItem.temporalContext,
    explanation: ['Os registros precisam de revisão humana.'],
    limitations: ['O Atlas não escolhe uma fonte vencedora.'],
    reviewOptions: listItem.reviewOptions,
    ...overrides,
  };
}

function individual(
  listItem: ConflictFindingListItem = item(),
  findings: ConflictFindingDetail[] = [detail(listItem)],
): IdentityNetworkAnalysisResponse {
  return {
    assetId: listItem.affectedAssetIds[0]!,
    mode: 'SHADOW',
    policyVersion: '2026-07-conflict-v1',
    generatedAt: '2026-07-15T12:00:00.000Z',
    summary: { totalFindings: findings.length, requiresHumanReview: findings.length },
    findings,
    limitations: ['Nenhuma decisão é persistida.'],
    decisionsChanged: false,
  };
}

function controlledLoaders(): {
  listCalls: ListCall[];
  detailCalls: DetailCall[];
  list: ConflictFindingsLoader;
  detail: ConflictFindingDetailLoader;
} {
  const listCalls: ListCall[] = [];
  const detailCalls: DetailCall[] = [];
  return {
    listCalls,
    detailCalls,
    list: (query, options) => {
      const request = deferred<ConflictFindingsResponse>();
      listCalls.push({ query, signal: options?.signal ?? new AbortController().signal, request });
      return request.promise;
    },
    detail: (assetId, options) => {
      const request = deferred<IdentityNetworkAnalysisResponse>();
      detailCalls.push({ assetId, signal: options?.signal ?? new AbortController().signal, request });
      return request.promise;
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function resolveInsideAct<T>(request: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    request.resolve(value);
    await flush();
  });
}

async function rejectInsideAct<T>(request: Deferred<T>, reason: unknown): Promise<void> {
  await act(async () => {
    request.reject(reason);
    await flush();
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await flush();
  });
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  });
}

function button(container: Element, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((entry) => entry.textContent?.includes(text));
  assert.ok(found, `botão ${text} deveria existir`);
  return found;
}

async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
  const environment = createJsdomTestEnvironment();
  const { createRoot } = await import('react-dom/client');
  const root: Root = createRoot(environment.container);
  const messages: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  let mounted = true;
  let failure: unknown = null;
  console.error = (...args: unknown[]) => messages.push(`error: ${args.map(String).join(' ')}`);
  console.warn = (...args: unknown[]) => messages.push(`warn: ${args.map(String).join(' ')}`);

  const unmount = async (): Promise<void> => {
    if (!mounted) return;
    await act(async () => {
      root.unmount();
      await flush();
    });
    mounted = false;
  };

  try {
    await run({
      container: environment.container,
      environment,
      render: async (node) => {
        await act(async () => {
          root.render(node);
          await flush();
        });
      },
      unmount,
    });
  } catch (error) {
    failure = error;
  }

  try {
    await unmount();
  } catch (error) {
    failure ??= error;
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    environment.cleanup();
  }

  if (failure) throw failure;
  assert.deepEqual(messages, [], 'o componente não deve emitir warnings no console');
}

async function renderLoaded(
  harness: Harness,
  loadedResponse: ConflictFindingsResponse = response(),
) {
  const loaders = controlledLoaders();
  await harness.render(createElement(ConflictFindingsPage, { loadFindings: loaders.list, loadDetail: loaders.detail }));
  assert.equal(loaders.listCalls.length, 1);
  await resolveInsideAct(loaders.listCalls[0]!.request, loadedResponse);
  return loaders;
}

test('mostra loading inicial e aviso obrigatório de modo sombra', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { loadFindings: loaders.list, loadDetail: loaders.detail }));
    assert.match(harness.container.textContent ?? '', /Carregando achados/);
    assert.match(harness.container.textContent ?? '', /Nenhum conflito formal foi criado/);
  });
});

test('renderiza sucesso, título e subtítulo sem linguagem de confirmação', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const text = harness.container.textContent ?? '';
    assert.match(text, /Achados de identidade e rede/);
    assert.match(text, /podem precisar de revisão humana/);
    assert.doesNotMatch(text, /conflito confirmado/i);
  });
});

test('usa o resumo global retornado, não o tamanho da página', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness, response([item()], { summary: { totalFindings: 38, affectedAssets: 25, findingsWithLimitations: 8, byType: { DUPLICATE_HOSTNAME_ACROSS_ASSETS: 20, SHARED_IP_DIFFERENT_HOSTNAMES: 10, HOSTNAME_DIVERGENCE_ON_ASSET: 8 } } }));
    assert.match(harness.container.textContent ?? '', /38/);
    assert.match(harness.container.textContent ?? '', /25/);
    assert.match(harness.container.textContent ?? '', /todos os resultados filtrados/);
  });
});

for (const [type, label] of [
  ['DUPLICATE_HOSTNAME_ACROSS_ASSETS', 'Hostname associado a ativos diferentes'],
  ['SHARED_IP_DIFFERENT_HOSTNAMES', 'IP associado a hostnames diferentes'],
  ['HOSTNAME_DIVERGENCE_ON_ASSET', 'Hostname divergente no mesmo ativo'],
] as const) {
  test(`renderiza o tipo ${type} com label amigável`, async () => {
    await withHarness(async (harness) => {
      await renderLoaded(harness, response([item(type)]));
      assert.match(harness.container.textContent ?? '', new RegExp(label));
      assert.doesNotMatch(harness.container.textContent ?? '', new RegExp(type));
    });
  });
}

test('mostra todos os ativos afetados como equivalentes e com links internos', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const links = [...harness.container.querySelectorAll('.finding-asset-links a')];
    assert.equal(links.length, 2);
    assert.equal(links[0]?.getAttribute('href'), `/assets/${ASSET_A}`);
    assert.equal(links[1]?.getAttribute('href'), `/assets/${ASSET_B}`);
    assert.doesNotMatch(harness.container.textContent ?? '', /ativo principal|vencedor/i);
  });
});

test('mantém fontes simulada e desconhecida visíveis sem ranking', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const text = harness.container.textContent ?? '';
    assert.match(text, /Técnica/);
    assert.match(text, /Simulada/);
    assert.match(text, /Desconhecida/);
    assert.doesNotMatch(text, /fonte correta|preferencial/i);
  });
});

test('mostra contexto temporal e diferença sem classificar o conflito', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const text = harness.container.textContent ?? '';
    assert.match(text, /Instantes de observação diferentes/);
    assert.match(text, /1 hora/);
    assert.doesNotMatch(text, /provável conflito|simultâneo/i);
  });
});

test('exibe aviso específico para IP sem apresentá-lo como identidade', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness, response([item('SHARED_IP_DIFFERENT_HOSTNAMES')]));
    assert.match(harness.container.textContent ?? '', /compartilhamento do IP não comprova/);
    assert.doesNotMatch(harness.container.textContent ?? '', /IP principal|identidade pelo IP/i);
  });
});

test('apresenta limitações globais apenas em área expansível', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const details = harness.container.querySelector('details.finding-global-limitations');
    assert.ok(details);
    assert.match(details.textContent ?? '', /Nenhuma decisão é persistida/);
  });
});

test('mostra vazio global quando não existem achados', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness, response([]));
    assert.match(harness.container.textContent ?? '', /Nenhum achado foi identificado no inventário atual/);
  });
});

test('mostra vazio filtrado quando a URL contém filtros', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { initialSearchParams: { hostname: 'sem resultado' }, loadFindings: loaders.list, loadDetail: loaders.detail }));
    await resolveInsideAct(loaders.listCalls[0]!.request, response([]));
    assert.match(harness.container.textContent ?? '', /Nenhum achado corresponde aos filtros aplicados/);
  });
});

test('mostra erro inicial amigável e permite retry', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { loadFindings: loaders.list, loadDetail: loaders.detail }));
    await rejectInsideAct(loaders.listCalls[0]!.request, new Error('Serviço indisponível.'));
    assert.match(harness.container.textContent ?? '', /Serviço indisponível/);
    await click(button(harness.container, 'Tentar novamente'));
    assert.equal(loaders.listCalls.length, 2);
  });
});

test('aplica filtro somente após o botão e sincroniza a URL', async () => {
  await withHarness(async (harness) => {
    const loaders = await renderLoaded(harness);
    const input = harness.container.querySelector('input[placeholder="Ex.: SRV-APP-01"]') as HTMLInputElement;
    await change(input, 'SRV TESTE');
    assert.equal(loaders.listCalls.length, 1);
    await click(button(harness.container, 'Aplicar filtros'));
    assert.equal(loaders.listCalls.length, 2);
    assert.equal(loaders.listCalls[1]?.query.hostname, 'SRV TESTE');
    assert.equal(harness.environment.window.location.search.includes('hostname=SRV+TESTE'), true);
  });
});

test('combina filtros, ordenação, direção e itens por página', async () => {
  await withHarness(async (harness) => {
    const loaders = await renderLoaded(harness);
    const selects = [...harness.container.querySelectorAll('select')];
    await change(selects[0]!, 'SHARED_IP_DIFFERENT_HOSTNAMES');
    await change(selects[1]!, 'TECHNICAL');
    await change(selects[4]!, 'observationCount');
    await change(selects[5]!, 'desc');
    await change(selects[6]!, '50');
    await click(button(harness.container, 'Aplicar filtros'));
    const query = loaders.listCalls[1]?.query;
    assert.equal(query?.type, 'SHARED_IP_DIFFERENT_HOSTNAMES');
    assert.equal(query?.sourceType, 'TECHNICAL');
    assert.equal(query?.sortBy, 'observationCount');
    assert.equal(query?.sortDirection, 'desc');
    assert.equal(query?.pageSize, 50);
  });
});

test('preserva hasLimitations=false na chamada e na URL', async () => {
  await withHarness(async (harness) => {
    const loaders = await renderLoaded(harness);
    const limitations = [...harness.container.querySelectorAll('select')][3]!;
    await change(limitations, 'false');
    await click(button(harness.container, 'Aplicar filtros'));
    assert.equal(loaders.listCalls[1]?.query.hasLimitations, false);
    assert.match(harness.environment.window.location.search, /hasLimitations=false/);
  });
});

test('limpar filtros restaura defaults e remove filtros da URL', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { initialSearchParams: { hostname: 'SRV', page: '3' }, loadFindings: loaders.list, loadDetail: loaders.detail }));
    await resolveInsideAct(loaders.listCalls[0]!.request, response());
    await click(button(harness.container, 'Limpar filtros'));
    assert.equal(loaders.listCalls[1]?.query.hostname, undefined);
    assert.equal(loaders.listCalls[1]?.query.page, 1);
    assert.equal(harness.environment.window.location.pathname, '/conflict-findings');
  });
});

test('pagina respeitando flags do backend e mantendo filtros', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { initialSearchParams: { hostname: 'SRV' }, loadFindings: loaders.list, loadDetail: loaders.detail }));
    await resolveInsideAct(loaders.listCalls[0]!.request, response([item()], { pagination: { page: 1, pageSize: 25, totalItems: 40, totalPages: 2, hasNextPage: true, hasPreviousPage: false } }));
    const previous = button(harness.container, 'Anterior');
    assert.equal(previous.disabled, true);
    await click(button(harness.container, 'Próxima'));
    assert.equal(loaders.listCalls[1]?.query.page, 2);
    assert.equal(loaders.listCalls[1]?.query.hostname, 'SRV');
  });
});

test('resposta antiga da lista não substitui a nova', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { loadFindings: loaders.list, loadDetail: loaders.detail }));
    const input = harness.container.querySelector('input[placeholder="Ex.: SRV-APP-01"]') as HTMLInputElement;
    await change(input, 'NOVO');
    await click(button(harness.container, 'Aplicar filtros'));
    assert.equal(loaders.listCalls.length, 2);
    await resolveInsideAct(loaders.listCalls[1]!.request, response([item('DUPLICATE_HOSTNAME_ACROSS_ASSETS', { explanationSummary: 'Resposta nova.' })]));
    await resolveInsideAct(loaders.listCalls[0]!.request, response([item('DUPLICATE_HOSTNAME_ACROSS_ASSETS', { explanationSummary: 'Resposta antiga.' })]));
    assert.match(harness.container.textContent ?? '', /Resposta nova/);
    assert.doesNotMatch(harness.container.textContent ?? '', /Resposta antiga/);
  });
});

test('unmount cancela a requisição agregada', async () => {
  await withHarness(async (harness) => {
    const loaders = controlledLoaders();
    await harness.render(createElement(ConflictFindingsPage, { loadFindings: loaders.list, loadDetail: loaders.detail }));
    await harness.unmount();
    assert.equal(loaders.listCalls[0]?.signal.aborted, true);
  });
});

test('nenhuma chamada individual ocorre ao carregar os cards', async () => {
  await withHarness(async (harness) => {
    const loaders = await renderLoaded(harness, response([item(), item('HOSTNAME_DIVERGENCE_ON_ASSET', { findingId: FINDING_B, affectedAssetIds: [ASSET_C], affectedAssets: [{ assetId: ASSET_C, persistedName: 'VM-WEB-02' }] })]));
    assert.equal(loaders.detailCalls.length, 0);
  });
});

test('abrir detalhe dispara uma única chamada para o primeiro ID ordenado pelo backend', async () => {
  await withHarness(async (harness) => {
    const listItem = item();
    const loaders = await renderLoaded(harness, response([listItem]));
    await click(button(harness.container, 'Ver análise detalhada'));
    assert.equal(loaders.detailCalls.length, 1);
    assert.equal(loaders.detailCalls[0]?.assetId, ASSET_A);
    assert.match(harness.container.textContent ?? '', /referência técnica da consulta/);
  });
});

test('detalhe é localizado pelo mesmo findingId e mostra observações seguras', async () => {
  await withHarness(async (harness) => {
    const listItem = item();
    const loaders = await renderLoaded(harness, response([listItem]));
    await click(button(harness.container, 'Ver análise detalhada'));
    await resolveInsideAct(loaders.detailCalls[0]!.request, individual(listItem));
    const text = harness.container.textContent ?? '';
    assert.match(text, /Valor original/);
    assert.match(text, /inventory-agent/);
    assert.match(text, /44444444-4444-4444-8444-444444444444/);
    assert.match(text, /O Atlas não escolhe uma fonte vencedora/);
  });
});

test('finding ausente no detalhe mostra mensagem de estado desatualizado', async () => {
  await withHarness(async (harness) => {
    const listItem = item();
    const loaders = await renderLoaded(harness, response([listItem]));
    await click(button(harness.container, 'Ver análise detalhada'));
    await resolveInsideAct(loaders.detailCalls[0]!.request, individual(listItem, []));
    assert.match(harness.container.textContent ?? '', /pode ter mudado porque o inventário foi atualizado/);
  });
});

test('finding semanticamente diferente não é usado como detalhe', async () => {
  await withHarness(async (harness) => {
    const listItem = item();
    const loaders = await renderLoaded(harness, response([listItem]));
    await click(button(harness.container, 'Ver análise detalhada'));
    await resolveInsideAct(loaders.detailCalls[0]!.request, individual(listItem, [detail(listItem, { affectedAssetIds: [ASSET_A] })]));
    assert.match(harness.container.textContent ?? '', /pode ter mudado/);
  });
});

test('falha e retry do detalhe ficam isolados da lista', async () => {
  await withHarness(async (harness) => {
    const loaders = await renderLoaded(harness);
    await click(button(harness.container, 'Ver análise detalhada'));
    await rejectInsideAct(loaders.detailCalls[0]!.request, new Error('Detalhe indisponível.'));
    assert.match(harness.container.textContent ?? '', /Detalhe indisponível/);
    assert.match(harness.container.textContent ?? '', /Hostname associado a ativos diferentes/);
    await click(button(harness.container, 'Tentar novamente'));
    assert.equal(loaders.detailCalls.length, 2);
  });
});

test('fechar detalhe cancela a chamada e restaura o foco ao acionador', async () => {
  await withHarness(async (harness) => {
    const loaders = await renderLoaded(harness);
    const trigger = button(harness.container, 'Ver análise detalhada');
    await click(trigger);
    assert.equal(harness.environment.window.document.activeElement?.textContent?.includes('Fechar'), true);
    await click(button(harness.container, 'Fechar'));
    await act(async () => {
      await new Promise<void>((resolve) => harness.environment.window.requestAnimationFrame(() => resolve()));
    });
    assert.equal(loaders.detailCalls[0]?.signal.aborted, true);
    assert.equal(harness.environment.window.document.activeElement, trigger);
  });
});

test('Escape fecha o painel de detalhe', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    await click(button(harness.container, 'Ver análise detalhada'));
    await act(async () => {
      harness.environment.window.dispatchEvent(new harness.environment.window.KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();
    });
    assert.equal(harness.container.querySelector('[role="dialog"]'), null);
  });
});

test('troca rápida de detalhes cancela o anterior e ignora sua resposta', async () => {
  await withHarness(async (harness) => {
    const first = item();
    const second = item('HOSTNAME_DIVERGENCE_ON_ASSET', { findingId: FINDING_B, affectedAssetIds: [ASSET_C], affectedAssets: [{ assetId: ASSET_C, persistedName: 'VM-WEB-02' }], normalizedHostname: 'vm-web' });
    const loaders = await renderLoaded(harness, response([first, second]));
    const buttons = [...harness.container.querySelectorAll('button')].filter((entry) => entry.textContent?.includes('Ver análise detalhada'));
    await click(buttons[0]!);
    await click(buttons[1]!);
    assert.equal(loaders.detailCalls[0]?.signal.aborted, true);
    await resolveInsideAct(loaders.detailCalls[1]!.request, individual(second));
    await resolveInsideAct(loaders.detailCalls[0]!.request, individual(first));
    assert.match(harness.container.querySelector('[role="dialog"]')?.textContent ?? '', /Hostname divergente no mesmo ativo/);
  });
});

test('reviewOptions são textos sem radio, checkbox, select ou opção recomendada', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const review = harness.container.querySelector('.finding-review-options');
    assert.ok(review);
    assert.match(review.textContent ?? '', /Podem ser necessárias mais evidências/);
    assert.equal(review.querySelector('input, select, button'), null);
    assert.doesNotMatch(review.textContent ?? '', /Recomendado/);
  });
});

test('interface não oferece resolver, ignorar, mesclar, excluir ou salvar', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness);
    const labels = [...harness.container.querySelectorAll('button')].map((entry) => entry.textContent ?? '').join(' ');
    assert.doesNotMatch(labels, /Resolver|Ignorar|Mesclar|Excluir|Salvar|Confirmar/);
  });
});

test('lista preserva zero observações sem tratá-lo como ausente', async () => {
  await withHarness(async (harness) => {
    await renderLoaded(harness, response([item('DUPLICATE_HOSTNAME_ACROSS_ASSETS', { observationCount: 0, currentObservationCount: 0, historicalObservationCount: 0 })]));
    const counts = harness.container.querySelector('.finding-observation-counts');
    assert.ok(counts);
    assert.match(counts.textContent ?? '', /Observações atuais0/);
    assert.match(counts.textContent ?? '', /Observações históricas0/);
  });
});

test('hostname e IPv6 longos permanecem como texto seguro com classes de quebra', async () => {
  await withHarness(async (harness) => {
    const longHostname = `${'host-'.repeat(30)}example.internal`;
    await renderLoaded(harness, response([item('DUPLICATE_HOSTNAME_ACROSS_ASSETS', { normalizedHostname: longHostname, normalizedIp: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' })]));
    assert.match(harness.container.textContent ?? '', new RegExp(longHostname));
    assert.ok(harness.container.querySelector('.finding-identity-grid code'));
  });
});
