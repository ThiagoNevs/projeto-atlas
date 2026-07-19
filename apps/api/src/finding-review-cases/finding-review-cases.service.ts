import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ConflictFindingsService } from '../conflict-analysis/conflict-findings.service';
import { FindingReviewCaseStatus, FindingReviewStaleness, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFindingReviewCaseDto } from './dto/create-finding-review-case.dto';
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

@Injectable()
export class FindingReviewCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly findings: ConflictFindingsService,
    private readonly feature: FindingReviewCasesFeature,
  ) {}

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

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
