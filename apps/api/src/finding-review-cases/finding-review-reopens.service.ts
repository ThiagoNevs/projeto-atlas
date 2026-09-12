import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { FindingReviewCaseStatus, Prisma } from '../generated/prisma/client';
import { auditActorType, type CurrentActor } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFindingReviewCaseReopenDto } from './dto/create-finding-review-case-reopen.dto';
import { normalizeIdempotencyKey } from './finding-review-case-creation';
import {
  FINDING_REVIEW_CASE_REOPENED_EVENT,
  isSameFindingReviewReopenRequest,
  MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH,
  normalizeFindingReviewReopenJustification,
  reopenRequestFingerprint,
  type FindingReviewReopenSemanticRequest,
} from './finding-review-case-reopen';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';
import { isUpdatableFindingReviewCaseVersion } from './finding-review-case-status-transition';

const REOPEN_EVENT_SELECT = {
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

type ReopenEventRecord = Prisma.FindingReviewEventGetPayload<{
  select: typeof REOPEN_EVENT_SELECT;
}>;

interface ReopenMetadata {
  justification: string;
}

@Injectable()
export class FindingReviewReopensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

  async create(
    caseId: string,
    payload: CreateFindingReviewCaseReopenDto,
    rawIdempotencyKey: unknown,
    actor: CurrentActor,
  ) {
    this.feature.assertEnabled();
    const idempotencyKey = this.validateIdempotencyKey(rawIdempotencyKey);
    const fingerprint = reopenRequestFingerprint(actor.id, caseId, idempotencyKey);
    const semanticRequest = this.semanticRequest(caseId, payload);

    const existingRequest = await this.findByFingerprint(caseId, fingerprint);
    if (existingRequest) return this.replayOrReject(existingRequest, semanticRequest);

    if (!isUpdatableFindingReviewCaseVersion(payload.expectedVersion)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_EXPECTED_VERSION',
        message: 'A versão esperada excede o limite persistível para uma reabertura.',
      });
    }

    const occurredAt = new Date();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const replayInsideTransaction = await transaction.findingReviewEvent.findFirst({
          where: {
            caseId,
            eventType: FINDING_REVIEW_CASE_REOPENED_EVENT,
            requestId: fingerprint,
          },
          select: REOPEN_EVENT_SELECT,
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
            reviewSubjectKey: true,
            activeReviewSubjectKey: true,
          },
        });

        if (!current) throw this.caseNotFound();
        if (current.version !== payload.expectedVersion) throw this.versionConflict();
        if (current.status !== FindingReviewCaseStatus.RESOLVED) {
          throw this.reopenNotAllowed();
        }

        const activeCase = await transaction.findingReviewCase.findUnique({
          where: { activeReviewSubjectKey: current.reviewSubjectKey },
          select: { id: true },
        });
        if (activeCase && activeCase.id !== caseId) {
          throw this.activeSubjectConflict(activeCase.id);
        }

        const justification = this.validateJustification(semanticRequest.justification);
        const versionAfter = payload.expectedVersion + 1;
        const updated = await transaction.findingReviewCase.updateMany({
          where: {
            id: caseId,
            version: payload.expectedVersion,
            status: FindingReviewCaseStatus.RESOLVED,
            activeReviewSubjectKey: null,
          },
          data: {
            status: FindingReviewCaseStatus.IN_REVIEW,
            version: { increment: 1 },
            activeReviewSubjectKey: current.reviewSubjectKey,
            updatedAt: occurredAt,
          },
        });
        if (updated.count !== 1) throw this.versionConflict();

        const event = await transaction.findingReviewEvent.create({
          data: {
            caseId,
            eventType: FINDING_REVIEW_CASE_REOPENED_EVENT,
            versionBefore: payload.expectedVersion,
            versionAfter,
            actorId: actor.id,
            requestId: fingerprint,
            previousStatus: FindingReviewCaseStatus.RESOLVED,
            nextStatus: FindingReviewCaseStatus.IN_REVIEW,
            before: {
              status: FindingReviewCaseStatus.RESOLVED,
              version: payload.expectedVersion,
            },
            after: {
              status: FindingReviewCaseStatus.IN_REVIEW,
              version: versionAfter,
            },
            metadata: { justification },
            occurredAt,
            createdAt: occurredAt,
          },
          select: REOPEN_EVENT_SELECT,
        });

        await transaction.auditLog.create({
          data: {
            actorType: auditActorType(actor),
            actorId: actor.id,
            action: FINDING_REVIEW_CASE_REOPENED_EVENT,
            entityType: 'FindingReviewCase',
            entityId: caseId,
            before: {
              status: FindingReviewCaseStatus.RESOLVED,
              version: payload.expectedVersion,
            },
            after: {
              status: FindingReviewCaseStatus.IN_REVIEW,
              version: versionAfter,
            },
            metadata: {
              caseId,
              eventId: event.id,
              eventType: FINDING_REVIEW_CASE_REOPENED_EVENT,
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
      if (this.isActiveSubjectConflict(error)) throw error;
      if (this.isVersionConflict(error) || isPrismaError(error, 'P2002')) {
        const requestReopen = await this.findByFingerprint(caseId, fingerprint);
        if (requestReopen) return this.replayOrReject(requestReopen, semanticRequest);

        const activeCase = await this.findActiveCaseForSubject(caseId);
        if (activeCase && activeCase.id !== caseId) {
          throw this.activeSubjectConflict(activeCase.id);
        }
        throw this.versionConflict();
      }
      throw error;
    }
  }

  private semanticRequest(
    caseId: string,
    payload: CreateFindingReviewCaseReopenDto,
  ): FindingReviewReopenSemanticRequest {
    return {
      caseId,
      expectedVersion: payload.expectedVersion,
      justification: typeof payload.justification === 'string'
        ? normalizeFindingReviewReopenJustification(payload.justification)
        : '',
    };
  }

  private validateJustification(value: string): string {
    if (value.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FINDING_REVIEW_REOPEN_JUSTIFICATION_REQUIRED',
        message: 'Informe uma justificativa para reabrir a investigação.',
      });
    }
    if (value.length > MAX_FINDING_REVIEW_REOPEN_JUSTIFICATION_LENGTH) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_REOPEN_JUSTIFICATION',
        message: 'A justificativa deve ter no máximo 1000 caracteres.',
      });
    }
    return value;
  }

  private async findByFingerprint(
    caseId: string,
    fingerprint: string,
  ): Promise<ReopenEventRecord | null> {
    return this.prisma.findingReviewEvent.findFirst({
      where: {
        caseId,
        eventType: FINDING_REVIEW_CASE_REOPENED_EVENT,
        requestId: fingerprint,
      },
      select: REOPEN_EVENT_SELECT,
    });
  }

  private async findActiveCaseForSubject(caseId: string): Promise<{ id: string } | null> {
    const reviewCase = await this.prisma.findingReviewCase.findUnique({
      where: { id: caseId },
      select: { reviewSubjectKey: true },
    });
    if (!reviewCase) return null;
    return this.prisma.findingReviewCase.findUnique({
      where: { activeReviewSubjectKey: reviewCase.reviewSubjectKey },
      select: { id: true },
    });
  }

  private replayOrReject(
    record: ReopenEventRecord,
    request: FindingReviewReopenSemanticRequest,
  ) {
    const metadata = readReopenMetadata(record.metadata);
    if (!isSameFindingReviewReopenRequest({
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

  private present(record: ReopenEventRecord, idempotentReplay: boolean) {
    const metadata = readReopenMetadata(record.metadata);
    if (
      !metadata
      || record.versionBefore === null
      || record.previousStatus !== FindingReviewCaseStatus.RESOLVED
      || record.nextStatus !== FindingReviewCaseStatus.IN_REVIEW
    ) {
      throw new Error('O evento persistido de reabertura está inconsistente.');
    }
    return {
      idempotentReplay,
      reopen: {
        eventId: record.id,
        caseId: record.caseId,
        justification: metadata.justification,
        versionBefore: record.versionBefore,
        versionAfter: record.versionAfter,
        previousStatus: record.previousStatus,
        status: record.nextStatus,
        reopenedBy: record.actorId,
        reopenedAt: record.occurredAt.toISOString(),
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

  private activeSubjectConflict(existingCaseId: string): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'ACTIVE_REVIEW_CASE_EXISTS',
      message: 'Já existe um caso ativo para este assunto de revisão.',
      existingCaseId,
    });
  }

  private reopenNotAllowed(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_CASE_REOPEN_NOT_ALLOWED',
      message: 'Somente casos resolvidos podem ser reabertos.',
    });
  }

  private isVersionConflict(error: unknown): boolean {
    return hasExceptionCode(error, 'FINDING_REVIEW_CASE_VERSION_CONFLICT');
  }

  private isActiveSubjectConflict(error: unknown): boolean {
    return hasExceptionCode(error, 'ACTIVE_REVIEW_CASE_EXISTS');
  }
}

function readReopenMetadata(metadata: Prisma.JsonValue | null): ReopenMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const { justification } = metadata;
  return typeof justification === 'string' ? { justification } : null;
}

function hasExceptionCode(error: unknown, code: string): boolean {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return typeof response === 'object'
    && response !== null
    && 'code' in response
    && response.code === code;
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}
