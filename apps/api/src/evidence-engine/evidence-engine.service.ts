import { Injectable } from '@nestjs/common';

import { AttributeAnalysis } from './types/attribute-analysis';
import { EvidenceCandidate } from './types/evidence-candidate';

export interface AttributeAnalysisInput {
  attribute: string;
  currentValue: unknown;
  normalizedCurrentValue: string | null;
  candidates: EvidenceCandidate[];
}

@Injectable()
export class EvidenceEngineService {
  analyze(input: AttributeAnalysisInput): AttributeAnalysis {
    const orderedCandidates = [...input.candidates].sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;

      const attributeObservedDifference = this.compareDatesDescending(
        left.attributeObservedAt,
        right.attributeObservedAt,
      );
      if (attributeObservedDifference !== 0) return attributeObservedDifference;

      const evidenceObservedDifference = this.compareDatesDescending(
        left.evidenceObservedAt,
        right.evidenceObservedAt,
      );
      if (evidenceObservedDifference !== 0) return evidenceObservedDifference;

      const evidenceIngestedDifference = this.compareDatesDescending(
        left.evidenceIngestedAt,
        right.evidenceIngestedAt,
      );
      if (evidenceIngestedDifference !== 0) return evidenceIngestedDifference;

      const evidenceDifference = (left.evidenceId ?? '').localeCompare(right.evidenceId ?? '');
      if (evidenceDifference !== 0) return evidenceDifference;
      return left.attributeId.localeCompare(right.attributeId);
    });
    const currentCandidates = orderedCandidates.filter((candidate) => candidate.isCurrent);
    const currentCandidate = currentCandidates.length === 1 ? (currentCandidates[0] ?? null) : null;
    const currentValueMatchesCandidate = Boolean(
      currentCandidate &&
        input.normalizedCurrentValue !== null &&
        currentCandidate.normalizedValue === input.normalizedCurrentValue,
    );
    const selectedCandidate =
      currentCandidate &&
      currentValueMatchesCandidate &&
      currentCandidate.evidenceId &&
      currentCandidate.evidenceAvailable
        ? currentCandidate
        : null;
    const normalizedValues = new Set(
      orderedCandidates
        .map((candidate) => candidate.normalizedValue)
        .filter((value): value is string => value !== null),
    );
    const supportingEvidenceIds = new Set(
      input.normalizedCurrentValue === null
        ? []
        : orderedCandidates
            .filter(
              (candidate) =>
                candidate.evidenceId !== null &&
                candidate.evidenceAvailable &&
                candidate.normalizedValue === input.normalizedCurrentValue,
            )
            .map((candidate) => candidate.evidenceId as string),
    );
    const hasConflictingHistoricalValue =
      input.normalizedCurrentValue !== null &&
      orderedCandidates.some(
        (candidate) =>
          !candidate.isCurrent &&
          candidate.normalizedValue !== null &&
          candidate.normalizedValue !== input.normalizedCurrentValue,
      );
    const limitations = [
      'A análise opera em modo sombra e não altera o valor persistido.',
      'Nenhum algoritmo de decisão ou ranking de fontes foi executado.',
      'O score de confiança exibido é o valor legado persistido no atributo atual.',
      'Nenhuma política de Trust Score por fonte está ativa.',
    ];

    if (currentCandidates.length > 1) {
      limitations.push(
        'Foram encontrados múltiplos candidatos atuais. O modo sombra não escolhe um candidato entre valores ou registros ambíguos.',
      );
    } else if (input.currentValue === null || input.normalizedCurrentValue === null) {
      limitations.push('Não existe valor atual persistido inequívoco para este atributo.');
    } else if (!currentCandidate) {
      limitations.push('Não foi encontrado um candidato atual correspondente ao valor persistido.');
    } else if (!currentValueMatchesCandidate) {
      limitations.push('O candidato atual não corresponde ao valor atual persistido.');
    } else if (!currentCandidate.evidenceId) {
      limitations.push(
        'O valor atual não possui uma evidência vinculada que permita comprovar sua proveniência.',
      );
    } else if (!currentCandidate.evidenceAvailable) {
      limitations.push(
        'A evidência vinculada ao valor atual não está disponível para comprovar sua proveniência.',
      );
    }

    if (hasConflictingHistoricalValue) {
      limitations.push(
        'Foram encontradas evidências históricas com valor diferente do valor atual. Elas não foram contabilizadas como suporte ao valor atual.',
      );
    }
    if (currentCandidate && currentCandidate.confirmationCount > 1) {
      limitations.push(
        'O modelo atual registra a quantidade de confirmações, mas vincula o atributo a apenas uma evidência.',
      );
    }

    const status = this.resolveStatus({
      currentCandidates,
      currentCandidate,
      currentValue: input.currentValue,
      normalizedCurrentValue: input.normalizedCurrentValue,
      currentValueMatchesCandidate,
      selectedCandidate,
      hasConflictingHistoricalValue,
    });
    const summary = this.resolveSummary(status);

    return {
      attribute: input.attribute,
      currentValue: input.currentValue,
      candidates: orderedCandidates,
      selectedCandidate,
      persistedConfidenceScore: currentCandidate?.persistedConfidenceScore ?? null,
      explanation: {
        status,
        summary,
        decisionApplied: false,
        selectionBasis: selectedCandidate ? 'CURRENT_PERSISTED_VALUE' : 'NONE',
        observedValueCount: normalizedValues.size,
        supportingEvidenceCount: supportingEvidenceIds.size,
        limitations,
      },
    };
  }

  private resolveStatus(input: {
    currentCandidates: EvidenceCandidate[];
    currentCandidate: EvidenceCandidate | null;
    currentValue: unknown;
    normalizedCurrentValue: string | null;
    currentValueMatchesCandidate: boolean;
    selectedCandidate: EvidenceCandidate | null;
    hasConflictingHistoricalValue: boolean;
  }) {
    if (input.currentCandidates.length > 1) return 'AMBIGUOUS_CURRENT_CANDIDATES' as const;
    if (input.currentValue === null || input.normalizedCurrentValue === null) {
      return 'NO_CURRENT_VALUE' as const;
    }
    if (input.currentCandidate && !input.currentValueMatchesCandidate) {
      return 'CURRENT_VALUE_CANDIDATE_MISMATCH' as const;
    }
    if (!input.selectedCandidate) return 'CURRENT_VALUE_WITHOUT_PROVENANCE' as const;
    if (input.hasConflictingHistoricalValue) return 'MULTIPLE_OBSERVED_VALUES' as const;
    return 'CURRENT_VALUE_WITH_PROVENANCE' as const;
  }

  private resolveSummary(status: AttributeAnalysis['explanation']['status']): string {
    switch (status) {
      case 'AMBIGUOUS_CURRENT_CANDIDATES':
        return 'Existem múltiplos candidatos atuais e nenhuma proveniência única foi atribuída.';
      case 'NO_CURRENT_VALUE':
        return 'Não existe valor atual persistido inequívoco para este atributo.';
      case 'CURRENT_VALUE_CANDIDATE_MISMATCH':
        return 'O candidato atual não corresponde ao valor atual persistido e não foi selecionado.';
      case 'CURRENT_VALUE_WITHOUT_PROVENANCE':
        return 'O valor atual está persistido, mas não possui evidência vinculada suficiente para comprovar sua proveniência.';
      case 'MULTIPLE_OBSERVED_VALUES':
        return 'O valor atual possui vínculo direto com a evidência informada, e existem valores históricos conflitantes.';
      case 'CURRENT_VALUE_WITH_PROVENANCE':
        return 'O valor atual possui vínculo direto com a evidência informada.';
    }
  }

  private compareDatesDescending(left: Date | null, right: Date | null): number {
    return (right?.getTime() ?? Number.NEGATIVE_INFINITY) -
      (left?.getTime() ?? Number.NEGATIVE_INFINITY);
  }
}
