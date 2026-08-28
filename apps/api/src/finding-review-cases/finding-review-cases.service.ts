import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ConflictFindingsService } from '../conflict-analysis/conflict-findings.service';
import {
  FindingReviewCaseStatus,
  FindingReviewStaleness,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFindingReviewCaseDto } from './dto/create-finding-review-case.dto';
import type { UpdateFindingReviewCaseStatusDto } from './dto/update-finding-review-case-status.dto';
import {
  parseFindingReviewTimestamp,
  type QueryFindingReviewCasesDto,
} from './dto/query-finding-review-cases.dto';
import {
  buildFindingReviewSnapshot,
  creationRequestFingerprint,
  FINDING_REVIEW_ACTOR_ID,
  FINDING_REVIEW_CASE_CREATED_EVENT,
  normalizeIdempotencyKey,
  reviewSubjectKey,
  snapshotHash,
} from './finding-review-case-creation';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';
import {
  FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
  isUpdatableFindingReviewCaseVersion,
  isAllowedFindingReviewCaseStatusTransition,
  MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH,
  requiresFindingReviewCaseWaitingJustification,
  type ActiveFindingReviewCaseStatus,
} from './finding-review-case-status-transition';

const CASE_RESPONSE_SELECT = {
  id: true,
  findingId: true,
  findingType: true,
  policyVersion: true,
  reviewSubjectKey: true,
  status: true,
  staleness: true,
  version: true,
  createdBy: true,
  findingGeneratedAt: true,
  createdAt: true,
  assets: {
    orderBy: { assetIdAtCreation: 'asc' as const },
    select: {
      assetId: true,
      assetIdAtCreation: true,
      assetNameAtCreation: true,
      role: true,
    },
  },
} satisfies Prisma.FindingReviewCaseSelect;

type CaseResponseRecord = Prisma.FindingReviewCaseGetPayload<{
  select: typeof CASE_RESPONSE_SELECT;
}>;

const CASE_LIST_SELECT = {
  id: true,
  findingId: true,
  findingType: true,
  policyVersion: true,
  status: true,
  staleness: true,
  version: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assets: true, events: true } },
} satisfies Prisma.FindingReviewCaseSelect;

const CASE_DETAIL_SELECT = {
  id: true,
  findingId: true,
  findingType: true,
  policyVersion: true,
  status: true,
  staleness: true,
  version: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  originalSnapshot: true,
  originalSnapshotHash: true,
  assets: {
    orderBy: [{ createdAt: 'asc' as const }, { assetIdAtCreation: 'asc' as const }],
    select: {
      assetIdAtCreation: true,
      assetNameAtCreation: true,
      role: true,
      asset: { select: { id: true, name: true } },
    },
  },
  events: {
    orderBy: [
      { versionAfter: 'asc' as const },
      { createdAt: 'asc' as const },
      { id: 'asc' as const },
    ],
    select: {
      id: true,
      eventType: true,
      versionBefore: true,
      versionAfter: true,
      actorId: true,
      metadata: true,
      createdAt: true,
    },
  },
  decisions: {
    orderBy: [
      { caseVersion: 'asc' as const },
      { createdAt: 'asc' as const },
      { id: 'asc' as const },
    ],
    select: {
      id: true,
      caseId: true,
      identityConclusion: true,
      justification: true,
      caseVersion: true,
      createdBy: true,
      createdAt: true,
    },
  },
} satisfies Prisma.FindingReviewCaseSelect;

type CaseListRecord = Prisma.FindingReviewCaseGetPayload<{ select: typeof CASE_LIST_SELECT }>;
type CaseDetailRecord = Prisma.FindingReviewCaseGetPayload<{ select: typeof CASE_DETAIL_SELECT }>;

@Injectable()
export class FindingReviewCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly findings: ConflictFindingsService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

  async findAll(query: QueryFindingReviewCasesDto) {
    this.feature.assertEnabled();
    const where = this.buildReadWhere(query);
    const skip = this.calculateSafeSkip(query.page, query.pageSize);
    const orderBy = this.buildReadOrderBy(query);

    const [totalItems, records] = await this.prisma.$transaction([
      this.prisma.findingReviewCase.count({ where }),
      this.prisma.findingReviewCase.findMany({
        where,
        select: CASE_LIST_SELECT,
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: records.map((record) => this.presentListItem(record)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async findOne(id: string) {
    this.feature.assertEnabled();
    const record = await this.prisma.findingReviewCase.findUnique({
      where: { id },
      select: CASE_DETAIL_SELECT,
    });

    if (!record) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'FINDING_REVIEW_CASE_NOT_FOUND',
        message: 'O caso de revisão informado não foi encontrado.',
      });
    }

    return this.presentDetail(record);
  }

  async create(payload: CreateFindingReviewCaseDto, rawIdempotencyKey: unknown) {
    this.feature.assertEnabled();
    const idempotencyKey = this.validateIdempotencyKey(rawIdempotencyKey);
    const fingerprint = creationRequestFingerprint(idempotencyKey);

    const existingRequest = await this.findByFingerprint(fingerprint);
    if (existingRequest) return this.replayOrReject(existingRequest, payload.findingId);

    const current = await this.findings.findCurrentById(payload.findingId);
    if (!current) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'FINDING_NOT_FOUND',
        message: 'O achado informado não existe mais na análise atual.',
      });
    }

    let subjectKey: string;
    try {
      subjectKey = reviewSubjectKey(current.finding);
    } catch {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: 'FINDING_TYPE_NOT_SUPPORTED',
        message: 'O tipo do achado ainda não permite a criação de um caso de revisão.',
      });
    }

    const snapshot = buildFindingReviewSnapshot(current);
    const hash = snapshotHash(snapshot);
    const occurredAt = new Date();

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const replayInsideTransaction = await transaction.findingReviewCase.findUnique({
          where: { creationRequestFingerprint: fingerprint },
          select: CASE_RESPONSE_SELECT,
        });
        if (replayInsideTransaction) {
          return { record: replayInsideTransaction, replay: true };
        }

        const activeCase = await transaction.findingReviewCase.findUnique({
          where: { activeReviewSubjectKey: subjectKey },
          select: { id: true },
        });
        if (activeCase) throw this.activeSubjectConflict(activeCase.id);

        const assets = await transaction.asset.findMany({
          where: { id: { in: current.finding.affectedAssetIds } },
          select: { id: true, name: true },
          orderBy: { id: 'asc' },
        });
        if (assets.length !== current.finding.affectedAssetIds.length) {
          throw this.assetUnavailable();
        }

        const reviewCase = await transaction.findingReviewCase.create({
          data: {
            findingId: current.finding.findingId,
            findingType: current.finding.type,
            policyVersion: current.policyVersion,
            reviewSubjectKey: subjectKey,
            activeReviewSubjectKey: subjectKey,
            creationRequestFingerprint: fingerprint,
            status: FindingReviewCaseStatus.OPEN,
            staleness: FindingReviewStaleness.CURRENT,
            originalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            originalSnapshotHash: hash,
            version: 1,
            createdBy: FINDING_REVIEW_ACTOR_ID,
            findingGeneratedAt: new Date(current.generatedAt),
          },
          select: { id: true },
        });

        await transaction.findingReviewCaseAsset.createMany({
          data: assets.map((asset) => ({
            caseId: reviewCase.id,
            assetId: asset.id,
            assetIdAtCreation: asset.id,
            assetNameAtCreation: asset.name,
            role: 'AFFECTED_ASSET',
          })),
        });

        const event = await transaction.findingReviewEvent.create({
          data: {
            caseId: reviewCase.id,
            eventType: FINDING_REVIEW_CASE_CREATED_EVENT,
            versionBefore: null,
            versionAfter: 1,
            actorId: FINDING_REVIEW_ACTOR_ID,
            requestId: fingerprint,
            previousStatus: null,
            nextStatus: FindingReviewCaseStatus.OPEN,
            after: { status: FindingReviewCaseStatus.OPEN, version: 1 },
            metadata: {
              findingId: current.finding.findingId,
              reviewSubjectKey: subjectKey,
              originalSnapshotHash: hash,
              requestFingerprint: fingerprint,
            },
            occurredAt,
          },
          select: { id: true },
        });

        await transaction.auditLog.create({
          data: {
            actorType: 'USER',
            actorId: FINDING_REVIEW_ACTOR_ID,
            action: FINDING_REVIEW_CASE_CREATED_EVENT,
            entityType: 'FindingReviewCase',
            entityId: reviewCase.id,
            after: { status: FindingReviewCaseStatus.OPEN, version: 1 },
            metadata: {
              caseId: reviewCase.id,
              eventId: event.id,
              eventType: FINDING_REVIEW_CASE_CREATED_EVENT,
              findingId: current.finding.findingId,
              reviewSubjectKey: subjectKey,
              versionBefore: null,
              versionAfter: 1,
              requestFingerprint: fingerprint,
            },
            occurredAt,
          },
        });

        const record = await transaction.findingReviewCase.findUniqueOrThrow({
          where: { id: reviewCase.id },
          select: CASE_RESPONSE_SELECT,
        });
        return { record, replay: false };
      });

      if (created.replay) return this.replayOrReject(created.record, payload.findingId);
      return this.present(created.record, false);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof UnprocessableEntityException) {
        throw error;
      }
      if (isPrismaError(error, 'P2002')) {
        const requestCase = await this.findByFingerprint(fingerprint);
        if (requestCase) return this.replayOrReject(requestCase, payload.findingId);
        const activeCase = await this.prisma.findingReviewCase.findUnique({
          where: { activeReviewSubjectKey: subjectKey },
          select: { id: true },
        });
        if (activeCase) throw this.activeSubjectConflict(activeCase.id);
      }
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2025')) {
        throw this.assetUnavailable();
      }
      throw error;
    }
  }

  async updateStatus(id: string, payload: UpdateFindingReviewCaseStatusDto) {
    this.feature.assertEnabled();
    if (!isUpdatableFindingReviewCaseVersion(payload.expectedVersion)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_EXPECTED_VERSION',
        message: 'A versão esperada excede o limite persistível para uma transição.',
      });
    }
    const occurredAt = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.findingReviewCase.findUnique({
        where: { id },
        select: { id: true, status: true, version: true },
      });

      if (!current) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'FINDING_REVIEW_CASE_NOT_FOUND',
          message: 'O caso de revisão informado não foi encontrado.',
        });
      }

      if (current.version !== payload.expectedVersion) {
        throw this.versionConflict();
      }

      if (!isAllowedFindingReviewCaseStatusTransition(current.status, payload.status)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'INVALID_FINDING_REVIEW_CASE_STATUS_TRANSITION',
          message: 'A transição de status solicitada não é permitida para este caso.',
        });
      }

      const justification = this.validateStatusTransitionJustification(
        current.status,
        payload.status,
        payload.justification,
      );

      const versionAfter = payload.expectedVersion + 1;
      const updated = await transaction.findingReviewCase.updateMany({
        where: {
          id,
          version: payload.expectedVersion,
          status: current.status,
        },
        data: {
          status: payload.status,
          version: { increment: 1 },
          updatedAt: occurredAt,
        },
      });

      if (updated.count !== 1) throw this.versionConflict();

      const event = await transaction.findingReviewEvent.create({
        data: {
          caseId: id,
          eventType: FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
          versionBefore: payload.expectedVersion,
          versionAfter,
          actorId: FINDING_REVIEW_ACTOR_ID,
          previousStatus: current.status,
          nextStatus: payload.status,
          before: { status: current.status, version: payload.expectedVersion },
          after: { status: payload.status, version: versionAfter },
          metadata: {
            statusBefore: current.status,
            statusAfter: payload.status,
            ...(justification === null ? {} : { justification }),
          },
          occurredAt,
        },
        select: { id: true },
      });

      await transaction.auditLog.create({
        data: {
          actorType: 'USER',
          actorId: FINDING_REVIEW_ACTOR_ID,
          action: FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
          entityType: 'FindingReviewCase',
          entityId: id,
          before: { status: current.status, version: payload.expectedVersion },
          after: { status: payload.status, version: versionAfter },
          metadata: {
            caseId: id,
            eventId: event.id,
            eventType: FINDING_REVIEW_CASE_STATUS_CHANGED_EVENT,
            statusBefore: current.status,
            statusAfter: payload.status,
            versionBefore: payload.expectedVersion,
            versionAfter,
            ...(justification === null ? {} : { justification }),
          },
          occurredAt,
        },
      });

      const result = await transaction.findingReviewCase.findUniqueOrThrow({
        where: { id },
        select: { id: true, status: true, version: true, updatedAt: true },
      });

      return {
        id: result.id,
        status: result.status,
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
      };
    });
  }

  private validateStatusTransitionJustification(
    current: FindingReviewCaseStatus,
    next: ActiveFindingReviewCaseStatus,
    value: unknown,
  ): string | null {
    const required = requiresFindingReviewCaseWaitingJustification(current, next);
    if (!required) {
      if (value !== undefined) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'FINDING_REVIEW_CASE_JUSTIFICATION_NOT_ALLOWED',
          message: 'A justificativa só é permitida em transições que entram ou saem da espera por evidências.',
        });
      }
      return null;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'FINDING_REVIEW_CASE_JUSTIFICATION_REQUIRED',
        message: 'Informe uma justificativa para entrar ou sair da espera por evidências.',
      });
    }

    const normalized = value.trim();
    if (normalized.length > MAX_FINDING_REVIEW_CASE_JUSTIFICATION_LENGTH) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_JUSTIFICATION',
        message: 'A justificativa deve ter no máximo 500 caracteres.',
      });
    }
    return normalized;
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

  private buildReadWhere(query: QueryFindingReviewCasesDto): Prisma.FindingReviewCaseWhereInput {
    const createdFrom = query.createdFrom
      ? parseFindingReviewTimestamp(query.createdFrom)
      : undefined;
    const createdTo = query.createdTo ? parseFindingReviewTimestamp(query.createdTo) : undefined;
    if (createdFrom && createdTo && createdFrom.getTime() > createdTo.getTime()) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_DATE_RANGE',
        message: 'A data inicial não pode ser posterior à data final.',
      });
    }

    return {
      status: query.status,
      staleness: query.staleness,
      findingType: query.findingType,
      createdBy: query.createdBy,
      findingId: query.findingId,
      createdAt:
        createdFrom || createdTo
          ? {
              gte: createdFrom,
              lte: createdTo,
            }
          : undefined,
      assets: query.assetId
        ? {
            some: { assetIdAtCreation: query.assetId },
          }
        : undefined,
    };
  }

  private buildReadOrderBy(
    query: QueryFindingReviewCasesDto,
  ): Prisma.FindingReviewCaseOrderByWithRelationInput[] {
    return [{ [query.sortBy]: query.sortDirection }, { id: query.sortDirection }];
  }

  private calculateSafeSkip(page: number, pageSize: number): number {
    const skip = (BigInt(page) - 1n) * BigInt(pageSize);
    if (skip > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_FINDING_REVIEW_CASE_PAGINATION',
        message: 'A página solicitada excede o limite numérico seguro.',
      });
    }
    return Number(skip);
  }

  private presentListItem(record: CaseListRecord) {
    return {
      id: record.id,
      findingId: record.findingId,
      findingType: record.findingType,
      policyVersion: record.policyVersion,
      status: record.status,
      staleness: record.staleness,
      version: record.version,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      assetCount: record._count.assets,
      eventCount: record._count.events,
    };
  }

  private presentDetail(record: CaseDetailRecord) {
    const decisionHistory = record.decisions.map((decision) => ({
      id: decision.id,
      caseId: decision.caseId,
      identityConclusion: decision.identityConclusion,
      justification: decision.justification,
      caseVersion: decision.caseVersion,
      createdBy: decision.createdBy,
      createdAt: decision.createdAt.toISOString(),
    }));

    return {
      id: record.id,
      findingId: record.findingId,
      findingType: record.findingType,
      policyVersion: record.policyVersion,
      status: record.status,
      staleness: record.staleness,
      version: record.version,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      originalSnapshot: record.originalSnapshot,
      originalSnapshotHash: record.originalSnapshotHash,
      currentDecision: decisionHistory.at(-1) ?? null,
      decisionHistory,
      assets: record.assets.map((relation) => ({
        assetIdAtCreation: relation.assetIdAtCreation,
        assetNameAtCreation: relation.assetNameAtCreation,
        role: relation.role,
        currentAssetId: relation.asset?.id ?? null,
        currentAssetName: relation.asset?.name ?? null,
        currentAssetAvailable: relation.asset !== null,
      })),
      events: record.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        versionBefore: event.versionBefore,
        versionAfter: event.versionAfter,
        actor: event.actorId,
        metadata: presentSafeEventMetadata(event.metadata),
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private async findByFingerprint(fingerprint: string): Promise<CaseResponseRecord | null> {
    return this.prisma.findingReviewCase.findUnique({
      where: { creationRequestFingerprint: fingerprint },
      select: CASE_RESPONSE_SELECT,
    });
  }

  private replayOrReject(record: CaseResponseRecord, findingId: string) {
    if (record.findingId !== findingId) {
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'A Idempotency-Key já foi usada com outro conteúdo.',
      });
    }
    return this.present(record, true);
  }

  private activeSubjectConflict(caseId: string): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'ACTIVE_REVIEW_CASE_EXISTS',
      message: 'Já existe um caso ativo para este assunto de revisão.',
      existingCaseId: caseId,
    });
  }

  private assetUnavailable(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'FINDING_ASSET_UNAVAILABLE',
      message: 'Um ativo relacionado ao achado não está mais disponível.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'FINDING_REVIEW_CASE_VERSION_CONFLICT',
      message: 'O caso foi alterado por outra operação. Recarregue os dados antes de tentar novamente.',
    });
  }

  private present(record: CaseResponseRecord, idempotentReplay: boolean) {
    return {
      id: record.id,
      findingId: record.findingId,
      findingType: record.findingType,
      policyVersion: record.policyVersion,
      reviewSubjectKey: record.reviewSubjectKey,
      status: record.status,
      staleness: record.staleness,
      version: record.version,
      affectedAssets: record.assets.map((asset) => ({
        assetId: asset.assetId ?? asset.assetIdAtCreation,
        assetName: asset.assetNameAtCreation,
        role: asset.role,
      })),
      createdBy: record.createdBy,
      findingGeneratedAt: record.findingGeneratedAt,
      createdAt: record.createdAt,
      idempotentReplay,
    };
  }
}

function presentSafeEventMetadata(
  metadata: Prisma.JsonValue | null,
): Record<string, string> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const safe: Record<string, string> = {};
  for (const key of [
    'findingId',
    'originalSnapshotHash',
    'statusBefore',
    'statusAfter',
    'justification',
    'decisionId',
    'identityConclusion',
    'previousDecisionId',
    'previousIdentityConclusion',
    'correctionReason',
  ]) {
    const value = metadata[key];
    if (typeof value === 'string') safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
