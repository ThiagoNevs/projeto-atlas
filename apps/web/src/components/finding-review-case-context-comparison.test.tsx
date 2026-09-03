import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';

import type { Root } from 'react-dom/client';

import { ApiError } from '../lib/api-error.ts';
import type {
  FindingReviewCaseDetail,
  FindingReviewContextComparisonResponse,
} from '../lib/api.ts';
import type { ReviewCaseContextComparisonLoader } from './finding-review-cases/use-review-case-context-comparison.ts';
import { createJsdomTestEnvironment } from '../test/jsdom-test-environment.ts';

const environment = createJsdomTestEnvironment();
environment.container.remove();

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ReviewCaseContextSection } =
  await import('./finding-review-cases/review-case-context-section.tsx');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CASE_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';
const FINDING_ID = 'finding_0123456789abcdef01234567';
const NOW = '2026-08-30T12:00:00.000Z';

const snapshot = {
  snapshotVersion: 1 as const,
  findingId: FINDING_ID,
  findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS' as const,
  policyVersion: '2026-07-v1',
  generatedAt: NOW,
  affectedAssets: [{ assetId: ASSET_ID, name: 'SRV-APP-01' }],
  normalizedHostname: 'srv-app-01',
  normalizedIp: null,
  observations: [
    {
      assetId: ASSET_ID,
      value: 'SRV-APP-01',
      normalizedValue: 'srv-app-01',
      attribute: 'HOSTNAME' as const,
      source: 'fixture',
      sourceType: 'TECHNICAL' as const,
      evidenceId: EVIDENCE_ID,
      observedAt: NOW,
      ingestedAt: NOW,
      current: true,
    },
  ],
  sources: [{ identifier: 'fixture', type: 'TECHNICAL' as const }],
  temporalContext: {
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    differenceMilliseconds: 0,
    relationship: 'SAME_OBSERVATION_TIME' as const,
  },
  explanation: ['Hostname repetido.'],
  limitations: [],
  reviewOptions: ['SAME_ASSET' as const, 'DIFFERENT_ASSETS' as const],
};

const detail: FindingReviewCaseDetail = {
  id: CASE_ID,
  findingId: FINDING_ID,
  findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  policyVersion: '2026-07-v1',
  status: 'IN_REVIEW',
  staleness: 'CURRENT',
  version: 4,
  createdBy: 'atlas-mvp-user',
  createdAt: NOW,
  updatedAt: NOW,
  originalSnapshot: snapshot,
  originalSnapshotHash: 'a'.repeat(64),
  currentDecision: null,
  decisionHistory: [],
  assets: [
    {
      assetIdAtCreation: ASSET_ID,
      assetNameAtCreation: 'SRV-APP-01',
      role: 'AFFECTED',
      currentAssetId: ASSET_ID,
      currentAssetName: 'SRV-APP-01',
      currentAssetAvailable: true,
    },
  ],
  events: [],
};

function response(
  staleness: FindingReviewContextComparisonResponse['result']['staleness'] = 'CURRENT',
  overrides: Partial<FindingReviewContextComparisonResponse> = {},
): FindingReviewContextComparisonResponse {
  return {
    caseId: detail.id,
    caseVersion: detail.version,
    comparedAt: NOW,
    baseline: {
      kind: 'ORIGINAL',
      findingId: detail.findingId,
      policyVersion: detail.policyVersion,
      snapshotHash: detail.originalSnapshotHash,
    },
    current:
      staleness === 'NO_LONGER_DETECTED'
        ? null
        : {
            findingId: FINDING_ID,
            policyVersion: '2026-07-v1',
            snapshot,
            snapshotHash: 'b'.repeat(64),
          },
    result: { staleness, reasons: [], diff: {} },
    ...overrides,
  };
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === name,
  );
  assert.ok(match);
  return match;
}

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

async function renderSection(
  loader: ReviewCaseContextComparisonLoader,
  currentDetail = detail,
  mutationBlocked = false,
) {
  const container = environment.window.document.createElement('div');
  environment.window.document.body.append(container);
  const root = createRoot(container);
  activeRoot = root;
  activeContainer = container;
  const render = async (
    nextDetail = currentDetail,
    nextMutationBlocked = mutationBlocked,
  ): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(ReviewCaseContextSection, {
          detail: nextDetail,
          loadComparison: loader,
          mutationBlocked: nextMutationBlocked,
          reloadDetail: () => undefined,
        }),
      );
      await flush();
    });
  };
  await render();
  return { container, root, render };
}

afterEach(async () => {
  if (activeRoot) await act(async () => activeRoot?.unmount());
  activeContainer?.remove();
  environment.window.sessionStorage.clear();
  activeRoot = null;
  activeContainer = null;
});

after(() => environment.cleanup());

test('não faz auto-fetch e percorre idle, loading e CURRENT somente após gesto manual', async () => {
  const pending = deferred<FindingReviewContextComparisonResponse>();
  let calls = 0;
  const storageBefore = environment.window.sessionStorage.length;
  const { container } = await renderSection(async () => {
    calls += 1;
    return pending.promise;
  });

  assert.equal(calls, 0);
  const section = container.querySelector('section[aria-labelledby="review-case-context-title"]');
  assert.ok(section);
  assert.match(container.textContent ?? '', /Contexto da investigação/);
  assert.match(container.textContent ?? '', /Contexto no início da investigação/);
  assert.match(container.textContent ?? '', /Ativos históricos e vínculos atuais/);
  assert.equal(button(container, 'Verificar contexto atual').disabled, false);

  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  assert.equal(calls, 1);
  assert.equal(section.getAttribute('aria-busy'), 'true');
  assert.equal(button(container, 'Verificando...').disabled, true);

  await act(async () => {
    pending.resolve(response());
    await pending.promise;
    await flush();
  });
  assert.equal(section.getAttribute('aria-busy'), 'false');
  assert.match(container.textContent ?? '', /Contexto sem mudanças materiais/);
  assert.match(container.textContent ?? '', /não encontrou mudanças materiais/);
  assert.match(container.textContent ?? '', /Comparado em/);
  assert.ok(container.querySelector('[role="status"][aria-live="polite"]'));
  assert.equal(button(container, 'Verificar novamente').disabled, false);
  assert.equal(environment.window.sessionStorage.length, storageBefore);
});

test('CHANGED apresenta resumo humano, diferenças textuais e contexto atual', async () => {
  const changed = response('CHANGED', {
    result: {
      staleness: 'CHANGED',
      reasons: ['NETWORK_VALUE_CHANGED', 'EVIDENCE_CHANGED'],
      diff: {
        normalizedHostname: { before: 'srv-old', after: 'srv-app-01' },
        evidenceIds: { added: [EVIDENCE_ID], removed: ['old-evidence'] },
      },
    },
  });
  const { container } = await renderSection(async () => changed);
  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  assert.match(container.textContent ?? '', /Há mudanças no contexto desta investigação/);
  assert.match(container.textContent ?? '', /O caso não foi atualizado/);
  assert.match(container.textContent ?? '', /Ver alterações/);
  assert.match(container.textContent ?? '', /Adicionado/);
  assert.match(container.textContent ?? '', /Removido/);
  assert.match(container.textContent ?? '', /Antes/);
  assert.match(container.textContent ?? '', /Agora/);
  assert.match(container.textContent ?? '', /Contexto atual/);
  assert.ok(container.querySelector('details'));
});

test('estados especiais usam copy humana e não oferecem adoção persistente', async (t) => {
  const cases: Array<{
    state: FindingReviewContextComparisonResponse['result']['staleness'];
    headline: RegExp;
  }> = [
    { state: 'NO_LONGER_DETECTED', headline: /problema original não é mais detectado/ },
    { state: 'ASSET_UNAVAILABLE', headline: /Parte do contexto histórico não está disponível/ },
    { state: 'POLICY_VERSION_CHANGED', headline: /regra de detecção mudou/ },
    { state: 'REQUIRES_REFRESH', headline: /Não foi possível comparar o contexto automaticamente/ },
  ];
  for (const entry of cases) {
    await t.test(entry.state, async () => {
      const { container, root } = await renderSection(async () => response(entry.state));
      await act(async () => {
        button(container, 'Verificar contexto atual').click();
        await flush();
      });
      assert.match(container.textContent ?? '', entry.headline);
      assert.doesNotMatch(
        container.textContent ?? '',
        /Atualizar caso|Aplicar refresh|Sincronizar contexto/,
      );
      if (entry.state === 'NO_LONGER_DETECTED') {
        assert.match(container.textContent ?? '', /caso permanece no estado atual/i);
        assert.doesNotMatch(container.textContent ?? '', /Remediado|Encerrado automaticamente/);
      }
      await act(async () => root.unmount());
      container.remove();
      activeRoot = null;
      activeContainer = null;
    });
  }
});

test('recheck preserva resultado anterior durante loading e depois de erro', async () => {
  const second = deferred<FindingReviewContextComparisonResponse>();
  let calls = 0;
  const { container } = await renderSection(async () => {
    calls += 1;
    if (calls === 1) return response();
    return second.promise;
  });
  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  await act(async () => {
    button(container, 'Verificar novamente').click();
    await flush();
  });
  assert.match(container.textContent ?? '', /Nova verificação em andamento/);
  assert.match(container.textContent ?? '', /Contexto sem mudanças materiais/);

  await act(async () => {
    second.reject(new ApiError('A comparação está indisponível.', 503));
    await second.promise.catch(() => undefined);
    await flush();
  });
  assert.ok(container.querySelector('[role="alert"]'));
  assert.match(container.textContent ?? '', /nova verificação falhou/i);
  assert.match(container.textContent ?? '', /Contexto sem mudanças materiais/);
});

test('mudança de versão limpa resultado concluído sem nova verificação automática', async () => {
  let calls = 0;
  const { container, render } = await renderSection(async () => {
    calls += 1;
    return response();
  });

  assert.equal(calls, 0);
  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  assert.equal(calls, 1);
  assert.match(container.textContent ?? '', /Contexto sem mudanças materiais/);

  await render({ ...detail, version: 5 });

  assert.doesNotMatch(container.textContent ?? '', /Contexto sem mudanças materiais/);
  assert.equal(button(container, 'Verificar contexto atual').disabled, false);
  assert.doesNotMatch(container.textContent ?? '', /Verificar novamente/);
  assert.equal(calls, 1);
});

test('troca de caso e versão abortam request pendente e impedem resposta tardia', async () => {
  const requests: Array<{
    pending: ReturnType<typeof deferred<FindingReviewContextComparisonResponse>>;
    signal: AbortSignal | undefined;
  }> = [];
  const loader: ReviewCaseContextComparisonLoader = async (_id, options) => {
    const pending = deferred<FindingReviewContextComparisonResponse>();
    requests.push({ pending, signal: options?.signal });
    return pending.promise;
  };
  const { container, render } = await renderSection(loader);
  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  await render({ ...detail, id: SECOND_CASE_ID, findingId: 'finding_89abcdef0123456789abcdef' });
  assert.equal(requests[0]?.signal?.aborted, true);
  requests[0]?.pending.resolve(response());
  await act(flush);
  assert.doesNotMatch(container.textContent ?? '', /Contexto sem mudanças materiais/);
  assert.equal(button(container, 'Verificar contexto atual').disabled, false);

  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  await render({
    ...detail,
    id: SECOND_CASE_ID,
    findingId: 'finding_89abcdef0123456789abcdef',
    version: 5,
  });
  assert.equal(requests[1]?.signal?.aborted, true);
  assert.doesNotMatch(container.textContent ?? '', /Contexto sem mudanças materiais/);
});

test('mutation ativa desabilita o gesto e, ao iniciar durante GET, invalida a comparação', async () => {
  const pending = deferred<FindingReviewContextComparisonResponse>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const { container, render } = await renderSection(async (_id, options) => {
    calls += 1;
    signal = options?.signal;
    return pending.promise;
  });
  await render(detail, true);
  assert.equal(button(container, 'Verificar contexto atual').disabled, true);
  button(container, 'Verificar contexto atual').click();
  assert.equal(calls, 0);

  await render(detail, false);
  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  assert.equal(calls, 1);
  await render(detail, true);
  assert.equal(signal?.aborted, true);
  pending.resolve(response());
  await act(flush);
  assert.doesNotMatch(container.textContent ?? '', /Contexto sem mudanças materiais/);
});

test('erro inicial é localizado, acessível e mantém ação manual de retry', async () => {
  const { container } = await renderSection(async () => {
    throw new ApiError('A verificação demorou mais que o esperado. Tente novamente.', 408);
  });
  await act(async () => {
    button(container, 'Verificar contexto atual').click();
    await flush();
  });
  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert);
  assert.match(alert.textContent ?? '', /demorou mais que o esperado/);
  assert.equal(button(container, 'Tentar novamente').disabled, false);
});
