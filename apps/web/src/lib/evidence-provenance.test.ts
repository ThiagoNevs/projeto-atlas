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
  formatPolicyScore,
  formatShadowValue,
  formatSupportingEvidence,
  formatTrustScore,
  getProvenanceErrorMessage,
  getProvenancePresentation,
  getSourcePresentation,
  getShadowCriterionLabel,
  getShadowCriterionResultLabel,
  getShadowDecisionPresentation,
  getShadowDivergenceLabel,
  parseEvidenceAnalysisResponse,
  PERSISTED_SCORE_EXPLANATION,
  resolveProvenanceSectionState,
  SHADOW_MODE_DESCRIPTION,
  shouldShowShadowModeSummary,
  type AssetEvidenceAnalysisResponse,
  type AttributeEvidenceAnalysis,
  type EvidenceAnalysisCandidate,
  type EvidenceSourceKind,
  type ShadowCandidateAssessment,
  type ShadowDecision,
  type ShadowDecisionStatus,
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

function shadowAssessment(
  overrides: Partial<ShadowCandidateAssessment> = {},
): ShadowCandidateAssessment {
  return {
    candidateId: 'attribute-current',
    value: 'Windows 11',
    normalizedValue: 'windows 11',
    evidenceId: '00000000-0000-4000-8000-000000000001',
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
      supportingCandidateIds: ['attribute-current'],
      supportingEvidenceIds: ['00000000-0000-4000-8000-000000000001'],
    },
    divergesFromCurrentValue: false,
    assessments: [shadowAssessment()],
    tiedValues: [],
    explanation: ['A política recomendaria manter o valor atual.'],
    limitations: ['Nenhuma decisão foi aplicada.'],
    policyVersion: '2026-07-v1',
    scoreMeaning: 'Prioridade definida pela política, não probabilidade de correção.',
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

test('aceita e preserva o contrato completo de shadowDecision', () => {
  const decision = shadowDecision();
  const parsed = parseEvidenceAnalysisResponse(
    response([analysis({ shadowDecision: decision })]),
  );

  assert.deepEqual(parsed?.analyses[0]?.shadowDecision, decision);
});

test('mantém compatibilidade com respostas anteriores sem shadowDecision', () => {
  const parsed = parseEvidenceAnalysisResponse(response());
  assert.equal(parsed?.analyses[0]?.shadowDecision, undefined);
});

for (const status of [
  'CURRENT_VALUE_CONFIRMED',
  'RECOMMENDED',
  'TIED',
  'INSUFFICIENT_EVIDENCE',
  'NO_CURRENT_VALUE',
  'NO_CANDIDATES',
] as ShadowDecisionStatus[]) {
  test(`aceita o status real de decisão ${status}`, () => {
    const parsed = parseEvidenceAnalysisResponse(
      response([analysis({ shadowDecision: shadowDecision({ status }) })]),
    );
    assert.equal(parsed?.analyses[0]?.shadowDecision?.status, status);
    assert.ok(getShadowDecisionPresentation(status).label.length > 0);
  });
}

test('preserva recommendedCandidate presente e nulo sem confundir com selectedCandidate', () => {
  const withRecommendation = parseEvidenceAnalysisResponse(
    response([analysis({ shadowDecision: shadowDecision() })]),
  );
  const withoutRecommendation = parseEvidenceAnalysisResponse(
    response([
      analysis({
        shadowDecision: shadowDecision({
          status: 'INSUFFICIENT_EVIDENCE',
          recommendedCandidate: null,
        }),
      }),
    ]),
  );

  assert.equal(
    withRecommendation?.analyses[0]?.shadowDecision?.recommendedCandidate?.normalizedValue,
    'windows 11',
  );
  assert.equal(withoutRecommendation?.analyses[0]?.shadowDecision?.recommendedCandidate, null);
  assert.equal(withRecommendation?.analyses[0]?.selectedCandidate?.attributeId, 'attribute-current');
});

for (const divergence of [true, false, null] as Array<boolean | null>) {
  test(`preserva divergência ${String(divergence)}`, () => {
    const parsed = parseEvidenceAnalysisResponse(
      response([
        analysis({
          shadowDecision: shadowDecision({ divergesFromCurrentValue: divergence }),
        }),
      ]),
    );
    assert.equal(
      parsed?.analyses[0]?.shadowDecision?.divergesFromCurrentValue,
      divergence,
    );
  });
}

test('preserva policyScore numérico e null sem recalcular critérios', () => {
  const decision = shadowDecision({
    assessments: [
      shadowAssessment({ policyScore: 77 }),
      shadowAssessment({ candidateId: 'ineligible', policyScore: null, eligible: false }),
    ],
  });
  const parsed = parseEvidenceAnalysisResponse(
    response([analysis({ shadowDecision: decision })]),
  );

  assert.deepEqual(
    parsed?.analyses[0]?.shadowDecision?.assessments.map((item) => item.policyScore),
    [77, null],
  );
  assert.equal(formatPolicyScore(null), 'Não aplicável');
});

test('preserva tiedValues na ordem retornada pelo backend', () => {
  const decision = shadowDecision({
    status: 'TIED',
    recommendedCandidate: null,
    divergesFromCurrentValue: null,
    tiedValues: [
      {
        value: 'Windows 10',
        normalizedValue: 'windows 10',
        policyScore: 90,
        supportingCandidateIds: ['a'],
      },
      {
        value: 'Windows 11',
        normalizedValue: 'windows 11',
        policyScore: 90,
        supportingCandidateIds: ['b'],
      },
    ],
  });
  const parsed = parseEvidenceAnalysisResponse(
    response([analysis({ shadowDecision: decision })]),
  );

  assert.deepEqual(
    parsed?.analyses[0]?.shadowDecision?.tiedValues.map((item) => item.normalizedValue),
    ['windows 10', 'windows 11'],
  );
});

test('preserva assessments elegíveis, inelegíveis, critérios, pontos e explicações', () => {
  const decision = shadowDecision({
    assessments: [
      shadowAssessment(),
      shadowAssessment({
        candidateId: 'simulated',
        sourceType: 'SIMULATED',
        eligible: false,
        policyScore: null,
        criteria: [
          {
            criterion: 'SOURCE_TYPE',
            result: 'NEGATIVE',
            points: 0,
            explanation: 'A fonte simulada é inelegível.',
          },
        ],
        limitations: ['A fonte simulada não recomenda alteração em dados reais.'],
      }),
    ],
  });
  const parsed = parseEvidenceAnalysisResponse(
    response([analysis({ shadowDecision: decision })]),
  );
  const assessments = parsed?.analyses[0]?.shadowDecision?.assessments;

  assert.equal(assessments?.[0]?.eligible, true);
  assert.equal(assessments?.[1]?.eligible, false);
  assert.deepEqual(assessments?.[1]?.criteria[0], decision.assessments[1]?.criteria[0]);
  assert.equal(getShadowCriterionLabel('SOURCE_TYPE'), 'Tipo da fonte');
  assert.equal(getShadowCriterionResultLabel('NEGATIVE'), 'Não contribuiu');
});

test('valor normalizado null fica inelegível e não recebe score numérico', () => {
  const parsed = parseEvidenceAnalysisResponse(
    response([
      analysis({
        shadowDecision: shadowDecision({
          status: 'INSUFFICIENT_EVIDENCE',
          recommendedCandidate: null,
          assessments: [
            shadowAssessment({
              value: '   ',
              normalizedValue: null,
              eligible: false,
              policyScore: null,
            }),
          ],
        }),
      }),
    ]),
  );
  const empty = parsed?.analyses[0]?.shadowDecision?.assessments[0];

  assert.equal(empty?.normalizedValue, null);
  assert.equal(empty?.eligible, false);
  assert.equal(empty?.policyScore, null);
  assert.equal(formatShadowValue(empty?.normalizedValue), 'Sem valor válido');
});

test('zero e falso permanecem valores válidos sem avaliação por truthiness', () => {
  assert.equal(formatShadowValue(0), '0');
  assert.equal(formatShadowValue(false), 'false');
  assert.equal(formatShadowValue('0'), '0');
  assert.equal(formatShadowValue('false'), 'false');

  const parsed = parseEvidenceAnalysisResponse(
    response([
      analysis({
        shadowDecision: shadowDecision({
          currentValue: false,
          assessments: [shadowAssessment({ value: 0, normalizedValue: '0' })],
        }),
      }),
    ]),
  );
  assert.equal(parsed?.analyses[0]?.shadowDecision?.currentValue, false);
  assert.equal(parsed?.analyses[0]?.shadowDecision?.assessments[0]?.value, 0);
});

test('descarta campos desconhecidos e payload bruto dentro de shadowDecision', () => {
  const unsafeAssessment = {
    ...shadowAssessment(),
    rawPayload: { secret: 'não deve chegar à interface' },
    fingerprint: 'interno',
  };
  const unsafeDecision = {
    ...shadowDecision({ assessments: [unsafeAssessment] }),
    rawPayload: { internal: true },
  };
  const parsed = parseEvidenceAnalysisResponse(
    response([
      analysis({ shadowDecision: unsafeDecision as unknown as ShadowDecision }),
    ]),
  );
  const sanitizedDecision = parsed?.analyses[0]?.shadowDecision;
  const sanitizedAssessment = sanitizedDecision?.assessments[0] ?? {};

  assert.equal('rawPayload' in (sanitizedDecision ?? {}), false);
  assert.equal('rawPayload' in sanitizedAssessment, false);
  assert.equal('fingerprint' in sanitizedAssessment, false);
});

test('rejeita shadowDecision inválido sem aceitar status ou critério inventado', () => {
  const invalidStatus = {
    ...shadowDecision(),
    status: 'APPLIED',
  };
  const invalidCriterion = shadowDecision({
    assessments: [
      shadowAssessment({
        criteria: [
          {
            criterion: 'MAGIC_SCORE' as never,
            result: 'POSITIVE',
            points: 100,
            explanation: 'Inválido.',
          },
        ],
      }),
    ],
  });

  assert.equal(
    parseEvidenceAnalysisResponse(
      response([analysis({ shadowDecision: invalidStatus as unknown as ShadowDecision })]),
    ),
    null,
  );
  assert.equal(
    parseEvidenceAnalysisResponse(
      response([analysis({ shadowDecision: invalidCriterion })]),
    ),
    null,
  );
});

test('rejeita assessment que apresenta fonte inelegível ou valor vazio como elegível', () => {
  const simulatedEligible = shadowDecision({
    assessments: [
      shadowAssessment({ sourceType: 'SIMULATED', eligible: true, policyScore: 95 }),
    ],
  });
  const emptyEligible = shadowDecision({
    assessments: [
      shadowAssessment({ value: '  ', normalizedValue: null, eligible: true, policyScore: 95 }),
    ],
  });

  for (const invalid of [simulatedEligible, emptyEligible]) {
    assert.equal(
      parseEvidenceAnalysisResponse(response([analysis({ shadowDecision: invalid })])),
      null,
    );
  }
});

test('mapeia a comparação sem transformar ausência em divergência', () => {
  assert.equal(getShadowDivergenceLabel(true), 'Diverge do valor persistido');
  assert.equal(getShadowDivergenceLabel(false), 'Equivalente ao valor persistido');
  assert.equal(getShadowDivergenceLabel(null), 'Comparação não disponível');
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
