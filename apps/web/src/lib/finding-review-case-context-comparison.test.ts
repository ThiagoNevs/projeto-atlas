import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from './api-error.ts';
import { getFindingReviewCaseContextComparison } from './api.ts';
import {
  parseFindingReviewCaseContextComparison,
  parseFindingReviewSnapshot,
} from './finding-review-case-context-comparison.ts';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';
const FINDING_ID = 'finding_0123456789abcdef01234567';
const NOW = '2026-08-30T12:00:00.000Z';

const snapshot = {
  snapshotVersion: 1,
  findingId: FINDING_ID,
  findingType: 'DUPLICATE_HOSTNAME_ACROSS_ASSETS',
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
      attribute: 'HOSTNAME',
      source: 'fixture',
      sourceType: 'TECHNICAL',
      evidenceId: EVIDENCE_ID,
      observedAt: NOW,
      ingestedAt: NOW,
      current: true,
    },
  ],
  sources: [{ identifier: 'fixture', type: 'TECHNICAL' }],
  temporalContext: {
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    differenceMilliseconds: 0,
    relationship: 'SAME_OBSERVATION_TIME',
  },
  explanation: ['Hostname repetido.'],
  limitations: [],
  reviewOptions: ['SAME_ASSET', 'DIFFERENT_ASSETS'],
};

const validResponse = {
  caseId: CASE_ID,
  caseVersion: 4,
  comparedAt: NOW,
  baseline: {
    kind: 'ORIGINAL',
    findingId: FINDING_ID,
    policyVersion: '2026-07-v1',
    snapshotHash: 'a'.repeat(64),
  },
  current: {
    findingId: FINDING_ID,
    policyVersion: '2026-07-v1',
    snapshot,
    snapshotHash: 'b'.repeat(64),
  },
  result: {
    staleness: 'CURRENT',
    reasons: [],
    diff: {},
  },
};

test('parser aceita CURRENT, current null e todos os formatos conhecidos de diff', () => {
  assert.equal(parseFindingReviewCaseContextComparison(validResponse)?.result.staleness, 'CURRENT');
  const noLongerDetected = parseFindingReviewCaseContextComparison({
    ...validResponse,
    current: null,
    result: {
      staleness: 'NO_LONGER_DETECTED',
      reasons: ['FINDING_NO_LONGER_DETECTED'],
      diff: {},
    },
  });
  assert.equal(noLongerDetected?.current, null);

  const changed = parseFindingReviewCaseContextComparison({
    ...validResponse,
    result: {
      staleness: 'CHANGED',
      reasons: [
        'AFFECTED_ASSETS_CHANGED',
        'OBSERVATIONS_CHANGED',
        'EVIDENCE_CHANGED',
        'NETWORK_VALUE_CHANGED',
        'SOURCES_CHANGED',
        'TEMPORAL_CONTEXT_CHANGED',
        'LIMITATIONS_CHANGED',
        'REVIEW_OPTIONS_CHANGED',
      ],
      diff: {
        affectedAssets: { added: [ASSET_ID], removed: [] },
        observations: {
          added: [{ ...snapshot.observations[0], value: undefined }],
          removed: [],
        },
        evidenceIds: { added: [EVIDENCE_ID], removed: [] },
        normalizedHostname: { before: null, after: 'srv-app-01' },
        normalizedIp: { before: '192.0.2.1', after: null },
        sources: { added: snapshot.sources, removed: [] },
        temporalContext: {
          before: snapshot.temporalContext,
          after: { ...snapshot.temporalContext, differenceMilliseconds: 1000 },
        },
        limitations: { added: ['Limitação atual.'], removed: [] },
        reviewOptions: { added: ['NEEDS_MORE_EVIDENCE'], removed: [] },
      },
    },
  });
  assert.ok(changed);
  assert.equal(changed.result.diff.normalizedHostname?.before, null);
  assert.equal(changed.result.diff.temporalContext?.after.differenceMilliseconds, 1000);
});

test('parser rejeita enums, reason, diff key e relações de current desconhecidas', () => {
  assert.equal(
    parseFindingReviewCaseContextComparison({
      ...validResponse,
      result: { ...validResponse.result, staleness: 'UNKNOWN' },
    }),
    null,
  );
  assert.equal(
    parseFindingReviewCaseContextComparison({
      ...validResponse,
      result: { ...validResponse.result, reasons: ['UNKNOWN_REASON'] },
    }),
    null,
  );
  assert.equal(
    parseFindingReviewCaseContextComparison({
      ...validResponse,
      result: { ...validResponse.result, diff: { futureField: {} } },
    }),
    null,
  );
  assert.equal(parseFindingReviewCaseContextComparison({ ...validResponse, current: null }), null);
  assert.equal(
    parseFindingReviewCaseContextComparison({
      ...validResponse,
      current: null,
      result: { staleness: 'CHANGED', reasons: [], diff: {} },
    }),
    null,
  );
});

test('parser rejeita UUID, versão, timestamp, hash e snapshot inválidos', () => {
  for (const invalid of [
    { ...validResponse, caseId: 'not-a-uuid' },
    { ...validResponse, caseVersion: 0 },
    { ...validResponse, comparedAt: '2026-02-30T12:00:00Z' },
    { ...validResponse, baseline: { ...validResponse.baseline, snapshotHash: 'ABC' } },
    {
      ...validResponse,
      current: { ...validResponse.current, snapshot: { ...snapshot, snapshotVersion: 2 } },
    },
    {
      ...validResponse,
      current: { ...validResponse.current, snapshot: { ...snapshot, findingType: 'UNKNOWN' } },
    },
    {
      ...validResponse,
      current: { ...validResponse.current, snapshot: { ...snapshot, generatedAt: 'today' } },
    },
  ])
    assert.equal(parseFindingReviewCaseContextComparison(invalid), null);

  assert.ok(parseFindingReviewSnapshot(snapshot));
  assert.equal(parseFindingReviewSnapshot({ ...snapshot, temporalContext: null }), null);
});

test('cliente de comparação usa GET no-store, signal e nenhum header/body de comando', async () => {
  const controller = new AbortController();
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const result = await getFindingReviewCaseContextComparison(CASE_ID, {
    signal: controller.signal,
    fetchImplementation: async (input, init) => {
      calls.push({ input, init });
      return Response.json(validResponse);
    },
  });
  assert.equal(result.caseId, CASE_ID);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.input ?? '', new RegExp(`/${CASE_ID}/context-comparison$`));
  assert.equal(calls[0]?.init.method, undefined);
  assert.equal(calls[0]?.init.body, undefined);
  assert.equal(calls[0]?.init.cache, 'no-store');
  assert.equal(calls[0]?.init.signal instanceof AbortSignal, true);
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get('Idempotency-Key'), null);
  assert.equal(headers.get('Content-Type'), null);
});

test('cliente não repete resposta inválida e usa mensagem própria no timeout de query', async () => {
  let invalidCalls = 0;
  await assert.rejects(
    getFindingReviewCaseContextComparison(CASE_ID, {
      fetchImplementation: async () => {
        invalidCalls += 1;
        return Response.json({
          ...validResponse,
          result: { ...validResponse.result, staleness: 'FUTURE' },
        });
      },
    }),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
  assert.equal(invalidCalls, 1);

  let scheduled: (() => void) | undefined;
  const request = getFindingReviewCaseContextComparison(CASE_ID, {
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }),
    scheduleTimeout: (callback) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancelTimeout: () => undefined,
  });
  scheduled?.();
  await assert.rejects(
    request,
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 408 &&
      error.message === 'A verificação demorou mais que o esperado. Tente novamente.',
  );
});
