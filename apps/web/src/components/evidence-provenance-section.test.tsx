import assert from 'node:assert/strict';
import test from 'node:test';

import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

import {
  EvidenceProvenanceSection,
  type EvidenceProvenanceLoader,
} from './evidence-provenance-section.tsx';
import {
  ApiError,
  getAssetEvidenceAnalysis,
  type AssetEvidenceAnalysisResponse,
  type AttributeEvidenceAnalysis,
  type EvidenceAnalysisCandidate,
  type ShadowCandidateAssessment,
  type ShadowDecision,
} from '../lib/api.ts';
import {
  createJsdomTestEnvironment,
  type JsdomTestEnvironment,
} from '../test/jsdom-test-environment.ts';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  isSettled: () => boolean;
};

type LoaderCall = {
  assetId: string;
  signal: AbortSignal;
  request: Deferred<AssetEvidenceAnalysisResponse>;
};

type ComponentHarness = {
  container: HTMLDivElement;
  environment: JsdomTestEnvironment;
  render: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
};

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (value) => {
      settled = true;
      resolvePromise(value);
    },
    reject: (reason) => {
      settled = true;
      rejectPromise(reason);
    },
    isSettled: () => settled,
  };
}

function candidate(
  assetId: string,
  currentValue: string,
  overrides: Partial<EvidenceAnalysisCandidate> = {},
): EvidenceAnalysisCandidate {
  return {
    attributeId: `${assetId}-attribute`,
    value: currentValue,
    valueText: currentValue,
    normalizedValue: currentValue.toLowerCase(),
    source: {
      identifier: 'technical-test-source',
      kind: 'TECHNICAL',
      evidenceType: 'MANUAL_SIMULATION',
      trustScore: null,
    },
    attributeObservedAt: '2026-07-15T12:00:00.000Z',
    evidenceObservedAt: '2026-07-15T12:01:00.000Z',
    evidenceIngestedAt: '2026-07-15T12:02:00.000Z',
    persistedConfidenceScore: 91,
    dataQuality: 95,
    isManual: false,
    evidenceId: `${assetId}-evidence`,
    evidenceAvailable: true,
    isCurrent: true,
    confirmationCount: 1,
    ...overrides,
  };
}

function analysis(assetId: string, currentValue: string): AttributeEvidenceAnalysis {
  const currentCandidate = candidate(assetId, currentValue);

  return {
    attribute: 'hostname',
    currentValue,
    candidates: [currentCandidate],
    selectedCandidate: currentCandidate,
    persistedConfidenceScore: 91,
    explanation: {
      status: 'CURRENT_VALUE_WITH_PROVENANCE',
      summary: 'O valor atual possui proveniência diretamente vinculada.',
      decisionApplied: false,
      selectionBasis: 'CURRENT_PERSISTED_VALUE',
      observedValueCount: 1,
      supportingEvidenceCount: 1,
      limitations: ['A análise opera em modo sombra.'],
    },
  };
}

function shadowAssessment(
  overrides: Partial<ShadowCandidateAssessment> = {},
): ShadowCandidateAssessment {
  return {
    candidateId: 'candidate-technical',
    value: 'Windows 11',
    normalizedValue: 'windows 11',
    evidenceId: 'evidence-technical',
    sourceType: 'TECHNICAL',
    eligible: true,
    policyScore: 95,
    criteria: [
      {
        criterion: 'SOURCE_TYPE',
        result: 'POSITIVE',
        points: 40,
        explanation: 'A fonte técnica recebeu 40 pontos.',
      },
      {
        criterion: 'RECENCY',
        result: 'POSITIVE',
        points: 30,
        explanation: 'A evidência está dentro da faixa de até 30 dias.',
      },
    ],
    limitations: [],
    ...overrides,
  };
}

function shadowDecision(overrides: Partial<ShadowDecision> = {}): ShadowDecision {
  return {
    mode: 'SHADOW',
    status: 'CURRENT_VALUE_CONFIRMED',
    currentValue: 'Windows 11',
    recommendedCandidate: {
      value: 'Windows 11',
      normalizedValue: 'windows 11',
      policyScore: 95,
      supportingCandidateIds: ['candidate-technical'],
      supportingEvidenceIds: ['evidence-technical'],
    },
    divergesFromCurrentValue: false,
    assessments: [shadowAssessment()],
    tiedValues: [],
    explanation: ['A política recomendaria manter o valor atual.'],
    limitations: ['Nenhuma decisão foi aplicada.'],
    policyVersion: '2026-07-v1',
    scoreMeaning: 'A pontuação representa prioridade e não probabilidade de correção.',
    ...overrides,
  };
}

function analysisWithShadow(
  assetId: string,
  currentValue: string,
  decision: ShadowDecision,
): AttributeEvidenceAnalysis {
  return {
    ...analysis(assetId, currentValue),
    shadowDecision: decision,
  };
}

function responseFor(
  assetId: string,
  currentValue: string,
  analyses: AttributeEvidenceAnalysis[] = [analysis(assetId, currentValue)],
): AssetEvidenceAnalysisResponse {
  return {
    asset: { id: assetId, name: currentValue },
    mode: 'SHADOW',
    decisionsChanged: false,
    analyses,
  };
}

function emptyResponse(assetId: string): AssetEvidenceAnalysisResponse {
  return responseFor(assetId, `EMPTY-${assetId}`, []);
}

function createControlledLoader(): {
  loader: EvidenceProvenanceLoader;
  calls: LoaderCall[];
} {
  const calls: LoaderCall[] = [];
  const loader: EvidenceProvenanceLoader = (assetId, options) => {
    assert.ok(options?.signal instanceof AbortSignal);
    const request = deferred<AssetEvidenceAnalysisResponse>();
    calls.push({ assetId, signal: options.signal, request });
    return request.promise;
  };

  return { loader, calls };
}

function containsText(container: Node, text: string): boolean {
  return container.textContent?.includes(text) ?? false;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function resolveInsideAct<T>(request: Deferred<T>, value: T): Promise<void> {
  await act(async () => {
    request.resolve(value);
    await flushMicrotasks();
  });
}

async function rejectInsideAct<T>(request: Deferred<T>, reason: unknown): Promise<void> {
  await act(async () => {
    request.reject(reason);
    await flushMicrotasks();
  });
}

async function renderShadowDecision(
  harness: Pick<ComponentHarness, 'container' | 'render'>,
  decision: ShadowDecision,
  currentValue = 'Windows 11',
): Promise<void> {
  const controlled = createControlledLoader();
  const assetId = `asset-shadow-${decision.status.toLowerCase()}`;

  await harness.render(
    createElement(EvidenceProvenanceSection, {
      assetId,
      loader: controlled.loader,
    }),
  );
  await resolveInsideAct(
    controlled.calls[0]!.request,
    responseFor(assetId, currentValue, [analysisWithShadow(assetId, currentValue, decision)]),
  );
}

async function withComponentHarness(
  run: (harness: ComponentHarness) => Promise<void>,
): Promise<void> {
  const environment = createJsdomTestEnvironment();
  const { createRoot } = await import('react-dom/client');
  const root: Root = createRoot(environment.container);
  const consoleMessages: string[] = [];
  const unhandledRejections: unknown[] = [];
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  let mounted = true;
  let failure: unknown = null;

  console.error = (...arguments_: unknown[]) => {
    consoleMessages.push(`error: ${arguments_.map(String).join(' ')}`);
  };
  console.warn = (...arguments_: unknown[]) => {
    consoleMessages.push(`warn: ${arguments_.map(String).join(' ')}`);
  };
  const recordUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', recordUnhandledRejection);

  const unmount = async (): Promise<void> => {
    if (!mounted) return;
    await act(async () => {
      root.unmount();
      await flushMicrotasks();
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
          await flushMicrotasks();
        });
      },
      unmount,
    });
  } catch (error) {
    failure = error;
  }

  try {
    await unmount();
    await new Promise<void>((resolve) => setImmediate(resolve));
  } catch (error) {
    failure ??= error;
  } finally {
    process.off('unhandledRejection', recordUnhandledRejection);
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    environment.cleanup();
  }

  if (failure) throw failure;
  assert.deepEqual(consoleMessages, [], 'o componente não deve emitir warnings no console');
  assert.deepEqual(unhandledRejections, [], 'o teste não deve deixar rejeições sem tratamento');
}

test('monta o componente real, transita de loading para ready e limpa sem warnings', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const controlled = createControlledLoader();

    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-success',
        loader: controlled.loader,
      }),
    );

    assert.equal(controlled.calls.length, 1);
    assert.ok(container.querySelector('[role="status"]'));
    assert.ok(containsText(container, 'Carregando proveniência dos dados...'));

    await resolveInsideAct(
      controlled.calls[0]!.request,
      responseFor('asset-success', 'HOST-SUCCESS'),
    );

    assert.equal(container.querySelector('[role="status"]'), null);
    assert.ok(containsText(container, 'HOST-SUCCESS'));
    assert.ok(containsText(container, 'Modo sombra'));
    assert.ok(containsText(container, 'Evidência diretamente vinculada'));
  });
});

test('CURRENT_VALUE_CONFIRMED apresenta manutenção do atual sem afirmar verdade', async () => {
  await withComponentHarness(async ({ container, render }) => {
    await renderShadowDecision({ container, render }, shadowDecision());

    assert.ok(containsText(container, 'Recomendação em modo sombra'));
    assert.ok(containsText(container, 'A política recomendaria manter o valor atual'));
    assert.ok(containsText(container, 'Equivalente ao valor persistido'));
    assert.ok(containsText(container, 'Esta recomendação foi calculada pela política 2026-07-v1'));
    assert.equal(containsText(container, 'valor correto'), false);
  });
});

test('RECOMMENDED mantém valor atual e recomendado separados sem aplicar alteração', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const decision = shadowDecision({
      status: 'RECOMMENDED',
      currentValue: 'Windows 10',
      recommendedCandidate: {
        value: 'Windows 11',
        normalizedValue: 'windows 11',
        policyScore: 90,
        supportingCandidateIds: ['candidate-technical'],
        supportingEvidenceIds: ['evidence-technical'],
      },
      divergesFromCurrentValue: true,
      explanation: ['A recomendação diverge, mas nenhuma alteração foi aplicada.'],
    });
    await renderShadowDecision({ container, render }, decision, 'Windows 10');

    const comparison = container.querySelector('.shadow-value-comparison');
    assert.ok(comparison);
    assert.ok(containsText(comparison, 'Valor atual'));
    assert.ok(containsText(comparison, 'Windows 10'));
    assert.ok(containsText(comparison, 'Valor recomendado pela política'));
    assert.ok(containsText(comparison, 'Windows 11'));
    assert.ok(containsText(comparison, 'Diverge do valor persistido'));
    assert.ok(containsText(container, 'não alterou o valor persistido'));
  });
});

test('TIED apresenta todos os valores empatados e nenhuma recomendação', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const decision = shadowDecision({
      status: 'TIED',
      recommendedCandidate: null,
      divergesFromCurrentValue: null,
      tiedValues: [
        {
          value: 'Windows 10',
          normalizedValue: 'windows 10',
          policyScore: 90,
          supportingCandidateIds: ['candidate-a'],
        },
        {
          value: 'Windows 11',
          normalizedValue: 'windows 11',
          policyScore: 90,
          supportingCandidateIds: ['candidate-b'],
        },
      ],
    });
    await renderShadowDecision({ container, render }, decision);

    assert.ok(containsText(container, 'Empate entre valores'));
    assert.ok(containsText(container, 'Windows 10'));
    assert.ok(containsText(container, 'Windows 11'));
    assert.ok(containsText(container, 'Nenhuma recomendação produzida'));
    assert.ok(containsText(container, 'não desempata por ordem, ID ou posição'));
  });
});

test('INSUFFICIENT_EVIDENCE mantém fonte simulada visível e inelegível', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const decision = shadowDecision({
      status: 'INSUFFICIENT_EVIDENCE',
      recommendedCandidate: null,
      divergesFromCurrentValue: null,
      assessments: [
        shadowAssessment({
          candidateId: 'candidate-simulated',
          sourceType: 'SIMULATED',
          eligible: false,
          policyScore: null,
          limitations: ['A fonte simulada não é elegível para recomendar alteração em dados reais.'],
        }),
      ],
    });
    await renderShadowDecision({ container, render }, decision);

    assert.ok(containsText(container, 'Evidência insuficiente para recomendar'));
    assert.ok(containsText(container, 'Simulada'));
    assert.ok(containsText(container, 'Inelegível para recomendação'));
    assert.ok(containsText(container, 'Não aplicável'));
  });
});

test('fonte desconhecida permanece visível e inelegível', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const decision = shadowDecision({
      status: 'INSUFFICIENT_EVIDENCE',
      recommendedCandidate: null,
      assessments: [
        shadowAssessment({
          candidateId: 'candidate-unknown',
          sourceType: 'UNKNOWN',
          eligible: false,
          policyScore: null,
          limitations: ['A fonte desconhecida não é elegível.'],
        }),
      ],
    });
    await renderShadowDecision({ container, render }, decision);

    assert.ok(containsText(container, 'Desconhecida'));
    assert.ok(containsText(container, 'Inelegível para recomendação'));
    assert.equal(containsText(container, 'Elegível para recomendação'), false);
  });
});

test('valor vazio aparece como sem valor válido e nunca como recomendação', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const decision = shadowDecision({
      status: 'INSUFFICIENT_EVIDENCE',
      currentValue: ' \t\n ',
      recommendedCandidate: null,
      divergesFromCurrentValue: null,
      assessments: [
        shadowAssessment({
          value: ' \t\n ',
          normalizedValue: null,
          eligible: false,
          policyScore: null,
          limitations: ['O candidato não possui valor normalizado válido.'],
        }),
      ],
    });
    await renderShadowDecision({ container, render }, decision, 'Sem valor atual');

    assert.ok(containsText(container, 'Sem valor válido'));
    assert.ok(containsText(container, 'Não disponível'));
    assert.ok(containsText(container, 'Nenhuma recomendação produzida'));
    assert.ok(containsText(container.querySelector('.shadow-policy-score')!, 'Não aplicável'));
    assert.equal(containsText(container.querySelector('.shadow-policy-score')!, '95'), false);
  });
});

for (const [value, label] of [
  [0, '0'],
  [false, 'false'],
] as Array<[number | boolean, string]>) {
  test(`valor falsy ${label} é preservado na decisão`, async () => {
    await withComponentHarness(async ({ container, render }) => {
      const decision = shadowDecision({
        status: 'CURRENT_VALUE_CONFIRMED',
        currentValue: value,
        recommendedCandidate: {
          value,
          normalizedValue: label,
          policyScore: 80,
          supportingCandidateIds: ['candidate-falsy'],
          supportingEvidenceIds: ['evidence-falsy'],
        },
        assessments: [shadowAssessment({ value, normalizedValue: label })],
      });
      await renderShadowDecision({ container, render }, decision, label);

      const comparison = container.querySelector('.shadow-value-comparison');
      assert.ok(comparison);
      assert.equal(
        [...comparison.querySelectorAll('strong')].filter(
          (element) => element.textContent?.trim() === label,
        ).length,
        2,
      );
    });
  });
}

test('policyScore é exibido somente como prioridade e sem porcentagem', async () => {
  await withComponentHarness(async ({ container, render }) => {
    await renderShadowDecision({ container, render }, shadowDecision());
    const policyScore = container.querySelector('.shadow-policy-score');

    assert.ok(policyScore);
    assert.ok(containsText(policyScore, 'Pontuação de prioridade da política'));
    assert.ok(containsText(policyScore, 'não uma probabilidade, confiança ou certeza'));
    assert.equal(policyScore.textContent?.includes('%'), false);
    assert.equal(/Trust Score|Confidence Score/i.test(policyScore.textContent ?? ''), false);
  });
});

test('critérios são expansíveis por botão semântico com aria-expanded', async () => {
  await withComponentHarness(async ({ container, environment, render }) => {
    await renderShadowDecision({ container, render }, shadowDecision());
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Ver critérios e limitações'),
    );

    assert.ok(button);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(containsText(container, 'A fonte técnica recebeu 40 pontos.'), false);

    await act(async () => {
      button.dispatchEvent(
        new environment.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();
    });

    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.ok(containsText(container, 'Tipo da fonte'));
    assert.ok(containsText(container, 'Contribuiu'));
    assert.ok(containsText(container, '40 pontos'));
    assert.ok(containsText(container, 'A fonte técnica recebeu 40 pontos.'));
  });
});

test('explicações e limitações da decisão aparecem em blocos distintos', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const decision = shadowDecision({
      explanation: ['Explicação controlada da decisão.'],
      limitations: ['Limitação controlada da decisão.'],
    });
    await renderShadowDecision({ container, render }, decision);

    assert.ok(containsText(container, 'Por que a política chegou a este resultado'));
    assert.ok(containsText(container, 'Explicação controlada da decisão.'));
    assert.ok(containsText(container, 'Limitações da análise'));
    assert.ok(containsText(container, 'Limitação controlada da decisão.'));
  });
});

test('ausência de shadowDecision mantém a proveniência e informa indisponibilidade', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const controlled = createControlledLoader();
    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-legacy-contract',
        loader: controlled.loader,
      }),
    );
    await resolveInsideAct(
      controlled.calls[0]!.request,
      responseFor('asset-legacy-contract', 'HOST-LEGACY'),
    );

    assert.ok(containsText(container, 'HOST-LEGACY'));
    assert.ok(containsText(container, 'Evidência diretamente vinculada'));
    assert.ok(
      containsText(container, 'Decisão simulada ainda não disponível para este atributo.'),
    );
  });
});

test('payload bruto desconhecido não é renderizado pela decisão', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const unsafeDecision = {
      ...shadowDecision(),
      rawPayload: 'SEGREDO-INTERNO',
      fingerprint: 'FINGERPRINT-INTERNO',
    } as ShadowDecision;
    await renderShadowDecision({ container, render }, unsafeDecision);

    assert.equal(containsText(container, 'SEGREDO-INTERNO'), false);
    assert.equal(containsText(container, 'FINGERPRINT-INTERNO'), false);
  });
});

test('desmontagem aborta a requisição pendente e ignora sua resolução posterior', async () => {
  await withComponentHarness(async ({ container, render, unmount }) => {
    const controlled = createControlledLoader();

    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-unmount',
        loader: controlled.loader,
      }),
    );

    assert.equal(controlled.calls.length, 1);
    assert.equal(controlled.calls[0]!.signal.aborted, false);

    await unmount();

    assert.equal(controlled.calls[0]!.signal.aborted, true);
    await resolveInsideAct(
      controlled.calls[0]!.request,
      responseFor('asset-unmount', 'HOST-AFTER-UNMOUNT'),
    );
    assert.equal(container.innerHTML, '');
    assert.equal(containsText(container, 'HOST-AFTER-UNMOUNT'), false);
  });
});

test('troca de asset aborta A, apresenta B e bloqueia a resposta antiga de A', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const controlled = createControlledLoader();

    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-a',
        loader: controlled.loader,
      }),
    );
    assert.equal(controlled.calls.length, 1);

    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-b',
        loader: controlled.loader,
      }),
    );

    assert.equal(controlled.calls.length, 2);
    assert.equal(controlled.calls[0]!.signal.aborted, true);
    assert.equal(controlled.calls[1]!.signal.aborted, false);
    assert.ok(container.querySelector('[role="status"]'));

    await resolveInsideAct(
      controlled.calls[1]!.request,
      responseFor('asset-b', 'HOST-B'),
    );
    assert.ok(containsText(container, 'HOST-B'));

    await resolveInsideAct(
      controlled.calls[0]!.request,
      responseFor('asset-a', 'HOST-A'),
    );
    assert.equal(containsText(container, 'HOST-A'), false);
    assert.ok(containsText(container, 'HOST-B'));
  });
});

test('timeout controlado chega ao componente e o clique real de retry inicia uma requisição nova', async () => {
  await withComponentHarness(async ({ container, environment, render }) => {
    const externalSignals: AbortSignal[] = [];
    const requestTimers: ReturnType<typeof controlledTimer>[] = [];
    const fetchRequests: ControlledFetchRequest[] = [];
    const loader: EvidenceProvenanceLoader = (assetId, options) => {
      assert.ok(options?.signal instanceof AbortSignal);
      externalSignals.push(options.signal);
      const timer = controlledTimer();
      requestTimers.push(timer);

      return getAssetEvidenceAnalysis(assetId, {
        signal: options.signal,
        scheduleTimeout: timer.schedule,
        cancelTimeout: timer.cancel,
        fetchImplementation: (_input, init) => {
          const request = controlledFetchRequest(init.signal);
          fetchRequests.push(request);
          return request.promise;
        },
      });
    };

    const initialUrl = environment.window.location.href;
    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-retry',
        loader,
      }),
    );
    assert.equal(externalSignals.length, 1);
    assert.equal(fetchRequests.length, 1);

    await act(async () => {
      requestTimers[0]!.fire();
      await flushMicrotasks();
    });

    const expectedError =
      'Não foi possível carregar a proveniência dos dados. Tente novamente.';
    assert.ok(containsText(container, expectedError));
    assert.equal(fetchRequests[0]!.signal.aborted, true);
    assert.equal(requestTimers[0]!.wasCancelled(), true);

    const retryButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Tentar novamente',
    );
    assert.ok(retryButton);
    assert.equal(retryButton.tagName, 'BUTTON');

    await act(async () => {
      retryButton.dispatchEvent(
        new environment.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await flushMicrotasks();
    });

    assert.equal(externalSignals.length, 2);
    assert.equal(fetchRequests.length, 2);
    assert.equal(externalSignals[0]!.aborted, true);
    assert.equal(externalSignals[1]!.aborted, false);
    assert.notEqual(externalSignals[0], externalSignals[1]);
    assert.ok(container.querySelector('[role="status"]'));
    assert.equal(containsText(container, expectedError), false);
    assert.equal(environment.window.location.href, initialUrl);

    await act(async () => {
      fetchRequests[1]!.resolve(
        jsonResponse(responseFor('asset-retry', 'HOST-RETRY-SUCCESS')),
      );
      await flushMicrotasks();
    });

    assert.equal(externalSignals.length, 2);
    assert.equal(containsText(container, expectedError), false);
    assert.ok(containsText(container, 'HOST-RETRY-SUCCESS'));
    assert.equal(fetchRequests[1]!.signal.aborted, false);
    assert.equal(requestTimers[1]!.wasCancelled(), true);
  });
});

test('estado empty mantém o resumo de modo sombra sem inventar candidatos', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const controlled = createControlledLoader();

    await render(
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-empty',
        loader: controlled.loader,
      }),
    );
    await resolveInsideAct(controlled.calls[0]!.request, emptyResponse('asset-empty'));

    assert.ok(
      containsText(
        container,
        'Não há atributos disponíveis para análise de proveniência neste ativo.',
      ),
    );
    assert.ok(containsText(container, 'Modo sombra'));
    assert.ok(containsText(container, 'Análise somente leitura'));
    assert.ok(containsText(container, 'Trust Score ainda não calculado.'));
    assert.equal(container.querySelector('.provenance-error'), null);
    assert.equal(container.querySelector('.provenance-candidate'), null);
    assert.equal(containsText(container, 'Evidência diretamente vinculada'), false);
  });
});

test('falha da proveniência fica isolada e preserva o conteúdo do componente hospedeiro', async () => {
  await withComponentHarness(async ({ container, render }) => {
    const controlled = createControlledLoader();
    const host = createElement(
      'main',
      null,
      createElement('p', null, 'Detalhes do ativo disponíveis'),
      createElement(EvidenceProvenanceSection, {
        assetId: 'asset-error',
        loader: controlled.loader,
      }),
    );

    await render(host);
    await rejectInsideAct(controlled.calls[0]!.request, new ApiError('timeout', 408));

    assert.ok(containsText(container, 'Detalhes do ativo disponíveis'));
    assert.ok(
      containsText(
        container,
        'Não foi possível carregar a proveniência dos dados. Tente novamente.',
      ),
    );
    assert.ok(container.querySelector('[role="alert"]'));
    const retryButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'Tentar novamente',
    );
    assert.equal(retryButtons.length, 1);
    assert.ok(container.querySelector('main'));
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function controlledTimer() {
  let callback: (() => void) | null = null;
  let cancelled = false;
  const handle = {} as ReturnType<typeof setTimeout>;

  return {
    schedule: (next: () => void): ReturnType<typeof setTimeout> => {
      callback = next;
      return handle;
    },
    cancel: (receivedHandle: ReturnType<typeof setTimeout>): void => {
      assert.equal(receivedHandle, handle);
      cancelled = true;
      callback = null;
    },
    fire: (): void => {
      assert.ok(callback);
      const next = callback;
      callback = null;
      next();
    },
    wasCancelled: (): boolean => cancelled,
  };
}

type ControlledFetchRequest = {
  promise: Promise<Response>;
  signal: AbortSignal;
  resolve: (response: Response) => void;
};

function controlledFetchRequest(signalValue: RequestInit['signal']): ControlledFetchRequest {
  assert.ok(signalValue instanceof AbortSignal);
  const signal = signalValue;
  let resolvePromise!: (response: Response) => void;
  let rejectPromise!: (reason: unknown) => void;

  const onAbort = (): void => {
    rejectPromise(new DOMException('The operation was aborted.', 'AbortError'));
  };
  const promise = new Promise<Response>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    promise,
    signal,
    resolve: (value) => {
      signal.removeEventListener('abort', onAbort);
      resolvePromise(value);
    },
  };
}
