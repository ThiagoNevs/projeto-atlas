import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  FindingReviewCaseStatus,
  FindingReviewIdentityConclusion,
  Prisma,
} from '../generated/prisma/client';
import { auditActorType, type CurrentActor } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFindingReviewCaseResolutionDto } from './dto/create-finding-review-case-resolution.dto';
import { normalizeIdempotencyKey } from './finding-review-case-creation';
import {
  FINDING_REVIEW_CASE_RESOLVED_EVENT,
  isSameFindingReviewResolutionRequest,
  MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH,
  normalizeFindingReviewResolutionJustification,
  resolutionRequestFingerprint,
  type FindingReviewResolutionSemanticRequest,
} from './finding-review-case-resolution';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';
import { isUpdatableFindingReviewCaseVersion } from './finding-review-case-status-transition';

const RESOLUTION_EVENT_SELECT = {
  id: true,
  caseId: true,
  eventType: true,
  versionBefore: true,
  versionAfter: true,
  actorId: true,
  requestId: true,
  previousStatus: true,
  nextStatus: true,
  metadata: true,
  occurredAt: true,
} satisfies Prisma.FindingReviewEventSelect;

type ResolutionEventRecord = Prisma.FindingReviewEventGetPayload<{
  select: typeof RESOLUTION_EVENT_SELECT;
}>;

interface ResolutionMetadata {
  decisionId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  justification: string;
}

@Injectable()
export class FindingReviewResolutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

  async create(
    caseId: string,
    payload: CreateFindingReviewCaseResolutionDto,
    rawIdempotencyKey: unknown,
    actor: CurrentActor,
  ) {
    this.feature.assertEnabled();
    const idempotencyKey = this.validateIdempotencyKey(rawIdempotencyKey);
    const fingerprint = resolutionRequestFingerprint(actor.id, caseId, idempotencyKey);
    const semanticRequest = this.semanticRequest(caseId, payload);

    const existingRequest = await this.findByFingerprint(caseId, fingerprint);
    if (existingRequest) return this.replayOrReject(existingRequest, semanticRequest);

    if (!isUpdatableFindingReviewCaseVersion(payload.expectedVersion)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_EXPECTED_VERSION',
        message: 'A versão esperada excede o limite persistível para uma resolução.',
      });
    }

    const occurredAt = new Date();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const replayInsideTransaction = await transaction.findingReviewEvent.findFirst({
          where: {
            caseId,
            eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
            requestId: fingerprint,
          },
          select: RESOLUTION_EVENT_SELECT,
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
            activeReviewSubjectKey: true,
            decisions: {
              orderBy: [{ caseVersion: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { id: true, identityConclusion: true },
            },
          },
        });

        if (!current) throw this.caseNotFound();
        if (current.version !== payload.expectedVersion) throw this.versionConflict();
        if (current.status !== FindingReviewCaseStatus.IN_REVIEW) {
          throw this.resolutionNotAllowed();
        }

        const currentDecision = current.decisions[0];
        if (!currentDecision) throw this.decisionRequired();
        if (!isIdentityConclusion(currentDecision.identityConclusion)) {
          throw this.decisionRequired();
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
            status: FindingReviewCaseStatus.RESOLVED,
            version: { increment: 1 },
            activeReviewSubjectKey: null,
            updatedAt: occurredAt,
          },
        });
        if (updated.count !== 1) throw this.versionConflict();

        const event = await transaction.findingReviewEvent.create({
          data: {
            caseId,
            eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
            versionBefore: payload.expectedVersion,
            versionAfter,
            actorId: actor.id,
            requestId: fingerprint,
            previousStatus: FindingReviewCaseStatus.IN_REVIEW,
            nextStatus: FindingReviewCaseStatus.RESOLVED,
            before: {
              status: FindingReviewCaseStatus.IN_REVIEW,
              version: payload.expectedVersion,
              activeReviewSubjectKey: current.activeReviewSubjectKey,
            },
            after: {
              status: FindingReviewCaseStatus.RESOLVED,
              version: versionAfter,
              activeReviewSubjectKey: null,
              decisionId: currentDecision.id,
              identityConclusion: currentDecision.identityConclusion,
            },
            metadata: {
              decisionId: currentDecision.id,
              identityConclusion: currentDecision.identityConclusion,
              justification,
            },
            occurredAt,
            createdAt: occurredAt,
          },
          select: RESOLUTION_EVENT_SELECT,
        });

        await transaction.auditLog.create({
          data: {
            actorType: auditActorType(actor),
            actorId: actor.id,
            action: FINDING_REVIEW_CASE_RESOLVED_EVENT,
            entityType: 'FindingReviewCase',
            entityId: caseId,
            before: {
              status: FindingReviewCaseStatus.IN_REVIEW,
              version: payload.expectedVersion,
              activeReviewSubjectKey: current.activeReviewSubjectKey,
            },
            after: {
              status: FindingReviewCaseStatus.RESOLVED,
              version: versionAfter,
              activeReviewSubjectKey: null,
              decisionId: currentDecision.id,
              identityConclusion: currentDecision.identityConclusion,
            },
            metadata: {
              caseId,
              eventId: event.id,
              eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
              decisionId: currentDecision.id,
              identityConclusion: currentDecision.identityConclusion,
              versionBefore: payload.expectedVersion,
              versionAfter,
              justification,
            },
            occurredAt,
          },
        });

        return { record: event, replay: false };
      });

      return result.replay
        ? this.replayOrReject(result.record, semanticRequest)
        : this.present(result.record, false);
    } catch (error) {
      if (this.isVersionConflict(error) || isPrismaError(error, 'P2002')) {
        const requestResolution = await this.findByFingerprint(caseId, fingerprint);
        if (requestResolution) {
          return this.replayOrReject(requestResolution, semanticRequest);
        }
        throw this.versionConflict();
      }
      throw error;
    }
  }

  private semanticRequest(
    caseId: string,
    payload: CreateFindingReviewCaseResolutionDto,
  ): FindingReviewResolutionSemanticRequest {
    return {
      caseId,
      expectedVersion: payload.expectedVersion,
      justification: typeof payload.justification === 'string'
        ? normalizeFindingReviewResolutionJustification(payload.justification)
        : '',
    };
  }

  private validateJustification(value: string): string {
    if (value.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FINDING_REVIEW_RESOLUTION_JUSTIFICATION_REQUIRED',
        message: 'Informe uma justificativa para concluir a investigação.',
      });
    }
    if (value.length > MAX_FINDING_REVIEW_RESOLUTION_JUSTIFICATION_LENGTH) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_RESOLUTION_JUSTIFICATION',
        message: 'A justificativa deve ter no máximo 1000 caracteres.',
      });
    }
    return value;
  }

  private async findByFingerprint(
    caseId: string,
    fingerprint: string,
  ): Promise<ResolutionEventRecord | null> {
    return this.prisma.findingReviewEvent.findFirst({
      where: {
        caseId,
        eventType: FINDING_REVIEW_CASE_RESOLVED_EVENT,
        requestId: fingerprint,
      },
      select: RESOLUTION_EVENT_SELECT,
    });
  }

  private replayOrReject(
    record: ResolutionEventRecord,
    request: FindingReviewResolutionSemanticRequest,
  ) {
    const metadata = readResolutionMetadata(record.metadata);
    if (!isSameFindingReviewResolutionRequest({
      caseId: record.caseId,
      versionBefore: record.versionBefore,
      justification: metadata?.justification ?? null,
    }, request)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'A Idempotency-Key já foi usada com outro conteúdo.',
      });
    }
    return this.present(record, true);
  }

  private present(record: ResolutionEventRecord, idempotentReplay: boolean) {
    const metadata = readResolutionMetadata(record.metadata);
    if (
      !metadata
      || record.versionBefore === null
      || record.previousStatus !== FindingReviewCaseStatus.IN_REVIEW
      || record.nextStatus !== FindingReviewCaseStatus.RESOLVED
    ) {
      throw new Error('O evento persistido de resolução está inconsistente.');
    }
    return {
      idempotentReplay,
      resolution: {
        eventId: record.id,
        caseId: record.caseId,
        decisionId: metadata.decisionId,
        identityConclusion: metadata.identityConclusion,
        justification: metadata.justification,
        versionBefore: record.versionBefore,
        versionAfter: record.versionAfter,
        previousStatus: record.previousStatus,
        status: record.nextStatus,
        resolvedBy: record.actorId,
        resolvedAt: record.occurredAt.toISOString(),
      },
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

  private resolutionNotAllowed(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_CASE_RESOLUTION_NOT_ALLOWED',
      message: 'Somente casos em análise podem ser resolvidos.',
    });
  }

  private decisionRequired(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_CASE_DECISION_REQUIRED',
      message: 'Registre uma decisão de identidade antes de resolver o caso.',
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

function readResolutionMetadata(metadata: Prisma.JsonValue | null): ResolutionMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const { decisionId, identityConclusion, justification } = metadata;
  if (
    typeof decisionId !== 'string'
    || !isIdentityConclusion(identityConclusion)
    || typeof justification !== 'string'
  ) {
    return null;
  }
  return { decisionId, identityConclusion, justification };
}

function isIdentityConclusion(value: unknown): value is FindingReviewIdentityConclusion {
  return value === FindingReviewIdentityConclusion.SAME_ASSET
    || value === FindingReviewIdentityConclusion.DIFFERENT_ASSETS;
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
