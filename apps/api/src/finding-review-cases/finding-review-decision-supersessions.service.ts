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
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFindingReviewDecisionSupersessionDto } from './dto/create-finding-review-decision-supersession.dto';
import {
  decisionSupersessionRequestFingerprint,
  FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
  isSameFindingReviewDecisionSupersessionRequest,
  MAX_FINDING_REVIEW_DECISION_SUPERSESSION_TEXT_LENGTH,
  normalizeFindingReviewDecisionSupersessionText,
  type FindingReviewDecisionSupersessionSemanticRequest,
} from './finding-review-decision-supersession';
import {
  FINDING_REVIEW_ACTOR_ID,
  FINDING_REVIEW_SNAPSHOT_VERSION,
  normalizeIdempotencyKey,
} from './finding-review-case-creation';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';
import { isUpdatableFindingReviewCaseVersion } from './finding-review-case-status-transition';

const SUPERSESSION_DECISION_SELECT = {
  id: true,
  caseId: true,
  identityConclusion: true,
  justification: true,
  caseVersion: true,
  createdBy: true,
  requestFingerprint: true,
  createdAt: true,
} satisfies Prisma.FindingReviewDecisionSelect;

const SUPERSESSION_EVENT_SELECT = {
  id: true,
  caseId: true,
  eventType: true,
  versionBefore: true,
  versionAfter: true,
  requestId: true,
  before: true,
  after: true,
  metadata: true,
} satisfies Prisma.FindingReviewEventSelect;

const SUPERSESSION_PREVIOUS_DECISION_SELECT = {
  id: true,
  caseId: true,
  identityConclusion: true,
  caseVersion: true,
} satisfies Prisma.FindingReviewDecisionSelect;

type SupersessionDecisionRecord = Prisma.FindingReviewDecisionGetPayload<{
  select: typeof SUPERSESSION_DECISION_SELECT;
}>;

type SupersessionEventRecord = Prisma.FindingReviewEventGetPayload<{
  select: typeof SUPERSESSION_EVENT_SELECT;
}>;

type SupersessionPreviousDecisionRecord = Prisma.FindingReviewDecisionGetPayload<{
  select: typeof SUPERSESSION_PREVIOUS_DECISION_SELECT;
}>;

interface PersistedSupersession {
  decision: SupersessionDecisionRecord;
  event: SupersessionEventRecord;
  previousDecision: SupersessionPreviousDecisionRecord;
}

interface SupersessionMetadata {
  previousDecisionId: string;
  previousIdentityConclusion: FindingReviewIdentityConclusion;
  decisionId: string;
  identityConclusion: FindingReviewIdentityConclusion;
  correctionReason: string;
  expectedVersion: number;
}

interface SupersessionEventDecisionState {
  version: number;
  decisionId: string;
  identityConclusion: FindingReviewIdentityConclusion;
}

@Injectable()
export class FindingReviewDecisionSupersessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

  async create(
    caseId: string,
    supersededDecisionId: string,
    payload: CreateFindingReviewDecisionSupersessionDto,
    rawIdempotencyKey: unknown,
  ) {
    this.feature.assertEnabled();
    const idempotencyKey = this.validateIdempotencyKey(rawIdempotencyKey);
    const fingerprint = decisionSupersessionRequestFingerprint(idempotencyKey);
    const semanticRequest = this.semanticRequest(caseId, supersededDecisionId, payload);

    const existingRequest = await this.findByFingerprint(fingerprint);
    if (existingRequest) return this.replayOrReject(existingRequest, semanticRequest);

    if (!isUpdatableFindingReviewCaseVersion(payload.expectedVersion)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_EXPECTED_VERSION',
        message: 'A versão esperada excede o limite persistível para uma correção de decisão.',
      });
    }

    const occurredAt = new Date();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const replayDecision = await transaction.findingReviewDecision.findUnique({
          where: { requestFingerprint: fingerprint },
          select: SUPERSESSION_DECISION_SELECT,
        });
        if (replayDecision) {
          const replayEvent = await transaction.findingReviewEvent.findUnique({
            where: {
              caseId_requestId: {
                caseId: replayDecision.caseId,
                requestId: fingerprint,
              },
            },
            select: SUPERSESSION_EVENT_SELECT,
          });
          if (!replayEvent) throw this.persistedRequestInconsistent();
          const replayMetadata = readSupersessionMetadata(replayEvent.metadata);
          if (!replayMetadata) throw this.persistedRequestInconsistent();
          const previousDecision = await transaction.findingReviewDecision.findUnique({
            where: { id: replayMetadata.previousDecisionId },
            select: SUPERSESSION_PREVIOUS_DECISION_SELECT,
          });
          if (!previousDecision) throw this.persistedRequestInconsistent();
          return {
            record: { decision: replayDecision, event: replayEvent, previousDecision },
            replay: true,
          };
        }

        const current = await transaction.findingReviewCase.findUnique({
          where: { id: caseId },
          select: {
            id: true,
            status: true,
            version: true,
            activeReviewSubjectKey: true,
            originalSnapshot: true,
            assets: { select: { assetIdAtCreation: true } },
            decisions: {
              orderBy: [{ caseVersion: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: {
                id: true,
                caseId: true,
                identityConclusion: true,
                justification: true,
                caseVersion: true,
              },
            },
          },
        });

        if (!current) throw this.caseNotFound();
        if (current.version !== payload.expectedVersion) throw this.versionConflict();
        if (current.status !== FindingReviewCaseStatus.IN_REVIEW) {
          throw this.supersessionNotAllowed();
        }

        const currentDecision = current.decisions[0];
        if (!currentDecision) throw this.currentDecisionRequired();
        if (currentDecision.id !== supersededDecisionId) throw this.decisionNotCurrent();

        const reviewOptions = this.snapshotReviewOptions(current.originalSnapshot);
        const historicalAssetCount = new Set(
          current.assets.map((asset) => asset.assetIdAtCreation),
        ).size;
        if (!reviewOptions.has(payload.identityConclusion) || historicalAssetCount < 2) {
          throw this.identityConclusionNotAllowed();
        }

        const justification = this.validateText(
          semanticRequest.justification,
          'justification',
        );
        const correctionReason = this.validateText(
          semanticRequest.correctionReason,
          'correctionReason',
        );
        if (
          currentDecision.identityConclusion === payload.identityConclusion
          && currentDecision.justification === justification
        ) {
          throw this.noEffectiveChange();
        }

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
            createdBy: FINDING_REVIEW_ACTOR_ID,
            requestFingerprint: fingerprint,
            createdAt: occurredAt,
          },
          select: SUPERSESSION_DECISION_SELECT,
        });

        const before = {
          version: payload.expectedVersion,
          decisionId: currentDecision.id,
          identityConclusion: currentDecision.identityConclusion,
        };
        const after = {
          version: versionAfter,
          decisionId: decision.id,
          identityConclusion: decision.identityConclusion,
        };
        const metadata = {
          previousDecisionId: currentDecision.id,
          previousIdentityConclusion: currentDecision.identityConclusion,
          decisionId: decision.id,
          identityConclusion: decision.identityConclusion,
          correctionReason,
          expectedVersion: payload.expectedVersion,
        };

        const event = await transaction.findingReviewEvent.create({
          data: {
            caseId,
            eventType: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
            versionBefore: payload.expectedVersion,
            versionAfter,
            actorId: FINDING_REVIEW_ACTOR_ID,
            requestId: fingerprint,
            previousStatus: null,
            nextStatus: null,
            before,
            after,
            metadata,
            occurredAt,
            createdAt: occurredAt,
          },
          select: SUPERSESSION_EVENT_SELECT,
        });

        await transaction.auditLog.create({
          data: {
            actorType: 'USER',
            actorId: FINDING_REVIEW_ACTOR_ID,
            action: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
            entityType: 'FindingReviewCase',
            entityId: caseId,
            before,
            after,
            metadata: {
              caseId,
              eventId: event.id,
              eventType: FINDING_REVIEW_DECISION_SUPERSEDED_EVENT,
              ...metadata,
              versionBefore: payload.expectedVersion,
              versionAfter,
            },
            occurredAt,
          },
        });

        return {
          record: { decision, event, previousDecision: currentDecision },
          replay: false,
        };
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
    supersededDecisionId: string,
    payload: CreateFindingReviewDecisionSupersessionDto,
  ): FindingReviewDecisionSupersessionSemanticRequest {
    return {
      caseId,
      supersededDecisionId,
      expectedVersion: payload.expectedVersion,
      identityConclusion: payload.identityConclusion,
      justification: typeof payload.justification === 'string'
        ? normalizeFindingReviewDecisionSupersessionText(payload.justification)
        : '',
      correctionReason: typeof payload.correctionReason === 'string'
        ? normalizeFindingReviewDecisionSupersessionText(payload.correctionReason)
        : '',
    };
  }

  private validateText(value: string, field: 'justification' | 'correctionReason'): string {
    const label = field === 'justification' ? 'justificativa' : 'motivo da correção';
    if (value.length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: field === 'justification'
          ? 'FINDING_REVIEW_DECISION_JUSTIFICATION_REQUIRED'
          : 'FINDING_REVIEW_DECISION_CORRECTION_REASON_REQUIRED',
        message: `Informe ${field === 'justification' ? 'uma' : 'o'} ${label}.`,
      });
    }
    if (value.length > MAX_FINDING_REVIEW_DECISION_SUPERSESSION_TEXT_LENGTH) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: field === 'justification'
          ? 'INVALID_FINDING_REVIEW_DECISION_JUSTIFICATION'
          : 'INVALID_FINDING_REVIEW_DECISION_CORRECTION_REASON',
        message: `${field === 'justification' ? 'A justificativa' : 'O motivo da correção'} deve ter no máximo 1000 caracteres.`,
      });
    }
    return value;
  }

  private snapshotReviewOptions(snapshot: Prisma.JsonValue): Set<string> {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw this.snapshotIncompatible();
    }
    if (
      snapshot.snapshotVersion !== FINDING_REVIEW_SNAPSHOT_VERSION
      || !Array.isArray(snapshot.reviewOptions)
      || !snapshot.reviewOptions.every((option) => typeof option === 'string')
    ) {
      throw this.snapshotIncompatible();
    }
    return new Set(snapshot.reviewOptions);
  }

  private async findByFingerprint(fingerprint: string): Promise<PersistedSupersession | null> {
    const decision = await this.prisma.findingReviewDecision.findUnique({
      where: { requestFingerprint: fingerprint },
      select: SUPERSESSION_DECISION_SELECT,
    });
    if (!decision) return null;
    const event = await this.prisma.findingReviewEvent.findUnique({
      where: {
        caseId_requestId: {
          caseId: decision.caseId,
          requestId: fingerprint,
        },
      },
      select: SUPERSESSION_EVENT_SELECT,
    });
    if (!event) throw this.persistedRequestInconsistent();
    const metadata = readSupersessionMetadata(event.metadata);
    if (!metadata) throw this.persistedRequestInconsistent();
    const previousDecision = await this.prisma.findingReviewDecision.findUnique({
      where: { id: metadata.previousDecisionId },
      select: SUPERSESSION_PREVIOUS_DECISION_SELECT,
    });
    if (!previousDecision) throw this.persistedRequestInconsistent();
    return { decision, event, previousDecision };
  }

  private replayOrReject(
    record: PersistedSupersession,
    request: FindingReviewDecisionSupersessionSemanticRequest,
  ) {
    const metadata = this.assertPersistedReplayConsistency(record);
    if (!isSameFindingReviewDecisionSupersessionRequest({
        caseId: record.decision.caseId,
        supersededDecisionId: metadata.previousDecisionId,
        expectedVersion: metadata.expectedVersion,
        identityConclusion: record.decision.identityConclusion,
        justification: record.decision.justification,
        correctionReason: metadata.correctionReason,
      }, request)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'A Idempotency-Key já foi usada com outro conteúdo.',
      });
    }
    return this.present(record, true);
  }

  private present(record: PersistedSupersession, idempotentReplay: boolean) {
    const metadata = this.assertPersistedReplayConsistency(record);
    return {
      decision: {
        id: record.decision.id,
        caseId: record.decision.caseId,
        identityConclusion: record.decision.identityConclusion,
        justification: record.decision.justification,
        caseVersion: record.decision.caseVersion,
        createdBy: record.decision.createdBy,
        createdAt: record.decision.createdAt.toISOString(),
      },
      supersededDecisionId: metadata.previousDecisionId,
      idempotentReplay,
    };
  }

  private assertPersistedReplayConsistency(
    record: PersistedSupersession,
  ): SupersessionMetadata {
    const metadata = readSupersessionMetadata(record.event.metadata);
    const before = readSupersessionEventDecisionState(record.event.before);
    const after = readSupersessionEventDecisionState(record.event.after);
    const versionBefore = record.event.versionBefore;
    if (
      record.event.eventType !== FINDING_REVIEW_DECISION_SUPERSEDED_EVENT
      || record.event.requestId !== record.decision.requestFingerprint
      || record.event.caseId !== record.decision.caseId
      || !metadata
      || !before
      || !after
      || versionBefore === null
      || versionBefore !== metadata.expectedVersion
      || record.event.versionAfter !== versionBefore + 1
      || record.event.versionAfter !== metadata.expectedVersion + 1
      || record.event.versionAfter !== record.decision.caseVersion
      || metadata.decisionId !== record.decision.id
      || metadata.identityConclusion !== record.decision.identityConclusion
      || after.version !== record.event.versionAfter
      || after.decisionId !== record.decision.id
      || after.identityConclusion !== record.decision.identityConclusion
      || before.version !== versionBefore
      || before.decisionId !== metadata.previousDecisionId
      || before.identityConclusion !== metadata.previousIdentityConclusion
      || record.previousDecision.id !== metadata.previousDecisionId
      || record.previousDecision.caseId !== record.decision.caseId
      || record.previousDecision.identityConclusion !== metadata.previousIdentityConclusion
      || record.previousDecision.caseVersion >= record.decision.caseVersion
      || record.previousDecision.caseVersion > versionBefore
    ) {
      throw this.persistedRequestInconsistent();
    }
    return metadata;
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

  private supersessionNotAllowed(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_DECISION_SUPERSESSION_NOT_ALLOWED',
      message: 'Somente casos em análise podem receber uma correção de decisão.',
    });
  }

  private currentDecisionRequired(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_CASE_DECISION_REQUIRED',
      message: 'O caso precisa de uma decisão corrente antes de registrar uma correção.',
    });
  }

  private decisionNotCurrent(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'FINDING_REVIEW_DECISION_NOT_CURRENT',
      message: 'A decisão informada não é mais a decisão corrente do caso.',
    });
  }

  private identityConclusionNotAllowed(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_IDENTITY_CONCLUSION_NOT_ALLOWED',
      message: 'A conclusão de identidade não é permitida para o snapshot deste caso.',
    });
  }

  private snapshotIncompatible(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_CASE_SNAPSHOT_INCOMPATIBLE',
      message: 'O snapshot do caso não é compatível com a correção de decisões.',
    });
  }

  private noEffectiveChange(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: 'FINDING_REVIEW_DECISION_SUPERSESSION_NO_CHANGE',
      message: 'A correção precisa alterar a conclusão ou a justificativa da decisão corrente.',
    });
  }

  private persistedRequestInconsistent(): Error {
    return new Error('O registro persistido da correção de decisão está inconsistente.');
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

function readSupersessionMetadata(metadata: Prisma.JsonValue | null): SupersessionMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const {
    previousDecisionId,
    previousIdentityConclusion,
    decisionId,
    identityConclusion,
    correctionReason,
    expectedVersion,
  } = metadata;
  if (
    typeof previousDecisionId !== 'string'
    || !isIdentityConclusion(previousIdentityConclusion)
    || typeof decisionId !== 'string'
    || !isIdentityConclusion(identityConclusion)
    || typeof correctionReason !== 'string'
    || typeof expectedVersion !== 'number'
    || !Number.isInteger(expectedVersion)
  ) {
    return null;
  }
  return {
    previousDecisionId,
    previousIdentityConclusion,
    decisionId,
    identityConclusion,
    correctionReason,
    expectedVersion,
  };
}

function readSupersessionEventDecisionState(
  value: Prisma.JsonValue | null,
): SupersessionEventDecisionState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, decisionId, identityConclusion } = value;
  if (
    typeof version !== 'number'
    || !Number.isInteger(version)
    || typeof decisionId !== 'string'
    || !isIdentityConclusion(identityConclusion)
  ) {
    return null;
  }
  return { version, decisionId, identityConclusion };
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
