import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  FindingReviewCaseStatus,
  Prisma,
} from '../generated/prisma/client';
import { auditActorType, type CurrentActor } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFindingReviewDecisionDto } from './dto/create-finding-review-decision.dto';
import {
  decisionRequestFingerprint,
  FINDING_REVIEW_DECISION_RECORDED_EVENT,
  isSameFindingReviewDecisionRequest,
  MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH,
  normalizeFindingReviewDecisionJustification,
  type FindingReviewDecisionSemanticRequest,
} from './finding-review-case-decision';
import {
  FINDING_REVIEW_SNAPSHOT_VERSION,
  normalizeIdempotencyKey,
} from './finding-review-case-creation';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';
import { isUpdatableFindingReviewCaseVersion } from './finding-review-case-status-transition';

const DECISION_RESPONSE_SELECT = {
  id: true,
  caseId: true,
  identityConclusion: true,
  justification: true,
  caseVersion: true,
  createdBy: true,
  requestFingerprint: true,
  createdAt: true,
} satisfies Prisma.FindingReviewDecisionSelect;

type DecisionResponseRecord = Prisma.FindingReviewDecisionGetPayload<{
  select: typeof DECISION_RESPONSE_SELECT;
}>;

@Injectable()
export class FindingReviewDecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

  async create(
    caseId: string,
    payload: CreateFindingReviewDecisionDto,
    rawIdempotencyKey: unknown,
    actor: CurrentActor,
  ) {
    this.feature.assertEnabled();
    const idempotencyKey = this.validateIdempotencyKey(rawIdempotencyKey);
    const fingerprint = decisionRequestFingerprint(actor.id, idempotencyKey);
    const semanticRequest = this.semanticRequest(caseId, payload);

    const existingRequest = await this.findByFingerprint(fingerprint);
    if (existingRequest) return this.replayOrReject(existingRequest, semanticRequest);

    if (!isUpdatableFindingReviewCaseVersion(payload.expectedVersion)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_EXPECTED_VERSION',
        message: 'A versão esperada excede o limite persistível para uma decisão.',
      });
    }

    const occurredAt = new Date();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const replayInsideTransaction = await transaction.findingReviewDecision.findUnique({
          where: { requestFingerprint: fingerprint },
          select: DECISION_RESPONSE_SELECT,
        });
        if (replayInsideTransaction) {
          return { record: replayInsideTransaction, replay: true };
        }

        const current = await transaction.findingReviewCase.findUnique({
          where: { id: caseId },
          select: {
            id: true,
            status: true,
            version: true,
            originalSnapshot: true,
            assets: { select: { assetIdAtCreation: true } },
            decisions: {
              orderBy: [{ caseVersion: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { id: true },
            },
          },
        });

        if (!current) throw this.caseNotFound();
        if (current.version !== payload.expectedVersion) throw this.versionConflict();
        if (current.status !== FindingReviewCaseStatus.IN_REVIEW) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            code: 'FINDING_REVIEW_CASE_DECISION_NOT_ALLOWED',
            message: 'Somente casos em análise podem receber uma decisão de identidade.',
          });
        }
        if (current.decisions.length > 0) throw this.decisionAlreadyRecorded();

        const reviewOptions = this.snapshotReviewOptions(current.originalSnapshot);
        if (
          !reviewOptions.has(payload.identityConclusion)
          || new Set(current.assets.map((asset) => asset.assetIdAtCreation)).size < 2
        ) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            code: 'FINDING_REVIEW_IDENTITY_CONCLUSION_NOT_ALLOWED',
            message: 'A conclusão de identidade não é permitida para o snapshot deste caso.',
          });
        }

        const justification = this.validateJustification(semanticRequest.justification);
        const versionAfter = payload.expectedVersion + 1;
        const updated = await transaction.findingReviewCase.updateMany({
          where: {
            id: caseId,
            version: payload.expectedVersion,
            status: FindingReviewCaseStatus.IN_REVIEW,
          },
          data: {
            version: { increment: 1 },
            updatedAt: occurredAt,
          },
        });
        if (updated.count !== 1) throw this.versionConflict();

        const decision = await transaction.findingReviewDecision.create({
          data: {
            caseId,
            identityConclusion: payload.identityConclusion,
            justification,
            caseVersion: versionAfter,
            createdBy: actor.id,
            requestFingerprint: fingerprint,
            createdAt: occurredAt,
          },
          select: DECISION_RESPONSE_SELECT,
        });

        const event = await transaction.findingReviewEvent.create({
          data: {
            caseId,
            eventType: FINDING_REVIEW_DECISION_RECORDED_EVENT,
            versionBefore: payload.expectedVersion,
            versionAfter,
            actorId: actor.id,
            requestId: fingerprint,
            previousStatus: null,
            nextStatus: null,
            before: { version: payload.expectedVersion, currentDecision: null },
            after: {
              version: versionAfter,
              decisionId: decision.id,
              identityConclusion: decision.identityConclusion,
              caseVersion: decision.caseVersion,
            },
            metadata: {
              decisionId: decision.id,
              identityConclusion: decision.identityConclusion,
            },
            occurredAt,
            createdAt: occurredAt,
          },
          select: { id: true },
        });

        await transaction.auditLog.create({
          data: {
            actorType: auditActorType(actor),
            actorId: actor.id,
            action: FINDING_REVIEW_DECISION_RECORDED_EVENT,
            entityType: 'FindingReviewCase',
            entityId: caseId,
            before: { version: payload.expectedVersion, currentDecision: null },
            after: {
              version: versionAfter,
              decisionId: decision.id,
              identityConclusion: decision.identityConclusion,
            },
            metadata: {
              caseId,
              decisionId: decision.id,
              eventId: event.id,
              eventType: FINDING_REVIEW_DECISION_RECORDED_EVENT,
              identityConclusion: decision.identityConclusion,
              versionBefore: payload.expectedVersion,
              versionAfter,
            },
            occurredAt,
          },
        });

        return { record: decision, replay: false };
      });

      return result.replay
        ? this.replayOrReject(result.record, semanticRequest)
        : this.present(result.record, false);
    } catch (error) {
      if (this.isVersionConflict(error) || isPrismaError(error, 'P2002')) {
        const requestDecision = await this.findByFingerprint(fingerprint);
        if (requestDecision) return this.replayOrReject(requestDecision, semanticRequest);
        throw this.versionConflict();
      }
      throw error;
    }
  }

  private semanticRequest(
    caseId: string,
    payload: CreateFindingReviewDecisionDto,
  ): FindingReviewDecisionSemanticRequest {
    return {
      caseId,
      identityConclusion: payload.identityConclusion,
      justification: typeof payload.justification === 'string'
        ? normalizeFindingReviewDecisionJustification(payload.justification)
        : '',
      expectedVersion: payload.expectedVersion,
    };
  }

  private validateJustification(value: string): string {
    if (value.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FINDING_REVIEW_DECISION_JUSTIFICATION_REQUIRED',
        message: 'Informe uma justificativa para a decisão de identidade.',
      });
    }
    if (value.length > MAX_FINDING_REVIEW_DECISION_JUSTIFICATION_LENGTH) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_DECISION_JUSTIFICATION',
        message: 'A justificativa deve ter no máximo 1000 caracteres.',
      });
    }
    return value;
  }

  private snapshotReviewOptions(snapshot: Prisma.JsonValue): Set<string> {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw this.snapshotIncompatible();
    }
    const version = snapshot.snapshotVersion;
    const reviewOptions = snapshot.reviewOptions;
    if (
      version !== FINDING_REVIEW_SNAPSHOT_VERSION
      || !Array.isArray(reviewOptions)
      || !reviewOptions.every((option) => typeof option === 'string')
    ) {
      throw this.snapshotIncompatible();
    }
    return new Set(reviewOptions);
  }

  private async findByFingerprint(fingerprint: string): Promise<DecisionResponseRecord | null> {
    return this.prisma.findingReviewDecision.findUnique({
      where: { requestFingerprint: fingerprint },
      select: DECISION_RESPONSE_SELECT,
    });
  }

  private replayOrReject(
    record: DecisionResponseRecord,
    request: FindingReviewDecisionSemanticRequest,
  ) {
    if (!isSameFindingReviewDecisionRequest(record, request)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'A Idempotency-Key já foi usada com outro conteúdo.',
      });
    }
    return this.present(record, true);
  }

  private present(record: DecisionResponseRecord, idempotentReplay: boolean) {
    return {
      decision: {
        id: record.id,
        caseId: record.caseId,
        identityConclusion: record.identityConclusion,
        justification: record.justification,
        caseVersion: record.caseVersion,
        createdBy: record.createdBy,
        createdAt: record.createdAt.toISOString(),
      },
      idempotentReplay,
    };
  }

  private validateIdempotencyKey(value: unknown): string {
    try {
      return normalizeIdempotencyKey(value);
    } catch (error) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: error instanceof Error ? error.message : 'Idempotency-Key é inválido.',
      });
    }
  }

  private caseNotFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      code: 'FINDING_REVIEW_CASE_NOT_FOUND',
      message: 'O caso de revisão informado não foi encontrado.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'FINDING_REVIEW_CASE_VERSION_CONFLICT',
      message: 'O caso foi alterado por outra operação. Recarregue os dados antes de tentar novamente.',
    });
  }

  private decisionAlreadyRecorded(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'FINDING_REVIEW_CASE_DECISION_ALREADY_RECORDED',
      message: 'Este caso já possui uma decisão de identidade registrada.',
    });
  }

  private snapshotIncompatible(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_CASE_SNAPSHOT_INCOMPATIBLE',
      message: 'O snapshot do caso não é compatível com o registro de decisões.',
    });
  }

  private isVersionConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) return false;
    const response = error.getResponse();
    return typeof response === 'object'
      && response !== null
      && 'code' in response
      && response.code === 'FINDING_REVIEW_CASE_VERSION_CONFLICT';
  }
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code
  );
}
