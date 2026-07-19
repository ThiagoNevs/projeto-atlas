import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export const FINDING_REVIEW_CASES_FEATURE_FLAG = 'FINDING_REVIEW_CASES_ENABLED';

export function parseFindingReviewCasesEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${FINDING_REVIEW_CASES_FEATURE_FLAG} deve ser true ou false.`);
}

@Injectable()
export class FindingReviewCasesFeature {
  assertEnabled(): void {
    try {
      if (parseFindingReviewCasesEnabled(process.env[FINDING_REVIEW_CASES_FEATURE_FLAG])) return;
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'FINDING_REVIEW_CASES_CONFIGURATION_INVALID',
        message: 'A configuração da criação de casos de revisão é inválida.',
      });
    }

    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'FINDING_REVIEW_CASES_DISABLED',
      message: 'A criação de casos de revisão está desabilitada.',
    });
  }
}
