import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, getAssetConflictAnalysis, getConflictFindings } from './api.ts';
import {
  conflictFindingQueryFromSearchParams,
  formatTemporalDifference,
  getConflictFindingTypeLabel,
  getConflictReviewOptionLabel,
  getConflictSourceTypeLabel,
  getConflictTemporalRelationshipLabel,
  hasConflictFindingFilters,
  isMatchingDetailedFinding,
  parseConflictFindingsResponse,
  parseIdentityNetworkAnalysisResponse,
  serializeConflictFindingQuery,
} from './conflict-findings.ts';

const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = '22222222-2222-4222-8222-222222222222';
const FINDING_ID = 'finding_0123456789abcdef01234567';

function listItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findingId: FINDING_ID,
    type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    requiresHumanReview: true,
    affectedAssetIds: [ASSET_A, ASSET_B],
    affectedAssets: [
      { assetId: ASSET_A, persistedName: 'SRV-APP-01' },
      { assetId: ASSET_B, persistedName: 'SRV-APP-02' },
    ],
    normalizedHostname: 'srv-app',
    normalizedIp: null,
    temporalContext: {
      firstObservedAt: '2026-07-15T10:00:00.000Z',
      lastObservedAt: '2026-07-15T11:00:00.000Z',
      differenceMilliseconds: 3_600_000,
      relationship: 'DISTINCT_OBSERVATION_TIMES',
    },
    sourceTypes: ['TECHNICAL', 'SIMULATED'],
    observationCount: 2,
    currentObservationCount: 1,
    historicalObservationCount: 1,
    explanationSummary: 'O mesmo hostname foi observado em ativos diferentes.',
    limitationCount: 1,
    reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS', 'NEEDS_MORE_EVIDENCE'],
    ...overrides,
  };
}

function aggregate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'SHADOW',
    policyVersion: '2026-07-conflict-v1',
    generatedAt: '2026-07-15T12:00:00.000Z',
    decisionsChanged: false,
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems: 1,
      totalPages: 1,
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
      totalFindings: 1,
      affectedAssets: 2,
      findingsWithLimitations: 1,
      byType: {
        DUPLICATE_HOSTNAME_ACROSS_ASSETS: 1,
        SHARED_IP_DIFFERENT_HOSTNAMES: 0,
        HOSTNAME_DIVERGENCE_ON_ASSET: 0,
      },
    },
    items: [listItem()],
    limitations: ['A análise opera em modo sombra.'],
    ...overrides,
  };
}

function detailFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findingId: FINDING_ID,
    type: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
    mode: 'SHADOW',
    requiresHumanReview: true,
    affectedAssetIds: [ASSET_A, ASSET_B],
    normalizedHostname: 'srv-app',
    normalizedIp: null,
    observations: [
      {
        assetId: ASSET_A,
        value: 'SRV-APP',
        normalizedValue: 'srv-app',
        attribute: 'HOSTNAME',
        source: 'inventory-agent',
        sourceType: 'TECHNICAL',
        evidenceId: null,
        observedAt: null,
        ingestedAt: '2026-07-15T10:00:00.000Z',
        current: true,
        raw: { secret: 'discarded' },
      },
    ],
    temporalContext: (listItem().temporalContext as Record<string, unknown>),
    explanation: ['Os registros precisam de revisão humana.'],
    limitations: ['Não determina a identidade correta.'],
    reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
    ...overrides,
  };
}

function individual(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ASSET_A,
    mode: 'SHADOW',
    policyVersion: '2026-07-conflict-v1',
    generatedAt: '2026-07-15T12:00:00.000Z',
    summary: { totalFindings: 1, requiresHumanReview: 1 },
    findings: [detailFinding()],
    limitations: ['A análise não persiste decisões.'],
    decisionsChanged: false,
    ...overrides,
  };
}

test('parser agregado aceita a resposta válida e preserva a semântica do backend', () => {
  const parsed = parseConflictFindingsResponse(aggregate());
  assert.ok(parsed);
  assert.equal(parsed.items[0]?.findingId, FINDING_ID);
  assert.equal(parsed.summary.totalFindings, 1);
  assert.equal(parsed.mode, 'SHADOW');
  assert.equal(parsed.decisionsChanged, false);
});

test('parser agregado aceita uma página vazia com contagens zero', () => {
  const parsed = parseConflictFindingsResponse(
    aggregate({
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
      summary: {
        totalFindings: 0,
        affectedAssets: 0,
        findingsWithLimitations: 0,
        byType: { DUPLICATE_HOSTNAME_ACROSS_ASSETS: 0, SHARED_IP_DIFFERENT_HOSTNAMES: 0, HOSTNAME_DIVERGENCE_ON_ASSET: 0 },
      },
      items: [],
    }),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.items, []);
  assert.equal(parsed.pagination.totalPages, 0);
});

test('parser preserva paginação, filtros false e resumo global sem recalcular pelos items', () => {
  const parsed = parseConflictFindingsResponse(
    aggregate({
      pagination: { page: 2, pageSize: 10, totalItems: 38, totalPages: 4, hasNextPage: true, hasPreviousPage: true },
      filters: { type: null, assetId: null, hostname: null, ip: null, sourceType: null, temporalRelationship: null, hasLimitations: false },
      summary: {
        totalFindings: 38,
        affectedAssets: 25,
        findingsWithLimitations: 8,
        byType: { DUPLICATE_HOSTNAME_ACROSS_ASSETS: 20, SHARED_IP_DIFFERENT_HOSTNAMES: 10, HOSTNAME_DIVERGENCE_ON_ASSET: 8 },
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.filters.hasLimitations, false);
  assert.equal(parsed.summary.totalFindings, 38);
  assert.equal(parsed.items.length, 1);
});

for (const type of [
  'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
  'SHARED_IP_DIFFERENT_HOSTNAMES',
  'HOSTNAME_DIVERGENCE_ON_ASSET',
] as const) {
  test(`parser aceita o tipo ${type}`, () => {
    const parsed = parseConflictFindingsResponse(aggregate({ items: [listItem({ type })] }));
    assert.equal(parsed?.items[0]?.type, type);
  });
}

test('parser preserva fontes técnicas, manuais, simuladas e desconhecidas', () => {
  const parsed = parseConflictFindingsResponse(
    aggregate({ items: [listItem({ sourceTypes: ['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN'] })] }),
  );
  assert.deepEqual(parsed?.items[0]?.sourceTypes, ['MANUAL', 'TECHNICAL', 'SIMULATED', 'UNKNOWN']);
});

for (const relationship of [
  'SAME_OBSERVATION_TIME',
  'DISTINCT_OBSERVATION_TIMES',
  'PARTIAL_TEMPORAL_CONTEXT',
  'NO_TEMPORAL_CONTEXT',
] as const) {
  test(`parser aceita o contexto temporal ${relationship}`, () => {
    const parsed = parseConflictFindingsResponse(
      aggregate({
        items: [listItem({ temporalContext: { firstObservedAt: null, lastObservedAt: null, differenceMilliseconds: relationship === 'SAME_OBSERVATION_TIME' ? 0 : null, relationship } })],
      }),
    );
    assert.equal(parsed?.items[0]?.temporalContext.relationship, relationship);
  });
}

test('parser preserva contagens zero e datas nulas', () => {
  const parsed = parseConflictFindingsResponse(
    aggregate({
      items: [listItem({ observationCount: 0, currentObservationCount: 0, historicalObservationCount: 0, temporalContext: { firstObservedAt: null, lastObservedAt: null, differenceMilliseconds: 0, relationship: 'NO_TEMPORAL_CONTEXT' } })],
    }),
  );
  assert.equal(parsed?.items[0]?.observationCount, 0);
  assert.equal(parsed?.items[0]?.temporalContext.firstObservedAt, null);
  assert.equal(parsed?.items[0]?.temporalContext.differenceMilliseconds, 0);
});

test('parser preserva reviewOptions e limitações globais como textos', () => {
  const parsed = parseConflictFindingsResponse(aggregate());
  assert.deepEqual(parsed?.items[0]?.reviewOptions, ['SAME_ASSET', 'DIFFERENT_ASSETS', 'NEEDS_MORE_EVIDENCE']);
  assert.deepEqual(parsed?.limitations, ['A análise opera em modo sombra.']);
});

test('parser descarta campos adicionais e payload bruto', () => {
  const parsed = parseConflictFindingsResponse(
    aggregate({ secret: 'discarded', items: [listItem({ raw: { token: 'discarded' }, fingerprint: 'discarded' })] }),
  );
  assert.ok(parsed);
  assert.equal('secret' in parsed, false);
  assert.equal('raw' in parsed.items[0]!, false);
  assert.equal('fingerprint' in parsed.items[0]!, false);
});

test('parser rejeita resposta e enums inválidos', () => {
  assert.equal(parseConflictFindingsResponse({}), null);
  assert.equal(parseConflictFindingsResponse(aggregate({ mode: 'WRITE' })), null);
  assert.equal(parseConflictFindingsResponse(aggregate({ items: [listItem({ type: 'CONFIRMED_CONFLICT' })] })), null);
});

test('parser rejeita IDs inseguros e contagens incoerentes', () => {
  assert.equal(parseConflictFindingsResponse(aggregate({ items: [listItem({ affectedAssetIds: ['../admin'] })] })), null);
  assert.equal(parseConflictFindingsResponse(aggregate({ items: [listItem({ observationCount: 9 })] })), null);
});

test('parser individual descarta raw e preserva nulidade da evidência e datas', () => {
  const parsed = parseIdentityNetworkAnalysisResponse(individual());
  assert.ok(parsed);
  assert.equal(parsed.findings[0]?.observations[0]?.evidenceId, null);
  assert.equal(parsed.findings[0]?.observations[0]?.observedAt, null);
  assert.equal('raw' in parsed.findings[0]!.observations[0]!, false);
});

test('paridade individual exige findingId, tipo, valor e conjunto de ativos iguais', () => {
  const aggregateParsed = parseConflictFindingsResponse(aggregate());
  const individualParsed = parseIdentityNetworkAnalysisResponse(individual());
  assert.ok(aggregateParsed && individualParsed);
  assert.equal(isMatchingDetailedFinding(aggregateParsed.items[0]!, individualParsed.findings[0]!), true);
  assert.equal(isMatchingDetailedFinding(aggregateParsed.items[0]!, { ...individualParsed.findings[0]!, findingId: 'finding_aaaaaaaaaaaaaaaaaaaaaaaa' }), false);
});

test('serialização preserva false e valores zero, codifica espaços, IPv4 e IPv6', () => {
  const serialized = serializeConflictFindingQuery({
    page: 1,
    pageSize: 25,
    hostname: 'srv app 01',
    ip: '2001:db8::1',
    hasLimitations: false,
  });
  const parsed = new URLSearchParams(serialized);
  assert.equal(parsed.get('page'), '1');
  assert.equal(parsed.get('hasLimitations'), 'false');
  assert.equal(parsed.get('hostname'), 'srv app 01');
  assert.equal(parsed.get('ip'), '2001:db8::1');
  assert.equal(new URLSearchParams(serializeConflictFindingQuery({ ip: '10.20.0.15' })).get('ip'), '10.20.0.15');
});

test('serialização omite parâmetros vazios e indefinidos', () => {
  assert.equal(serializeConflictFindingQuery({ hostname: '', ip: undefined }), '');
});

test('leitura segura da URL mantém false e ignora valores inválidos', () => {
  const parsed = conflictFindingQueryFromSearchParams({
    page: '-1',
    pageSize: '500',
    type: 'INVALID',
    hostname: '  srv exemplo  ',
    hasLimitations: 'false',
  });
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 25);
  assert.equal(parsed.type, undefined);
  assert.equal(parsed.hostname, 'srv exemplo');
  assert.equal(parsed.hasLimitations, false);
  assert.equal(hasConflictFindingFilters(parsed), true);
});

test('labels amigáveis não expõem enums técnicos', () => {
  assert.equal(getConflictFindingTypeLabel('DUPLICATE_HOSTNAME_ACROSS_ASSETS'), 'Hostname associado a ativos diferentes');
  assert.equal(getConflictSourceTypeLabel('UNKNOWN'), 'Desconhecida');
  assert.equal(getConflictTemporalRelationshipLabel('PARTIAL_TEMPORAL_CONTEXT'), 'Contexto temporal parcial');
  assert.equal(getConflictReviewOptionLabel('IP_REUSED'), 'O endereço IP pode ter sido reutilizado');
});

test('formatação temporal preserva zero, nulo e unidades amigáveis', () => {
  assert.equal(formatTemporalDifference(null), 'Não informado');
  assert.equal(formatTemporalDifference(0), '0 minutos');
  assert.equal(formatTemporalDifference(30_000), 'Menos de 1 minuto');
  assert.equal(formatTemporalDifference(90_000_000), '1 dia, 1 hora');
});

test('cliente agregado usa somente GET, serializa false e executa o parser seguro', async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const parsed = await getConflictFindings(
    { hostname: 'SRV APP', hasLimitations: false },
    {
      fetchImplementation: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify(aggregate({ unknown: 'discarded' })), { status: 200 });
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init.method, undefined);
  assert.match(calls[0]?.input ?? '', /conflict-analysis\/findings/);
  assert.equal(new URL(calls[0]!.input).searchParams.get('hasLimitations'), 'false');
  assert.equal(new URL(calls[0]!.input).searchParams.get('hostname'), 'SRV APP');
  assert.equal('unknown' in parsed, false);
});

test('cliente individual codifica o assetId e rejeita resposta inválida sem expor internals', async () => {
  let requestedUrl = '';
  await assert.rejects(
    getAssetConflictAnalysis('asset/unsafe', {
      fetchImplementation: async (input) => {
        requestedUrl = input;
        return new Response(JSON.stringify({ raw: { secret: true } }), { status: 200 });
      },
    }),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
  assert.match(requestedUrl, /asset%2Funsafe/);
});

test('cliente retorna erro controlado em timeout e cancela o temporizador', async () => {
  let timeoutCallback: (() => void) | null = null;
  let cancelled = false;
  const request = getConflictFindings({}, {
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    scheduleTimeout: (callback) => {
      timeoutCallback = callback;
      return {} as ReturnType<typeof setTimeout>;
    },
    cancelTimeout: () => {
      cancelled = true;
    },
  });
  assert.ok(timeoutCallback);
  (timeoutCallback as () => void)();
  await assert.rejects(request, (error: unknown) => error instanceof ApiError && error.status === 408);
  assert.equal(cancelled, true);
});
