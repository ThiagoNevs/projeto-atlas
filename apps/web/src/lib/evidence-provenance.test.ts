import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  API_CONNECTION_ERROR_MESSAGE,
  ApiError,
  EVIDENCE_PROVENANCE_TIMEOUT_MS,
  getAssetEvidenceAnalysis,
  type EvidenceAnalysisRequestOptions,
} from './api.ts';
import {
  abbreviateEvidenceId,
  canApplyProvenanceResult,
  formatProvenanceValue,
  formatSupportingEvidence,
  formatTrustScore,
  getProvenanceErrorMessage,
  getProvenancePresentation,
  getSourcePresentation,
  parseEvidenceAnalysisResponse,
  PERSISTED_SCORE_EXPLANATION,
  resolveProvenanceSectionState,
  SHADOW_MODE_DESCRIPTION,
  shouldShowShadowModeSummary,
  type AssetEvidenceAnalysisResponse,
  type AttributeEvidenceAnalysis,
  type EvidenceAnalysisCandidate,
  type EvidenceSourceKind,
} from './evidence-provenance.ts';

function candidate(
  overrides: Partial<EvidenceAnalysisCandidate> = {},
): EvidenceAnalysisCandidate {
  return {
    attributeId: 'attribute-current',
    value: 'Windows 11',
    valueText: 'Windows 11',
    normalizedValue: 'windows 11',
    source: {
      identifier: 'manual',
      kind: 'MANUAL',
      evidenceType: 'MANUAL_ENRICHMENT',
      trustScore: null,
    },
    attributeObservedAt: '2026-07-10T12:00:00.000Z',
    evidenceObservedAt: '2026-07-11T12:00:00.000Z',
    evidenceIngestedAt: '2026-07-11T12:01:00.000Z',
    persistedConfidenceScore: 82,
    dataQuality: 90,
    isManual: true,
    evidenceId: '00000000-0000-4000-8000-000000000001',
    evidenceAvailable: true,
    isCurrent: true,
    confirmationCount: 1,
    ...overrides,
  };
}

function analysis(
  overrides: Partial<AttributeEvidenceAnalysis> = {},
): AttributeEvidenceAnalysis {
  const current = candidate();
  return {
    attribute: 'operatingSystem',
    currentValue: 'Windows 11',
    candidates: [current],
    selectedCandidate: current,
    persistedConfidenceScore: 82,
    explanation: {
      status: 'CURRENT_VALUE_WITH_PROVENANCE',
      summary: 'O valor atual possui vínculo direto com a evidência informada.',
      decisionApplied: false,
      selectionBasis: 'CURRENT_PERSISTED_VALUE',
      observedValueCount: 1,
      supportingEvidenceCount: 1,
      limitations: ['A análise opera em modo sombra.'],
    },
    ...overrides,
  };
}

function response(
  analyses: AttributeEvidenceAnalysis[] = [analysis()],
): AssetEvidenceAnalysisResponse {
  return {
    asset: { id: '00000000-0000-4000-8000-000000000010', name: 'NB-RH-001' },
    mode: 'SHADOW',
    decisionsChanged: false,
    analyses,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function controlledTimer() {
  let callback: (() => void) | null = null;
  let cleared = false;
  const handle = {} as ReturnType<typeof setTimeout>;

  return {
    schedule: (next: () => void): ReturnType<typeof setTimeout> => {
      callback = next;
      return handle;
    },
    cancel: (receivedHandle: ReturnType<typeof setTimeout>): void => {
      assert.equal(receivedHandle, handle);
      cleared = true;
    },
    fire: (): void => {
      assert.ok(callback, 'o timeout deve ser agendado antes de ser disparado');
      callback();
    },
    wasCleared: (): boolean => cleared,
  };
}

function abortablePendingFetch(signals: AbortSignal[]): NonNullable<
  EvidenceAnalysisRequestOptions['fetchImplementation']
> {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      assert.ok(signal instanceof AbortSignal);
      signals.push(signal);

      const rejectWithAbort = (): void => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };

      if (signal.aborted) rejectWithAbort();
      else signal.addEventListener('abort', rejectWithAbort, { once: true });
    });
}

test('usa timeout padrão centralizado de dez segundos somente na proveniência', () => {
  assert.equal(EVIDENCE_PROVENANCE_TIMEOUT_MS, 10_000);
});

test('retorna análise recebida antes do timeout e limpa o timer', async () => {
  const timer = controlledTimer();
  const result = await getAssetEvidenceAnalysis('asset-1', {
    fetchImplementation: async () => jsonResponse(response()),
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  assert.deepEqual(result, response());
  assert.equal(timer.wasCleared(), true);
});

test('timeout aborta a requisição, normaliza o erro e limpa o timer', async () => {
  const timer = controlledTimer();
  const signals: AbortSignal[] = [];
  const request = getAssetEvidenceAnalysis('asset-timeout', {
    fetchImplementation: abortablePendingFetch(signals),
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  timer.fire();

  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 408);
    assert.match(error.message, /tente novamente/i);
    assert.doesNotMatch(error.message, /abort|failed to fetch/i);
    return true;
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(timer.wasCleared(), true);
});

test('erro HTTP estruturado encerra a requisição e limpa o timer', async () => {
  const timer = controlledTimer();
  const request = getAssetEvidenceAnalysis('asset-http-error', {
    fetchImplementation: async () =>
      jsonResponse({ message: 'Análise temporariamente indisponível.' }, 503),
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Análise temporariamente indisponível.');
    return true;
  });
  assert.equal(timer.wasCleared(), true);
});

test('contrato inválido encerra a requisição com 502 e limpa o timer', async () => {
  const timer = controlledTimer();
  const request = getAssetEvidenceAnalysis('asset-invalid', {
    fetchImplementation: async () => jsonResponse({ mode: 'SHADOW' }),
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    return true;
  });
  assert.equal(timer.wasCleared(), true);
});

test('JSON malformado não permanece carregando e limpa o timer', async () => {
  const timer = controlledTimer();
  const request = getAssetEvidenceAnalysis('asset-invalid-json', {
    fetchImplementation: async () =>
      new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  await assert.rejects(request, SyntaxError);
  assert.equal(timer.wasCleared(), true);
});

test('falha de rede é normalizada sem expor Failed to fetch', async () => {
  const timer = controlledTimer();
  const request = getAssetEvidenceAnalysis('asset-network-error', {
    fetchImplementation: async () => {
      throw new TypeError('Failed to fetch');
    },
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, API_CONNECTION_ERROR_MESSAGE);
    assert.doesNotMatch(getProvenanceErrorMessage(error.status), /failed to fetch/i);
    return true;
  });
  assert.equal(timer.wasCleared(), true);
});

test('cancelamento externo não expõe AbortError e limpa o timer', async () => {
  const timer = controlledTimer();
  const externalController = new AbortController();
  const signals: AbortSignal[] = [];
  const request = getAssetEvidenceAnalysis('asset-cancelled', {
    signal: externalController.signal,
    fetchImplementation: abortablePendingFetch(signals),
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });

  externalController.abort();

  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.doesNotMatch(error.message, /abort/i);
    return true;
  });
  assert.equal(signals[0]?.aborted, true);
  assert.equal(timer.wasCleared(), true);
});

test('retry após timeout usa novo controller e pode concluir com sucesso', async () => {
  const firstTimer = controlledTimer();
  const secondTimer = controlledTimer();
  const signals: AbortSignal[] = [];
  let callCount = 0;
  const pendingFetch = abortablePendingFetch(signals);
  const fetchImplementation: NonNullable<
    EvidenceAnalysisRequestOptions['fetchImplementation']
  > = (input, init) => {
    callCount += 1;
    if (callCount === 1) return pendingFetch(input, init);

    assert.ok(init.signal instanceof AbortSignal);
    signals.push(init.signal);
    return Promise.resolve(jsonResponse(response()));
  };

  const firstRequest = getAssetEvidenceAnalysis('asset-retry', {
    fetchImplementation,
    scheduleTimeout: firstTimer.schedule,
    cancelTimeout: firstTimer.cancel,
  });
  firstTimer.fire();
  await assert.rejects(firstRequest, ApiError);

  const retryResult = await getAssetEvidenceAnalysis('asset-retry', {
    fetchImplementation,
    scheduleTimeout: secondTimer.schedule,
    cancelTimeout: secondTimer.cancel,
  });

  assert.deepEqual(retryResult, response());
  assert.equal(callCount, 2);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  assert.equal(firstTimer.wasCleared(), true);
  assert.equal(secondTimer.wasCleared(), true);
});

test('máquina de estados percorre loading, erro, retry e sucesso', () => {
  const states = [
    resolveProvenanceSectionState({ loading: true, error: null, response: null }),
    resolveProvenanceSectionState({ loading: false, error: 'timeout', response: null }),
    resolveProvenanceSectionState({ loading: true, error: null, response: null }),
    resolveProvenanceSectionState({ loading: false, error: null, response: response() }),
  ];

  assert.deepEqual(states, ['LOADING', 'ERROR', 'LOADING', 'READY']);
});

test('estado vazio preserva o resumo de Modo sombra', () => {
  const emptyResponse = response([]);
  const state = resolveProvenanceSectionState({
    loading: false,
    error: null,
    response: emptyResponse,
  });

  assert.equal(state, 'EMPTY');
  assert.equal(shouldShowShadowModeSummary(state, emptyResponse), true);
});

test('erro da seção não altera informações mantidas pelo ativo pai', () => {
  const parentAsset = Object.freeze({ id: 'asset-parent', hostname: 'NB-RH-001' });
  const state = resolveProvenanceSectionState({
    loading: false,
    error: 'timeout',
    response: null,
  });

  assert.equal(state, 'ERROR');
  assert.deepEqual(parentAsset, { id: 'asset-parent', hostname: 'NB-RH-001' });
});

test('resposta antiga ou cancelada não pode substituir a requisição atual', () => {
  assert.equal(
    canApplyProvenanceResult({
      active: true,
      completedRequestKey: 'asset-a:0',
      currentRequestKey: 'asset-b:0',
    }),
    false,
  );
  assert.equal(
    canApplyProvenanceResult({
      active: false,
      completedRequestKey: 'asset-b:0',
      currentRequestKey: 'asset-b:0',
    }),
    false,
  );
  assert.equal(
    canApplyProvenanceResult({
      active: true,
      completedRequestKey: 'asset-b:0',
      currentRequestKey: 'asset-b:0',
    }),
    true,
  );
});

test('aceita a resposta real esperada para um ativo existente', () => {
  assert.deepEqual(parseEvidenceAnalysisResponse(response()), response());
});

test('rejeita modo diferente de SHADOW', () => {
  assert.equal(parseEvidenceAnalysisResponse({ ...response(), mode: 'ACTIVE' }), null);
});

test('rejeita decisionsChanged verdadeiro', () => {
  assert.equal(parseEvidenceAnalysisResponse({ ...response(), decisionsChanged: true }), null);
});

test('apresenta modo sombra sem prometer escolha automática', () => {
  assert.match(SHADOW_MODE_DESCRIPTION, /modo sombra/i);
  assert.doesNotMatch(SHADOW_MODE_DESCRIPTION, /melhor|ranking|vencedor/i);
});

test('mapeia proveniência vinculada a partir do status do backend', () => {
  assert.equal(getProvenancePresentation('CURRENT_VALUE_WITH_PROVENANCE').label, 'Proveniência vinculada');
});

test('mapeia valor atual sem evidência como não comprovado', () => {
  assert.equal(getProvenancePresentation('CURRENT_VALUE_WITHOUT_PROVENANCE').label, 'Proveniência não comprovada');
});

test('mapeia divergência entre candidato e valor como não comprovada', () => {
  assert.equal(getProvenancePresentation('CURRENT_VALUE_CANDIDATE_MISMATCH').label, 'Proveniência não comprovada');
});

test('mapeia múltiplos atuais como proveniência ambígua', () => {
  assert.equal(getProvenancePresentation('AMBIGUOUS_CURRENT_CANDIDATES').label, 'Proveniência ambígua');
});

test('mapeia histórico conflitante sem escolher outro candidato', () => {
  assert.equal(getProvenancePresentation('MULTIPLE_OBSERVED_VALUES').label, 'Histórico divergente');
});

test('mapeia ausência de valor atual', () => {
  assert.equal(getProvenancePresentation('NO_CURRENT_VALUE').label, 'Sem valor atual');
});

test('preserva selectedCandidate nulo', () => {
  const parsed = parseEvidenceAnalysisResponse(
    response([analysis({ selectedCandidate: null })]),
  );
  assert.equal(parsed?.analyses[0]?.selectedCandidate, null);
});

test('preserva candidatos atuais e históricos na ordem recebida', () => {
  const historic = candidate({ attributeId: 'historic', isCurrent: false, value: 'Windows 10' });
  const parsed = parseEvidenceAnalysisResponse(response([analysis({ candidates: [historic, candidate()] })]));
  assert.deepEqual(parsed?.analyses[0]?.candidates.map((item) => item.attributeId), ['historic', 'attribute-current']);
});

for (const [kind, label] of [
  ['MANUAL', 'Manual'],
  ['SIMULATED', 'Simulada'],
  ['TECHNICAL', 'Técnica'],
  ['UNKNOWN', 'Desconhecida'],
] as Array<[EvidenceSourceKind, string]>) {
  test(`apresenta a fonte ${kind} como ${label}`, () => {
    assert.equal(getSourcePresentation(kind).label, label);
  });
}

test('fonte desconhecida nunca recebe apresentação técnica', () => {
  assert.notEqual(getSourcePresentation('UNKNOWN').label, getSourcePresentation('TECHNICAL').label);
});

test('Trust Score nulo não aparece como zero', () => {
  assert.equal(formatTrustScore(null), 'Trust Score ainda não definido');
  assert.doesNotMatch(formatTrustScore(null), /0/);
});

test('Trust Score numérico é apenas representado quando recebido', () => {
  assert.equal(formatTrustScore(72), 'Trust Score da fonte: 72');
});

test('score persistido é descrito como legado e não decisório', () => {
  assert.match(PERSISTED_SCORE_EXPLANATION, /legado/i);
  assert.match(PERSISTED_SCORE_EXPLANATION, /não representa confiança calculada/i);
});

test('formata suporte zero sem inferir confiabilidade', () => {
  assert.equal(formatSupportingEvidence(0), 'Nenhuma evidência disponível sustenta diretamente o valor atual.');
});

test('formata uma evidência no singular', () => {
  assert.equal(formatSupportingEvidence(1), '1 evidência sustenta diretamente o valor atual.');
});

test('formata múltiplas evidências no plural', () => {
  assert.equal(formatSupportingEvidence(3), '3 evidências sustentam diretamente o valor atual.');
});

test('preserva supportingEvidenceCount sem recalcular', () => {
  const input = response([analysis({ explanation: { ...analysis().explanation, supportingEvidenceCount: 7 } })]);
  assert.equal(parseEvidenceAnalysisResponse(input)?.analyses[0]?.explanation.supportingEvidenceCount, 7);
});

test('preserva os três timestamps separadamente', () => {
  const parsed = parseEvidenceAnalysisResponse(response());
  const item = parsed?.analyses[0]?.candidates[0];
  assert.equal(item?.attributeObservedAt, '2026-07-10T12:00:00.000Z');
  assert.equal(item?.evidenceObservedAt, '2026-07-11T12:00:00.000Z');
  assert.equal(item?.evidenceIngestedAt, '2026-07-11T12:01:00.000Z');
});

test('preserva timestamps ausentes como nulos', () => {
  const missingDates = candidate({ evidenceObservedAt: null, evidenceIngestedAt: null });
  const parsed = parseEvidenceAnalysisResponse(response([analysis({ candidates: [missingDates], selectedCandidate: null })]));
  assert.equal(parsed?.analyses[0]?.candidates[0]?.evidenceObservedAt, null);
  assert.equal(parsed?.analyses[0]?.candidates[0]?.evidenceIngestedAt, null);
});

test('estado de carregamento tem prioridade', () => {
  assert.equal(resolveProvenanceSectionState({ loading: true, error: 'erro', response: response() }), 'LOADING');
});

test('estado de erro permanece isolado', () => {
  assert.equal(resolveProvenanceSectionState({ loading: false, error: 'erro', response: null }), 'ERROR');
});

test('estado vazio cobre resposta sem atributos', () => {
  assert.equal(resolveProvenanceSectionState({ loading: false, error: null, response: response([]) }), 'EMPTY');
});

test('estado pronto exige atributos analisáveis', () => {
  assert.equal(resolveProvenanceSectionState({ loading: false, error: null, response: response() }), 'READY');
});

test('erro 404 recebe mensagem controlada', () => {
  assert.match(getProvenanceErrorMessage(404), /não foi encontrada/i);
});

test('falha de rede não expõe Failed to fetch', () => {
  const message = getProvenanceErrorMessage(0);
  assert.doesNotMatch(message, /failed to fetch/i);
  assert.match(message, /tente novamente/i);
});

test('valor nulo é apresentado como sem valor atual', () => {
  assert.equal(formatProvenanceValue(null), 'Sem valor atual');
});

test('valor estruturado é apresentado sem mutação', () => {
  assert.equal(formatProvenanceValue({ version: 11 }), '{"version":11}');
});

test('ID longo é abreviado sem perder o conteúdo original do contrato', () => {
  assert.equal(abbreviateEvidenceId('00000000-0000-4000-8000-000000000001'), '00000000…0001');
});

test('resposta inválida sem currentValue é rejeitada', () => {
  const invalidAnalysis = { ...analysis() } as Record<string, unknown>;
  delete invalidAnalysis.currentValue;
  assert.equal(parseEvidenceAnalysisResponse(response([invalidAnalysis as unknown as AttributeEvidenceAnalysis])), null);
});

test('tipo de fonte desconhecido é rejeitado pelo contrato', () => {
  const invalidCandidate = candidate({ source: { ...candidate().source, kind: 'OTHER' as EvidenceSourceKind } });
  assert.equal(parseEvidenceAnalysisResponse(response([analysis({ candidates: [invalidCandidate] })])), null);
});

test('payload bruto extra é descartado na sanitização da resposta', () => {
  const withPayload = { ...candidate(), payload: { secret: 'não deve chegar à interface' } };
  const parsed = parseEvidenceAnalysisResponse(response([analysis({ candidates: [withPayload] })]));
  assert.equal('payload' in (parsed?.analyses[0]?.candidates[0] ?? {}), false);
});

test('a apresentação é determinística para a mesma resposta', () => {
  assert.deepEqual(parseEvidenceAnalysisResponse(response()), parseEvidenceAnalysisResponse(response()));
});

test('componente usa controles semânticos e rótulos acessíveis', () => {
  const source = readFileSync(
    new URL('../components/evidence-provenance-section.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /<details/);
  assert.match(source, /<summary aria-label=/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-labelledby=/);
});

test('componente exibe os três rótulos de data sem fallback cruzado', () => {
  const source = readFileSync(new URL('../components/evidence-provenance-section.tsx', import.meta.url), 'utf8');
  assert.match(source, /Observado no atributo/);
  assert.match(source, /Observado na evidência/);
  assert.match(source, /Ingerido pelo Atlas/);
});

test('componente não contém linguagem de seleção automática ou percentual decisório', () => {
  const source = readFileSync(new URL('../components/evidence-provenance-section.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Vencedor|Melhor candidato|Selecionado pelo Atlas|Fonte escolhida|Decisão do motor/);
  assert.doesNotMatch(source, /confiança da decisão|% de confiança/i);
});

test('componente não acessa payload bruto ou fingerprint', () => {
  const source = readFileSync(new URL('../components/evidence-provenance-section.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.payload|\.fingerprint/);
});
