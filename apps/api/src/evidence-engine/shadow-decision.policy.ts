import { Injectable } from '@nestjs/common';

import { EvidenceCandidate } from './types/evidence-candidate';
import {
  ShadowCandidateAssessment,
  ShadowCriterionResult,
  ShadowDecision,
  ShadowRecommendedCandidate,
  ShadowTiedValue,
} from './types/shadow-decision';

export const SHADOW_DECISION_POLICY_VERSION = '2026-07-v1';

export const SHADOW_DECISION_POLICY = Object.freeze({
  sourceType: Object.freeze({ TECHNICAL: 40, MANUAL: 20 }),
  evidenceLink: 20,
  recency: Object.freeze({ upTo30Days: 30, upTo90Days: 20, upTo180Days: 10, older: 0 }),
  currentValueStability: 5,
  legacyScore: 0,
});

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const SCORE_MEANING =
  'A pontuação representa apenas a prioridade definida pela versão atual da política e não uma probabilidade de correção.';

export interface ShadowDecisionInput {
  currentValue: unknown;
  normalizedCurrentValue: string | null;
  candidates: EvidenceCandidate[];
  referenceTime: Date;
}

interface ConsolidatedValue {
  value: unknown;
  normalizedValue: string;
  policyScore: number;
  assessments: ShadowCandidateAssessment[];
}

@Injectable()
export class ShadowDecisionPolicy {
  evaluate(input: ShadowDecisionInput): ShadowDecision {
    const assessments = input.candidates
      .map((candidate) => this.assessCandidate(candidate, input.referenceTime))
      .sort((left, right) => this.compareAssessments(left, right));
    const eligible = assessments.filter(
      (assessment): assessment is ShadowCandidateAssessment & { policyScore: number } =>
        assessment.eligible && assessment.policyScore !== null,
    );
    const consolidatedValues = this.consolidateValues(eligible);
    const highestScore = consolidatedValues[0]?.policyScore ?? null;
    const leaders =
      highestScore === null
        ? []
        : consolidatedValues.filter((candidate) => candidate.policyScore === highestScore);

    if (input.candidates.length === 0) {
      return this.decision({
        status: 'NO_CANDIDATES',
        input,
        assessments,
        explanation: ['Nenhum candidato foi encontrado para este atributo.'],
      });
    }

    if (leaders.length === 0) {
      const allCandidatesHaveInvalidValues = assessments.every(
        (assessment) => assessment.normalizedValue === null,
      );
      const status =
        allCandidatesHaveInvalidValues || input.normalizedCurrentValue !== null
          ? 'INSUFFICIENT_EVIDENCE'
          : 'NO_CURRENT_VALUE';
      return this.decision({
        status,
        input,
        assessments,
        explanation: [
          allCandidatesHaveInvalidValues
            ? 'Existem candidatos, mas nenhum possui valor válido após a normalização.'
            : input.normalizedCurrentValue === null
            ? 'Não existe valor atual nem candidato elegível para produzir uma recomendação.'
            : 'Nenhum candidato atende aos critérios de elegibilidade da política atual.',
        ],
        limitations: this.collectLimitations(assessments),
      });
    }

    if (leaders.length > 1) {
      return this.decision({
        status: 'TIED',
        input,
        assessments,
        tiedValues: leaders.map((leader) => this.toTiedValue(leader)),
        explanation: [
          'Dois ou mais valores diferentes obtiveram a mesma pontuação; nenhuma recomendação foi produzida.',
          'A ordem de apresentação, o ID e a posição dos candidatos não são usados para resolver empates.',
        ],
        limitations: this.collectLimitations(assessments),
      });
    }

    const leader = leaders[0];
    if (!leader) throw new Error('Shadow decision leader is unexpectedly unavailable.');

    const recommendedCandidate = this.toRecommendedCandidate(leader);
    const hasCurrentValue = input.normalizedCurrentValue !== null;
    const confirmsCurrentValue =
      hasCurrentValue && leader.normalizedValue === input.normalizedCurrentValue;
    const status = confirmsCurrentValue ? 'CURRENT_VALUE_CONFIRMED' : 'RECOMMENDED';
    const divergesFromCurrentValue = hasCurrentValue ? !confirmsCurrentValue : null;

    return this.decision({
      status,
      input,
      assessments,
      recommendedCandidate,
      divergesFromCurrentValue,
      explanation: [
        `O valor consolidado recomendado obteve ${leader.policyScore} pontos na política ${SHADOW_DECISION_POLICY_VERSION}.`,
        confirmsCurrentValue
          ? 'A política em modo sombra recomendaria manter o valor atual; isso não comprova que o valor está correto.'
          : hasCurrentValue
            ? 'A recomendação diverge do valor persistido, mas nenhuma alteração foi aplicada.'
            : 'Não existe valor atual para comparação; nenhuma alteração foi aplicada.',
        `A recomendação é sustentada por ${leader.assessments.length} candidato(s) elegível(is) e preserva todos os vínculos de evidência disponíveis.`,
      ],
      limitations: this.collectLimitations(assessments),
    });
  }

  private assessCandidate(
    candidate: EvidenceCandidate,
    referenceTime: Date,
  ): ShadowCandidateAssessment {
    const limitations: string[] = [];
    const criteria: ShadowCriterionResult[] = [];
    let eligible = true;

    criteria.push(this.assessSource(candidate, limitations));
    if (candidate.source.kind === 'SIMULATED' || candidate.source.kind === 'UNKNOWN') {
      eligible = false;
    }
    if (candidate.normalizedValue === null) {
      eligible = false;
      limitations.push('O candidato não possui valor normalizado válido.');
    }

    const evidenceCriterion = this.assessEvidenceLink(candidate, limitations);
    criteria.push(evidenceCriterion);
    if (evidenceCriterion.result === 'NEGATIVE') eligible = false;

    criteria.push(this.assessRecency(candidate.evidenceObservedAt, referenceTime, limitations));
    criteria.push({
      criterion: 'CURRENT_OR_HISTORICAL',
      result: candidate.isCurrent ? 'POSITIVE' : 'NEUTRAL',
      points: candidate.isCurrent ? SHADOW_DECISION_POLICY.currentValueStability : 0,
      explanation: candidate.isCurrent
        ? 'O candidato atual recebeu um pequeno fator de estabilidade de 5 pontos.'
        : 'O candidato histórico não recebeu pontos de estabilidade.',
    });
    criteria.push({
      criterion: 'LEGACY_SCORE',
      result: 'NOT_APPLICABLE',
      points: SHADOW_DECISION_POLICY.legacyScore,
      explanation:
        'O score legado foi ignorado porque sua semântica varia entre os fluxos atuais.',
    });

    const scoredCriteria =
      candidate.normalizedValue === null
        ? criteria.map((criterion) => ({
            ...criterion,
            result: 'NOT_APPLICABLE' as const,
            points: 0,
            explanation:
              criterion.criterion === 'LEGACY_SCORE'
                ? criterion.explanation
                : 'O critério não foi pontuado porque o candidato não possui valor válido após a normalização.',
          }))
        : criteria;

    return {
      candidateId: candidate.attributeId,
      value: candidate.value,
      normalizedValue: candidate.normalizedValue,
      evidenceId: candidate.evidenceId,
      sourceType: candidate.source.kind,
      eligible,
      policyScore: eligible
        ? scoredCriteria.reduce((total, criterion) => total + criterion.points, 0)
        : null,
      criteria: scoredCriteria,
      limitations,
    };
  }

  private assessSource(
    candidate: EvidenceCandidate,
    limitations: string[],
  ): ShadowCriterionResult {
    switch (candidate.source.kind) {
      case 'TECHNICAL':
        return {
          criterion: 'SOURCE_TYPE',
          result: 'POSITIVE',
          points: SHADOW_DECISION_POLICY.sourceType.TECHNICAL,
          explanation: 'A fonte técnica reconhecida recebeu prioridade de 40 pontos.',
        };
      case 'MANUAL':
        return {
          criterion: 'SOURCE_TYPE',
          result: 'POSITIVE',
          points: SHADOW_DECISION_POLICY.sourceType.MANUAL,
          explanation:
            'A fonte manual participou da análise com 20 pontos, sem ser apresentada como confirmação técnica.',
        };
      case 'SIMULATED':
        limitations.push(
          'A fonte simulada não é elegível para recomendar alteração em dados reais.',
        );
        return {
          criterion: 'SOURCE_TYPE',
          result: 'NEGATIVE',
          points: 0,
          explanation: 'A fonte simulada é visível, mas inelegível nesta política.',
        };
      case 'UNKNOWN':
        limitations.push('A política atual não assume autoridade de uma fonte desconhecida.');
        return {
          criterion: 'SOURCE_TYPE',
          result: 'NEGATIVE',
          points: 0,
          explanation: 'A fonte desconhecida é inelegível nesta política.',
        };
    }
  }

  private assessEvidenceLink(
    candidate: EvidenceCandidate,
    limitations: string[],
  ): ShadowCriterionResult {
    if (!candidate.evidenceId) {
      limitations.push('O candidato não possui vínculo com uma evidência.');
      return {
        criterion: 'EVIDENCE_LINK',
        result: 'NEGATIVE',
        points: 0,
        explanation: 'Sem evidenceId, o candidato não participa da recomendação.',
      };
    }
    if (!candidate.evidenceAvailable) {
      limitations.push('A evidência vinculada ao candidato não está disponível.');
      return {
        criterion: 'EVIDENCE_LINK',
        result: 'NEGATIVE',
        points: 0,
        explanation: 'O vínculo informado não pôde ser comprovado pela evidência disponível.',
      };
    }
    return {
      criterion: 'EVIDENCE_LINK',
      result: 'POSITIVE',
      points: SHADOW_DECISION_POLICY.evidenceLink,
      explanation: 'A evidência vinculada está disponível e recebeu 20 pontos.',
    };
  }

  private assessRecency(
    observedAt: Date | null,
    referenceTime: Date,
    limitations: string[],
  ): ShadowCriterionResult {
    const observedTime = observedAt?.getTime() ?? Number.NaN;
    const referenceTimestamp = referenceTime.getTime();

    if (!Number.isFinite(observedTime) || !Number.isFinite(referenceTimestamp)) {
      limitations.push('A data de observação da evidência está ausente ou é inválida.');
      return {
        criterion: 'RECENCY',
        result: 'NEUTRAL',
        points: 0,
        explanation: 'Sem data de evidência válida, nenhum ponto de recência foi atribuído.',
      };
    }

    const elapsedDays = (referenceTimestamp - observedTime) / DAY_IN_MILLISECONDS;
    if (elapsedDays < 0) {
      limitations.push('A evidência possui data futura em relação ao instante de referência.');
      return {
        criterion: 'RECENCY',
        result: 'NEUTRAL',
        points: 0,
        explanation: 'Datas futuras não recebem pontos de recência.',
      };
    }
    if (elapsedDays <= 30) {
      return this.recencyResult(
        SHADOW_DECISION_POLICY.recency.upTo30Days,
        `A evidência foi observada há ${Math.floor(elapsedDays)} dia(s), dentro da faixa de até 30 dias.`,
      );
    }
    if (elapsedDays <= 90) {
      return this.recencyResult(
        SHADOW_DECISION_POLICY.recency.upTo90Days,
        'A evidência foi observada entre 31 e 90 dias atrás.',
      );
    }
    if (elapsedDays <= 180) {
      return this.recencyResult(
        SHADOW_DECISION_POLICY.recency.upTo180Days,
        'A evidência foi observada entre 91 e 180 dias atrás.',
      );
    }
    return this.recencyResult(
      SHADOW_DECISION_POLICY.recency.older,
      'A evidência foi observada há mais de 180 dias e não recebeu pontos de recência.',
      'NEUTRAL',
    );
  }

  private recencyResult(
    points: number,
    explanation: string,
    result: ShadowCriterionResult['result'] = 'POSITIVE',
  ): ShadowCriterionResult {
    return { criterion: 'RECENCY', result, points, explanation };
  }

  private consolidateValues(
    assessments: Array<ShadowCandidateAssessment & { policyScore: number }>,
  ): ConsolidatedValue[] {
    const groups = new Map<string, Array<ShadowCandidateAssessment & { policyScore: number }>>();
    for (const assessment of assessments) {
      if (assessment.normalizedValue === null) continue;
      const group = groups.get(assessment.normalizedValue) ?? [];
      group.push(assessment);
      groups.set(assessment.normalizedValue, group);
    }

    return [...groups.entries()]
      .map(([normalizedValue, group]) => {
        const ordered = [...group].sort((left, right) => this.compareAssessments(left, right));
        const representative = ordered[0];
        if (!representative || representative.policyScore === null) {
          throw new Error('Eligible shadow assessment is unexpectedly incomplete.');
        }
        return {
          value: representative.value,
          normalizedValue,
          policyScore: Math.max(...group.map((candidate) => candidate.policyScore)),
          assessments: ordered,
        };
      })
      .sort(
        (left, right) =>
          right.policyScore - left.policyScore ||
          left.normalizedValue.localeCompare(right.normalizedValue),
      );
  }

  private toRecommendedCandidate(value: ConsolidatedValue): ShadowRecommendedCandidate {
    return {
      value: value.value,
      normalizedValue: value.normalizedValue,
      policyScore: value.policyScore,
      supportingCandidateIds: value.assessments.map((assessment) => assessment.candidateId).sort(),
      supportingEvidenceIds: [
        ...new Set(
          value.assessments
            .map((assessment) => assessment.evidenceId)
            .filter((evidenceId): evidenceId is string => evidenceId !== null),
        ),
      ].sort(),
    };
  }

  private toTiedValue(value: ConsolidatedValue): ShadowTiedValue {
    const recommended = this.toRecommendedCandidate(value);
    return {
      value: recommended.value,
      normalizedValue: recommended.normalizedValue,
      policyScore: recommended.policyScore,
      supportingCandidateIds: recommended.supportingCandidateIds,
    };
  }

  private decision(input: {
    status: ShadowDecision['status'];
    input: ShadowDecisionInput;
    assessments: ShadowCandidateAssessment[];
    recommendedCandidate?: ShadowRecommendedCandidate | null;
    divergesFromCurrentValue?: boolean | null;
    tiedValues?: ShadowTiedValue[];
    explanation: string[];
    limitations?: string[];
  }): ShadowDecision {
    return {
      mode: 'SHADOW',
      status: input.status,
      currentValue:
        input.input.normalizedCurrentValue === null ? null : input.input.currentValue,
      recommendedCandidate: input.recommendedCandidate ?? null,
      divergesFromCurrentValue: input.divergesFromCurrentValue ?? null,
      assessments: input.assessments,
      tiedValues: input.tiedValues ?? [],
      explanation: [...input.explanation, SCORE_MEANING],
      limitations: input.limitations ?? [],
      policyVersion: SHADOW_DECISION_POLICY_VERSION,
      scoreMeaning: SCORE_MEANING,
    };
  }

  private collectLimitations(assessments: ShadowCandidateAssessment[]): string[] {
    return [...new Set(assessments.flatMap((assessment) => assessment.limitations))].sort();
  }

  private compareAssessments(
    left: ShadowCandidateAssessment,
    right: ShadowCandidateAssessment,
  ): number {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    const scoreDifference = (right.policyScore ?? -1) - (left.policyScore ?? -1);
    if (scoreDifference !== 0) return scoreDifference;
    const valueDifference = (left.normalizedValue ?? '').localeCompare(
      right.normalizedValue ?? '',
    );
    if (valueDifference !== 0) return valueDifference;
    const evidenceDifference = (left.evidenceId ?? '').localeCompare(right.evidenceId ?? '');
    if (evidenceDifference !== 0) return evidenceDifference;
    return left.candidateId.localeCompare(right.candidateId);
  }
}
