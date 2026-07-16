import { describe, expect, it } from '@jest/globals';

import {
  SHADOW_DECISION_POLICY_VERSION,
  ShadowDecisionPolicy,
} from '../src/evidence-engine/shadow-decision.policy';
import { EvidenceCandidate } from '../src/evidence-engine/types/evidence-candidate';
import { EvidenceSourceKind } from '../src/evidence-engine/types/evidence-source';
import { normalizeCandidateValue } from '../src/evidence-engine/utils/attribute-utils';

const REFERENCE_TIME = new Date('2026-07-15T12:00:00.000Z');
const policy = new ShadowDecisionPolicy();

function candidate(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    attributeId: 'candidate-a',
    value: 'Windows 11',
    valueText: 'Windows 11',
    normalizedValue: 'windows 11',
    source: {
      identifier: 'signed-agent',
      kind: 'TECHNICAL',
      evidenceType: 'TECHNICAL_AGENT',
      trustScore: null,
    },
    attributeObservedAt: new Date('2026-07-10T12:00:00.000Z'),
    evidenceObservedAt: new Date('2026-07-10T12:00:00.000Z'),
    evidenceIngestedAt: new Date('2026-07-10T12:01:00.000Z'),
    persistedConfidenceScore: 82,
    dataQuality: 90,
    isManual: false,
    evidenceId: 'evidence-a',
    evidenceAvailable: true,
    isCurrent: true,
    confirmationCount: 1,
    ...overrides,
  };
}

function source(kind: EvidenceSourceKind) {
  return {
    identifier: kind.toLowerCase(),
    kind,
    evidenceType: `${kind}_SOURCE`,
    trustScore: null,
  };
}

function candidateWithValue(
  value: unknown,
  valueText: string | null,
  overrides: Partial<EvidenceCandidate> = {},
): EvidenceCandidate {
  return candidate({
    value,
    valueText,
    normalizedValue: normalizeCandidateValue(valueText, value),
    ...overrides,
  });
}

function evaluate(
  candidates: EvidenceCandidate[],
  currentValue: unknown = 'Windows 11',
  normalizedCurrentValue: string | null = 'windows 11',
  referenceTime = REFERENCE_TIME,
) {
  return policy.evaluate({ candidates, currentValue, normalizedCurrentValue, referenceTime });
}

function assessmentCriterion(
  result: ReturnType<typeof evaluate>,
  criterion: string,
  candidateId = 'candidate-a',
) {
  return result.assessments
    .find((assessment) => assessment.candidateId === candidateId)
    ?.criteria.find((item) => item.criterion === criterion);
}

describe('Evidence Engine shadow decision policy 2026-07-v1', () => {
  it.each([
    ['string vazia', '', ''],
    ['um espaço', ' ', ' '],
    ['vários espaços', '   ', '   '],
    ['tabs e quebras de linha', ' \t\n ', ' \t\n '],
    ['valor nulo', null, null],
    ['valor ausente', undefined, null],
  ])('keeps %s visible but ineligible as an absent value', (_label, value, valueText) => {
    const result = evaluate(
      [candidateWithValue(value, valueText, { isCurrent: false })],
      null,
      null,
    );
    const assessment = result.assessments[0];

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.recommendedCandidate).toBeNull();
    expect(result.tiedValues).toHaveLength(0);
    expect(assessment).toEqual(
      expect.objectContaining({ normalizedValue: null, eligible: false, policyScore: null }),
    );
    expect(assessment?.criteria.every((criterion) => criterion.points === 0)).toBe(true);
    expect(assessment?.limitations).toContain('O candidato não possui valor normalizado válido.');
  });

  it.each(['', '   '])(
    'treats currentValue %p as absent when a valid candidate can be recommended',
    (currentValue) => {
      const result = evaluate(
        [candidate({ isCurrent: false })],
        currentValue,
        normalizeCandidateValue(currentValue, currentValue),
      );

      expect(result.currentValue).toBeNull();
      expect(result.status).toBe('RECOMMENDED');
      expect(result.recommendedCandidate?.normalizedValue).toBe('windows 11');
      expect(result.divergesFromCurrentValue).toBeNull();
      expect(result.explanation).toContain(
        'Não existe valor atual para comparação; nenhuma alteração foi aplicada.',
      );
    },
  );

  it('does not score a recent technical current candidate with an empty value', () => {
    const result = evaluate([candidateWithValue('', '', { isCurrent: true })], null, null);
    const assessment = result.assessments[0];

    expect(assessment?.sourceType).toBe('TECHNICAL');
    expect(assessment?.eligible).toBe(false);
    expect(assessment?.policyScore).toBeNull();
    expect(assessment?.criteria.every((criterion) => criterion.points === 0)).toBe(true);
    expect(result.recommendedCandidate).toBeNull();
  });

  it('keeps multiple empty candidates out of consolidation and artificial ties', () => {
    const result = evaluate(
      [
        candidateWithValue('', '', { attributeId: 'empty-a', evidenceId: 'evidence-empty-a' }),
        candidateWithValue('   ', '   ', {
          attributeId: 'empty-b',
          evidenceId: 'evidence-empty-b',
          isCurrent: false,
        }),
      ],
      null,
      null,
    );

    expect(result.assessments).toHaveLength(2);
    expect(result.assessments.every((assessment) => !assessment.eligible)).toBe(true);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.recommendedCandidate).toBeNull();
    expect(result.tiedValues).toHaveLength(0);
  });

  it('allows a valid candidate to win without points from an empty technical candidate', () => {
    const result = evaluate(
      [
        candidateWithValue('', '', { attributeId: 'empty-technical', isCurrent: false }),
        candidate({
          attributeId: 'valid-manual',
          evidenceId: 'valid-manual-evidence',
          value: 'Linux',
          valueText: 'Linux',
          normalizedValue: 'linux',
          source: source('MANUAL'),
          isManual: true,
          isCurrent: false,
        }),
      ],
      null,
      null,
    );

    expect(result.recommendedCandidate?.normalizedValue).toBe('linux');
    expect(result.assessments.find((item) => item.candidateId === 'empty-technical')).toEqual(
      expect.objectContaining({ eligible: false, policyScore: null }),
    );
  });

  it.each([
    ['string zero', '0', '0', '0'],
    ['zero numérico', 0, null, '0'],
    ['string false', 'false', 'false', 'false'],
    ['false booleano', false, null, 'false'],
  ])('preserves %s as a valid value', (_label, value, valueText, normalizedValue) => {
    const result = evaluate(
      [candidateWithValue(value, valueText, { isCurrent: false })],
      null,
      null,
    );

    expect(result.recommendedCandidate?.normalizedValue).toBe(normalizedValue);
    expect(result.assessments[0]).toEqual(
      expect.objectContaining({ normalizedValue, eligible: true }),
    );
  });

  it('recommends one recent technical source', () => {
    const result = evaluate([candidate()]);
    expect(result.status).toBe('CURRENT_VALUE_CONFIRMED');
    expect(result.recommendedCandidate?.policyScore).toBe(95);
  });

  it('recommends one recent manual source without calling it technical', () => {
    const result = evaluate([candidate({ source: source('MANUAL'), isManual: true })]);
    expect(result.recommendedCandidate?.policyScore).toBe(75);
    expect(result.assessments[0]?.sourceType).toBe('MANUAL');
  });

  it('keeps a simulated source visible but ineligible', () => {
    const result = evaluate([candidate({ source: source('SIMULATED') })]);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.assessments[0]).toEqual(expect.objectContaining({ eligible: false, policyScore: null }));
  });

  it('keeps an unknown source visible but ineligible', () => {
    const result = evaluate([candidate({ source: source('UNKNOWN') })]);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.assessments[0]?.eligible).toBe(false);
  });

  it('rejects a candidate without evidence', () => {
    const result = evaluate([candidate({ evidenceId: null, evidenceAvailable: false })]);
    expect(result.recommendedCandidate).toBeNull();
    expect(result.assessments[0]?.eligible).toBe(false);
  });

  it('prioritizes recent technical evidence over recent manual evidence', () => {
    const result = evaluate([
      candidate({ isCurrent: false }),
      candidate({
        attributeId: 'manual',
        evidenceId: 'manual-evidence',
        value: 'Windows 10',
        normalizedValue: 'windows 10',
        source: source('MANUAL'),
        isManual: true,
        isCurrent: false,
      }),
    ], null, null);
    expect(result.recommendedCandidate?.normalizedValue).toBe('windows 11');
  });

  it('allows recent manual evidence to outrank technical evidence older than 180 days', () => {
    const result = evaluate([
      candidate({ isCurrent: false, evidenceObservedAt: new Date('2025-12-01T12:00:00Z') }),
      candidate({
        attributeId: 'manual',
        evidenceId: 'manual-evidence',
        value: 'Windows 10',
        normalizedValue: 'windows 10',
        source: source('MANUAL'),
        isManual: true,
        isCurrent: false,
      }),
    ], null, null);
    expect(result.recommendedCandidate?.normalizedValue).toBe('windows 10');
  });

  it('consolidates candidates that support the same logical value', () => {
    const result = evaluate([
      candidate(),
      candidate({ attributeId: 'candidate-b', evidenceId: 'evidence-b', isCurrent: false }),
    ]);
    expect(result.recommendedCandidate?.supportingCandidateIds).toEqual([
      'candidate-a',
      'candidate-b',
    ]);
    expect(result.recommendedCandidate?.supportingEvidenceIds).toEqual(['evidence-a', 'evidence-b']);
  });

  it('does not recommend when different values tie', () => {
    const result = evaluate([
      candidate({ isCurrent: false }),
      candidate({
        attributeId: 'candidate-b',
        evidenceId: 'evidence-b',
        value: 'Linux',
        normalizedValue: 'linux',
        isCurrent: false,
      }),
    ], null, null);
    expect(result.status).toBe('TIED');
    expect(result.recommendedCandidate).toBeNull();
    expect(result.divergesFromCurrentValue).toBeNull();
  });

  it('confirms when the recommended value equals the current value', () => {
    expect(evaluate([candidate()]).status).toBe('CURRENT_VALUE_CONFIRMED');
  });

  it('reports divergence when the recommended value differs from current value', () => {
    const result = evaluate([candidate()], 'Windows 10', 'windows 10');
    expect(result.status).toBe('RECOMMENDED');
    expect(result.divergesFromCurrentValue).toBe(true);
  });

  it('can recommend without a current value and leaves divergence unknown', () => {
    const result = evaluate([candidate({ isCurrent: false })], null, null);
    expect(result.status).toBe('RECOMMENDED');
    expect(result.divergesFromCurrentValue).toBeNull();
  });

  it('returns NO_CANDIDATES when there are no candidates', () => {
    expect(evaluate([], null, null).status).toBe('NO_CANDIDATES');
  });

  it('allows an eligible historical candidate to be recommended', () => {
    const result = evaluate([candidate({ isCurrent: false })], null, null);
    expect(result.recommendedCandidate?.policyScore).toBe(90);
  });

  it('assigns no recency points when the evidence date is absent', () => {
    const result = evaluate([candidate({ evidenceObservedAt: null })]);
    expect(assessmentCriterion(result, 'RECENCY')?.points).toBe(0);
    expect(result.assessments[0]?.limitations).toContain(
      'A data de observação da evidência está ausente ou é inválida.',
    );
  });

  it('assigns no recency points when the evidence date is invalid', () => {
    const result = evaluate([candidate({ evidenceObservedAt: new Date('invalid') })]);
    expect(assessmentCriterion(result, 'RECENCY')?.points).toBe(0);
  });

  it('assigns no recency advantage to evidence observed in the future', () => {
    const candidates = [
      candidate({
        attributeId: 'future',
        evidenceId: 'future-evidence',
        evidenceObservedAt: new Date(REFERENCE_TIME.getTime() + 1),
        isCurrent: false,
      }),
      candidate({
        attributeId: 'recent',
        evidenceId: 'recent-evidence',
        value: 'Linux',
        valueText: 'Linux',
        normalizedValue: 'linux',
        evidenceObservedAt: new Date(REFERENCE_TIME.getTime() - 1),
        isCurrent: false,
      }),
    ];
    const result = evaluate(candidates, null, null);

    expect(assessmentCriterion(result, 'RECENCY', 'future')?.points).toBe(0);
    expect(result.assessments.find((item) => item.candidateId === 'future')?.limitations).toContain(
      'A evidência possui data futura em relação ao instante de referência.',
    );
    expect(result.recommendedCandidate?.normalizedValue).toBe('linux');
    expect(evaluate(candidates, null, null)).toEqual(result);
  });

  it('ignores the persisted legacy score in the decision', () => {
    const low = evaluate([candidate({ persistedConfidenceScore: 1 })]);
    const high = evaluate([candidate({ persistedConfidenceScore: 100 })]);
    expect(low.recommendedCandidate?.policyScore).toBe(high.recommendedCandidate?.policyScore);
    expect(assessmentCriterion(low, 'LEGACY_SCORE')?.result).toBe('NOT_APPLICABLE');
  });

  it('produces the same result for a different input order', () => {
    const candidates = [
      candidate({ attributeId: 'candidate-b', evidenceId: 'evidence-b', isCurrent: false }),
      candidate({ isCurrent: false }),
    ];
    expect(evaluate(candidates, null, null)).toEqual(
      evaluate([...candidates].reverse(), null, null),
    );
  });

  it('produces the same result on repeated execution', () => {
    const input = [candidate()];
    expect(evaluate(input)).toEqual(evaluate(input));
    expect(evaluate(input).policyVersion).toBe(SHADOW_DECISION_POLICY_VERSION);
  });

  it('assesses multiple current candidates without silently selecting by position', () => {
    const result = evaluate([
      candidate(),
      candidate({
        attributeId: 'candidate-b',
        evidenceId: 'evidence-b',
        value: 'Linux',
        normalizedValue: 'linux',
      }),
    ], null, null);
    expect(result.status).toBe('TIED');
  });

  it('rejects a candidate whose linked evidence is unavailable', () => {
    const result = evaluate([candidate({ evidenceAvailable: false })]);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.assessments[0]?.limitations).toContain(
      'A evidência vinculada ao candidato não está disponível.',
    );
  });

  it('treats already normalized equivalent values as one logical value', () => {
    const result = evaluate([
      candidate({ value: ' Windows 11 ', normalizedValue: 'windows 11' }),
      candidate({
        attributeId: 'candidate-b',
        evidenceId: 'evidence-b',
        value: 'WINDOWS 11',
        normalizedValue: 'windows 11',
        isCurrent: false,
      }),
    ]);
    expect(result.tiedValues).toHaveLength(0);
    expect(result.recommendedCandidate?.supportingCandidateIds).toHaveLength(2);
  });

  it('keeps different normalized values separate', () => {
    const result = evaluate([
      candidate({ isCurrent: false }),
      candidate({
        attributeId: 'candidate-b',
        evidenceId: 'evidence-b',
        value: 'Windows 10',
        normalizedValue: 'windows 10',
        isCurrent: false,
      }),
    ], null, null);
    expect(result.tiedValues).toHaveLength(2);
  });

  it('uses the injected temporal reference', () => {
    const item = candidate({ isCurrent: false, evidenceObservedAt: new Date('2026-07-01T00:00:00Z') });
    const recent = evaluate([item], null, null, new Date('2026-07-15T00:00:00Z'));
    const old = evaluate([item], null, null, new Date('2027-07-15T00:00:00Z'));
    expect(recent.recommendedCandidate?.policyScore).toBe(90);
    expect(old.recommendedCandidate?.policyScore).toBe(60);
  });

  it.each([
    ['exactly 30 days', 30, 0, 30],
    ['30 days plus 1 ms', 30, 1, 20],
    ['exactly 90 days', 90, 0, 20],
    ['90 days plus 1 ms', 90, 1, 10],
    ['exactly 180 days', 180, 0, 10],
    ['180 days plus 1 ms', 180, 1, 0],
  ])('assigns the expected recency at %s', (_label, days, extraMilliseconds, expectedPoints) => {
    const observedAt = new Date(
      REFERENCE_TIME.getTime() - days * 24 * 60 * 60 * 1000 - extraMilliseconds,
    );
    const result = evaluate([candidate({ evidenceObservedAt: observedAt })]);
    expect(assessmentCriterion(result, 'RECENCY')?.points).toBe(expectedPoints);
  });

  it('does not inflate a consolidated value by the number of supporting candidates', () => {
    const technical = candidate({ attributeId: 'technical', isCurrent: false });
    const oldManuals = Array.from({ length: 10 }, (_, index) =>
      candidate({
        attributeId: `manual-${index}`,
        evidenceId: `manual-evidence-${index}`,
        value: 'Linux',
        valueText: 'Linux',
        normalizedValue: 'linux',
        source: source('MANUAL'),
        isManual: true,
        isCurrent: false,
        evidenceObservedAt: new Date('2025-01-01T00:00:00.000Z'),
      }),
    );
    const result = evaluate([technical, ...oldManuals], null, null);
    const manualScores = result.assessments
      .filter((assessment) => assessment.normalizedValue === 'linux')
      .map((assessment) => assessment.policyScore);

    expect(result.recommendedCandidate?.normalizedValue).toBe('windows 11');
    expect(result.recommendedCandidate?.policyScore).toBe(90);
    expect(manualScores).toEqual(Array(10).fill(40));
    expect(result.assessments.filter((item) => item.normalizedValue === 'linux')).toHaveLength(10);
  });

  it('chooses a deterministic representative without changing the consolidated score', () => {
    const candidates = [
      candidate({
        attributeId: 'candidate-z',
        evidenceId: 'evidence-z',
        value: 'Windows 11',
        isCurrent: false,
      }),
      candidate({
        attributeId: 'candidate-a',
        evidenceId: 'evidence-a',
        value: 'Windows 11',
        isCurrent: false,
      }),
    ];
    const forward = evaluate(candidates, null, null);
    const reversed = evaluate([...candidates].reverse(), null, null);

    expect(forward).toEqual(reversed);
    expect(forward.recommendedCandidate).toEqual(
      expect.objectContaining({
        normalizedValue: 'windows 11',
        policyScore: 90,
        supportingCandidateIds: ['candidate-a', 'candidate-z'],
      }),
    );
    expect(forward.assessments).toHaveLength(2);
    expect(forward.explanation.join(' ').toLocaleLowerCase('pt-BR')).not.toMatch(
      /melhor evidência|evidência vencedora/,
    );
  });

  it('does not break a tie by candidate ID', () => {
    const makeTie = (firstId: string, secondId: string) =>
      evaluate([
        candidate({ attributeId: firstId, evidenceId: 'evidence-z', isCurrent: false }),
        candidate({
          attributeId: secondId,
          evidenceId: 'evidence-a',
          value: 'Linux',
          normalizedValue: 'linux',
          isCurrent: false,
        }),
      ], null, null);
    expect(makeTie('z', 'a').status).toBe('TIED');
    expect(makeTie('a', 'z').status).toBe('TIED');
  });

  it('does not break a tie by candidate position', () => {
    const candidates = [
      candidate({ isCurrent: false }),
      candidate({
        attributeId: 'candidate-b',
        evidenceId: 'evidence-b',
        value: 'Linux',
        normalizedValue: 'linux',
        isCurrent: false,
      }),
    ];
    expect(evaluate(candidates, null, null).status).toBe('TIED');
    expect(evaluate([...candidates].reverse(), null, null).status).toBe('TIED');
  });
});
