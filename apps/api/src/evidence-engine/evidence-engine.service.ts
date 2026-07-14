import { Injectable } from '@nestjs/common';

import { AttributeAnalysis } from './types/attribute-analysis';
import { EvidenceCandidate } from './types/evidence-candidate';

@Injectable()
export class EvidenceEngineService {
  analyze(attribute: string, candidates: EvidenceCandidate[]): AttributeAnalysis {
    const orderedCandidates = [...candidates].sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      const observedDifference = right.observedAt.getTime() - left.observedAt.getTime();
      if (observedDifference !== 0) return observedDifference;
      return left.attributeId.localeCompare(right.attributeId);
    });
    const currentCandidates = orderedCandidates.filter((candidate) => candidate.isCurrent);
    const selectedCandidate = currentCandidates[0] ?? null;
    const normalizedValues = new Set(
      orderedCandidates
        .map((candidate) => candidate.normalizedValue)
        .filter((value): value is string => value !== null),
    );
    const evidenceIds = new Set(
      orderedCandidates
        .map((candidate) => candidate.evidenceId)
        .filter((id): id is string => id !== null),
    );
    const limitations = [
      'Nenhum algoritmo de decisão ou ranking de fontes foi executado.',
      'A confiança exibida é o valor legado persistido no atributo atual.',
    ];

    if (currentCandidates.length > 1) {
      limitations.push('Há mais de um registro marcado como atual para este atributo.');
    }
    if (selectedCandidate && !selectedCandidate.evidenceId) {
      limitations.push('O valor atual não possui vínculo direto com uma evidência.');
    }
    if (selectedCandidate && selectedCandidate.confirmationCount > 1) {
      limitations.push(
        'O modelo atual registra a quantidade de confirmações, mas vincula o atributo a apenas uma evidência.',
      );
    }

    const status = !selectedCandidate
      ? 'NO_CURRENT_VALUE'
      : !selectedCandidate.evidenceId
        ? 'CURRENT_VALUE_WITHOUT_PROVENANCE'
        : normalizedValues.size > 1
          ? 'MULTIPLE_OBSERVED_VALUES'
          : 'CURRENT_VALUE_WITH_PROVENANCE';
    const summary = !selectedCandidate
      ? 'Nenhum valor atual foi encontrado para o atributo.'
      : normalizedValues.size > 1
        ? 'O valor atual é o estado persistido pelo fluxo legado e existem outros valores observados no histórico.'
        : selectedCandidate.evidenceId
          ? 'O valor atual possui proveniência em uma evidência do modelo existente.'
          : 'O valor atual existe, mas não possui proveniência direta em uma evidência.';

    return {
      attribute,
      currentValue: selectedCandidate?.value ?? null,
      candidates: orderedCandidates,
      selectedCandidate,
      confidence: selectedCandidate?.confidence ?? null,
      explanation: {
        status,
        summary,
        decisionApplied: false,
        selectionBasis: selectedCandidate ? 'CURRENT_PERSISTED_VALUE' : 'NONE',
        observedValueCount: normalizedValues.size,
        supportingEvidenceCount: evidenceIds.size,
        limitations,
      },
    };
  }
}
