import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import {
  AdministrativeStatus,
  AttributeValueType,
  OperationalStatus,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assetDetailSelect,
  assetSummarySelect,
  presentAssetDetail,
  presentAssetSummary,
} from './asset.presenter';
import { UpdateAdministrativeStatusDto } from './dto/update-administrative-status.dto';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { CreateManualAssetDto, MANUAL_ASSET_TYPES } from './dto/create-manual-asset.dto';
import { ImportAssetsCsvDto } from './dto/import-assets-csv.dto';
import { ManualEnrichmentDto } from './dto/manual-enrichment.dto';
import {
  AssetImportParserService,
  AssetImportRow,
  ParsedAssetImport,
} from './asset-import-parser.service';

const SIMULATED_ACTOR_USER_ID = 'atlas-mvp-user';
const MANUAL_CONFIDENCE_SCORE = 60;
const MANUAL_SOURCE = 'MANUAL';
const MANUAL_EVIDENCE_TYPE = 'MANUAL_DECLARATION';
const MANUAL_EVENT_TYPE = 'ASSET_MANUALLY_DECLARED';
const MANUAL_ENRICHMENT_EVIDENCE_TYPE = 'MANUAL_ENRICHMENT';
const MANUAL_ENRICHMENT_EVENT_TYPE = 'ASSET_MANUALLY_ENRICHED';
const CSV_IMPORT_EVIDENCE_TYPE = 'CSV_MANUAL_IMPORT';
const CSV_IMPORT_EVENT_TYPE = 'ASSET_IMPORTED_FROM_CSV';
const CSV_IMPORT_ASSET_TYPE_LABELS: Record<string, string> = {
  SERVIDOR: 'SERVER',
  NOTEBOOK: 'NOTEBOOK',
  DESKTOP: 'DESKTOP',
  'ESTACAO DE TRABALHO': 'WORKSTATION',
  WORKSTATION: 'WORKSTATION',
  VM: 'VM',
  'MAQUINA VIRTUAL': 'VM',
  'DISPOSITIVO DE REDE': 'NETWORK_DEVICE',
  NETWORK_DEVICE: 'NETWORK_DEVICE',
  ARMAZENAMENTO: 'STORAGE',
  STORAGE: 'STORAGE',
  IMPRESSORA: 'PRINTER',
  PRINTER: 'PRINTER',
  DESCONHECIDO: 'UNKNOWN',
  UNKNOWN: 'UNKNOWN',
};
const CSV_IMPORT_ADMIN_STATUS_LABELS: Record<string, AdministrativeStatus> = {
  'EM USO': AdministrativeStatus.IN_USE,
  IN_USE: AdministrativeStatus.IN_USE,
  'EM ESTOQUE': AdministrativeStatus.IN_STOCK,
  IN_STOCK: AdministrativeStatus.IN_STOCK,
  'EM MANUTENCAO': AdministrativeStatus.MAINTENANCE,
  MAINTENANCE: AdministrativeStatus.MAINTENANCE,
  DESATIVADO: AdministrativeStatus.DEACTIVATED,
  DEACTIVATED: AdministrativeStatus.DEACTIVATED,
  DESCARTADO: AdministrativeStatus.DISCARDED,
  DISCARDED: AdministrativeStatus.DISCARDED,
  PERDIDO: AdministrativeStatus.LOST,
  LOST: AdministrativeStatus.LOST,
  'ROUBADO/FURTADO': AdministrativeStatus.STOLEN,
  ROUBADO: AdministrativeStatus.STOLEN,
  FURTADO: AdministrativeStatus.STOLEN,
  STOLEN: AdministrativeStatus.STOLEN,
  ARQUIVADO: AdministrativeStatus.ARCHIVED,
  ARCHIVED: AdministrativeStatus.ARCHIVED,
};

type AssetImportRelatedAsset = {
  id: string;
  hostname: string;
  primaryIp: string | null;
};

type AssetImportValidationIssue = {
  line: number;
  rowNumber: number;
  field: string;
  code: string;
  message: string;
  relatedAssets?: AssetImportRelatedAsset[];
};

type AssetImportPreviewRow = {
  rowNumber: number;
  hostname: string;
  ipAddress: string;
  status: 'VALID' | 'INVALID' | 'DUPLICATE' | 'VALID_WITH_WARNINGS';
  errors: AssetImportValidationIssue[];
  warnings: AssetImportValidationIssue[];
  existingAsset?: AssetImportRelatedAsset;
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importParser: AssetImportParserService,
  ) {}

  async findAll(query: QueryAssetsDto) {
    this.validateScoreRanges(query);
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query);
    const skip = (query.page - 1) * query.pageSize;

    const [total, assets] = await this.prisma.$transaction([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({
        where,
        select: assetSummarySelect,
        orderBy: [orderBy, { id: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: assets.map(presentAssetSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: assetDetailSelect,
    });

    if (!asset) {
      throw new NotFoundException(`Asset ${id} was not found.`);
    }

    return presentAssetDetail(asset);
  }

  async updateAdministrativeStatus(id: string, payload: UpdateAdministrativeStatusDto) {
    return this.prisma.$transaction(async (transaction) => {
      const currentAsset = await transaction.asset.findUnique({
        where: { id },
        select: { id: true, administrativeStatus: true },
      });

      if (!currentAsset) {
        throw new NotFoundException(`Asset ${id} was not found.`);
      }

      if (currentAsset.administrativeStatus === payload.administrativeStatus) {
        throw new BadRequestException(
          `Asset ${id} already has administrative status ${payload.administrativeStatus}.`,
        );
      }

      const occurredAt = new Date();
      const changeData = {
        previousStatus: currentAsset.administrativeStatus,
        newStatus: payload.administrativeStatus,
        reason: payload.reason.trim(),
        comment: payload.comment.trim(),
        actorUserId: SIMULATED_ACTOR_USER_ID,
      };

      const asset = await transaction.asset.update({
        where: { id },
        data: { administrativeStatus: payload.administrativeStatus },
        select: assetDetailSelect,
      });

      const event = await transaction.assetEvent.create({
        data: {
          assetId: id,
          eventType: 'ADMIN_STATUS_CHANGED',
          title: 'Status administrativo alterado',
          description: `${changeData.previousStatus} → ${changeData.newStatus}: ${changeData.reason}`,
          data: changeData,
          occurredAt,
        },
        select: { id: true },
      });

      const auditLog = await transaction.auditLog.create({
        data: {
          assetId: id,
          actorType: 'USER',
          actorId: SIMULATED_ACTOR_USER_ID,
          action: 'ADMIN_STATUS_CHANGED',
          entityType: 'Asset',
          entityId: id,
          before: { administrativeStatus: changeData.previousStatus },
          after: { administrativeStatus: changeData.newStatus },
          metadata: {
            reason: changeData.reason,
            comment: changeData.comment,
          },
          occurredAt,
        },
        select: { id: true },
      });

      return {
        asset: presentAssetDetail(asset),
        previousStatus: changeData.previousStatus,
        administrativeStatus: changeData.newStatus,
        eventId: event.id,
        auditLogId: auditLog.id,
      };
    });
  }

  private buildWhere(query: QueryAssetsDto): Prisma.AssetWhereInput {
    const search = query.search?.trim();
    const relevantAttributeKeys = [
      'serialNumber',
      'manufacturer',
      'model',
      'operatingSystem',
      'osVersion',
    ];

    return {
      operationalStatus: query.operationalStatus,
      administrativeStatus: query.administrativeStatus,
      kind: query.type,
      confidenceScore:
        query.minConfidenceScore !== undefined || query.maxConfidenceScore !== undefined
          ? { gte: query.minConfidenceScore, lte: query.maxConfidenceScore }
          : undefined,
      dataQualityScore:
        query.minDataQualityScore !== undefined || query.maxDataQualityScore !== undefined
          ? { gte: query.minDataQualityScore, lte: query.maxDataQualityScore }
          : undefined,
      OR: search
        ? [
            { name: { contains: search, mode: 'insensitive' } },
            { canonicalKey: { contains: search, mode: 'insensitive' } },
            { kind: { contains: search, mode: 'insensitive' } },
            {
              attributes: {
                some: {
                  key: { in: relevantAttributeKeys },
                  valueText: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              networkInterfaces: {
                some: {
                  OR: [
                    { macAddress: { contains: search, mode: 'insensitive' } },
                    { ipAddresses: { has: search } },
                  ],
                },
              },
            },
          ]
        : undefined,
    };
  }

  private buildOrderBy(query: QueryAssetsDto): Prisma.AssetOrderByWithRelationInput {
    const direction = query.sortDirection;

    switch (query.sortBy) {
      case 'evidenceCount':
        return { evidence: { _count: direction } };
      case 'eventCount':
        return { events: { _count: direction } };
      case 'name':
        return { name: direction };
      case 'confidenceScore':
        return { confidenceScore: direction };
      case 'dataQualityScore':
        return { dataQualityScore: direction };
      case 'createdAt':
        return { createdAt: direction };
      case 'updatedAt':
        return { updatedAt: direction };
      case 'lastSeenAt':
      default:
        return { lastSeenAt: direction };
    }
  }

  private validateScoreRanges(query: QueryAssetsDto): void {
    if (
      query.minConfidenceScore !== undefined &&
      query.maxConfidenceScore !== undefined &&
      query.minConfidenceScore > query.maxConfidenceScore
    ) {
      throw new BadRequestException(
        'minConfidenceScore must be less than or equal to maxConfidenceScore.',
      );
    }
    if (
      query.minDataQualityScore !== undefined &&
      query.maxDataQualityScore !== undefined &&
      query.minDataQualityScore > query.maxDataQualityScore
    ) {
      throw new BadRequestException(
        'minDataQualityScore must be less than or equal to maxDataQualityScore.',
      );
    }
  }

  private manualAttributes(payload: CreateManualAssetDto): Array<{ key: string; value: string }> {
    const candidates = [
      ['hostname', payload.hostname],
      ['serialNumber', payload.serialNumber],
      ['manufacturer', payload.manufacturer],
      ['model', payload.model],
      ['operatingSystem', payload.operatingSystem],
      ['osVersion', payload.osVersion],
      ['location', payload.location],
      ['owner', payload.owner],
      ['department', payload.department],
      ['environment', payload.environment],
      ['criticality', payload.criticality],
      ['comment', payload.comment],
    ];
    return candidates.flatMap(([key, value]) =>
      value?.trim() ? [{ key: key!, value: value.trim() }] : [],
    );
  }

  private calculateManualDataQuality(payload: CreateManualAssetDto): number {
    const relevantValues = [
      payload.identifier,
      payload.type,
      payload.administrativeStatus,
      payload.hostname,
      payload.serialNumber,
      payload.manufacturer,
      payload.model,
      payload.operatingSystem,
      payload.osVersion,
      payload.location,
      payload.owner,
      payload.department,
      payload.environment,
      payload.criticality,
      payload.comment,
    ];
    const completed = relevantValues.filter(
      (value) => typeof value === 'string' && value.trim() !== '',
    ).length;
    return Math.round((completed / relevantValues.length) * 10000) / 100;
  }

  private manualPayload(payload: CreateManualAssetDto): Prisma.InputJsonObject {
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
  }

  private normalizeIdentifier(identifier: string, identifierType: string): string {
    const normalized = identifier.trim().toLowerCase();
    return identifierType === 'MAC_ADDRESS'
      ? normalized.replaceAll('-', ':').replace(/\s/g, '')
      : normalized;
  }

  private manualDuplicateWhere(
    payload: CreateManualAssetDto,
    canonicalKey: string,
    name: string,
    normalizedIdentifier: string,
  ): Prisma.AssetWhereInput {
    const alternatives: Prisma.AssetWhereInput[] = [
      { canonicalKey },
      { name: { equals: name, mode: 'insensitive' } },
    ];
    if (payload.hostname) {
      alternatives.push({ name: { equals: payload.hostname, mode: 'insensitive' } });
    }
    if (payload.serialNumber) {
      alternatives.push({
        attributes: {
          some: {
            isCurrent: true,
            key: { in: ['serialNumber', 'SERIALNUMBER'] },
            valueText: { equals: payload.serialNumber, mode: 'insensitive' },
          },
        },
      });
    }
    if (payload.identifierType === 'SERIAL_NUMBER') {
      alternatives.push({
        attributes: {
          some: {
            isCurrent: true,
            key: { in: ['serialNumber', 'SERIALNUMBER'] },
            valueText: { equals: payload.identifier, mode: 'insensitive' },
          },
        },
      });
    }
    if (payload.identifierType === 'MAC_ADDRESS') {
      alternatives.push({
        networkInterfaces: {
          some: { macAddress: { equals: normalizedIdentifier, mode: 'insensitive' } },
        },
      });
    }
    return { OR: alternatives };
  }

  async createManual(payload: CreateManualAssetDto) {
    const occurredAt = new Date();
    const identifier = payload.identifier.trim();
    const normalizedIdentifier = this.normalizeIdentifier(identifier, payload.identifierType);
    const canonicalKey = `manual:${payload.identifierType.toLowerCase()}:${normalizedIdentifier}`;
    const name = payload.hostname?.trim() || identifier;
    const confidenceScore = MANUAL_CONFIDENCE_SCORE;
    const dataQualityScore = this.calculateManualDataQuality(payload);
    const attributes = this.manualAttributes(payload);
    const evidencePayload = this.manualPayload(payload);
    const fingerprint = createHash('sha256').update(JSON.stringify(evidencePayload)).digest('hex');

    return this.prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.asset.findFirst({
        where: this.manualDuplicateWhere(payload, canonicalKey, name, normalizedIdentifier),
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Já existe um ativo com identificador semelhante.');
      }

      const asset = await transaction.asset.create({
        data: {
          canonicalKey,
          name,
          kind: payload.type,
          operationalStatus: OperationalStatus.UNKNOWN,
          administrativeStatus: payload.administrativeStatus,
          confidenceScore,
          dataQualityScore,
          firstSeenAt: null,
          lastSeenAt: null,
        },
      });
      const evidence = await transaction.assetEvidence.create({
        data: {
          assetId: asset.id,
          source: MANUAL_SOURCE,
          sourceRecordId: identifier,
          evidenceType: MANUAL_EVIDENCE_TYPE,
          payload: evidencePayload,
          fingerprint,
          confidenceScore,
          dataQualityScore,
          observedAt: occurredAt,
        },
      });

      if (attributes.length) {
        await transaction.assetAttribute.createMany({
          data: attributes.map((attribute) => ({
            assetId: asset.id,
            evidenceId: evidence.id,
            key: attribute.key,
            value: attribute.value,
            valueText: attribute.value,
            valueType: AttributeValueType.STRING,
            confidenceScore,
            dataQualityScore,
            isCurrent: true,
            observedAt: occurredAt,
            lastConfirmedAt: occurredAt,
            validFrom: occurredAt,
          })),
        });
      }

      const eventData = {
        identifier,
        identifierType: payload.identifierType,
        reason: payload.reason,
        source: MANUAL_SOURCE,
        actorUserId: SIMULATED_ACTOR_USER_ID,
      };
      const event = await transaction.assetEvent.create({
        data: {
          assetId: asset.id,
          evidenceId: evidence.id,
          eventType: MANUAL_EVENT_TYPE,
          title: 'Ativo declarado manualmente',
          description: payload.reason,
          data: eventData,
          occurredAt,
        },
        select: { id: true },
      });
      const auditLog = await transaction.auditLog.create({
        data: {
          assetId: asset.id,
          actorType: 'USER',
          actorId: SIMULATED_ACTOR_USER_ID,
          action: MANUAL_EVENT_TYPE,
          entityType: 'Asset',
          entityId: asset.id,
          after: {
            identifier,
            identifierType: payload.identifierType,
            type: payload.type,
            administrativeStatus: payload.administrativeStatus,
          },
          metadata: {
            ...eventData,
            fieldsProvided: attributes.map((attribute) => attribute.key),
            origin: 'manual-declaration',
            comment: payload.comment,
          },
          occurredAt,
        },
        select: { id: true },
      });
      const detail = await transaction.asset.findUniqueOrThrow({
        where: { id: asset.id },
        select: assetDetailSelect,
      });

      return {
        asset: presentAssetDetail(detail),
        evidenceId: evidence.id,
        eventId: event.id,
        auditLogId: auditLog.id,
      };
    });
  }

  async importCsv(payload: ImportAssetsCsvDto) {
    return this.commitAssetImport(this.importParser.parseText(payload.csv));
  }

  async importSpreadsheet(file: Express.Multer.File | undefined) {
    return this.commitAssetImport(await this.importParser.parseSpreadsheet(file));
  }

  async previewCsv(payload: ImportAssetsCsvDto) {
    return this.buildImportPreview(this.importParser.parseText(payload.csv));
  }

  async previewSpreadsheet(file: Express.Multer.File | undefined) {
    return this.buildImportPreview(await this.importParser.parseSpreadsheet(file));
  }

  async commitCsv(payload: ImportAssetsCsvDto) {
    return this.commitAssetImport(this.importParser.parseText(payload.csv));
  }

  async commitSpreadsheet(file: Express.Multer.File | undefined) {
    return this.commitAssetImport(await this.importParser.parseSpreadsheet(file));
  }

  private async commitAssetImport(parsed: ParsedAssetImport) {
    const preview = await this.buildImportPreview(parsed);
    const spreadsheet = parsed.format === 'XLSX' || parsed.format === 'XLSM';
    const source = spreadsheet ? 'spreadsheet-import' : 'csv-import';
    const evidenceType = spreadsheet ? 'SPREADSHEET_MANUAL_IMPORT' : CSV_IMPORT_EVIDENCE_TYPE;
    const eventType = spreadsheet ? 'ASSET_IMPORTED_FROM_SPREADSHEET' : CSV_IMPORT_EVENT_TYPE;
    const previewByRow = new Map(preview.rows.map((row) => [row.rowNumber, row]));
    const createdAssets: Array<ReturnType<typeof presentAssetDetail>> = [];
    const skippedRows = preview.rows
      .filter((row) => row.status === 'DUPLICATE')
      .map((row) => ({
        rowNumber: row.rowNumber,
        hostname: row.hostname,
        ipAddress: row.ipAddress,
        reason: row.errors[0]?.message ?? 'Hostname já cadastrado.',
        existingAssetId: row.existingAsset?.id ?? null,
      }));
    const invalidRows = preview.rows
      .filter((row) => row.status === 'INVALID')
      .map((row) => ({
        rowNumber: row.rowNumber,
        hostname: row.hostname,
        ipAddress: row.ipAddress,
        errors: row.errors,
      }));
    const failedRows: Array<{
      rowNumber: number;
      hostname: string;
      ipAddress: string;
      reason: string;
    }> = [];

    for (const row of parsed.rows) {
      const rowPreview = previewByRow.get(row.line);
      if (!rowPreview || !['VALID', 'VALID_WITH_WARNINGS'].includes(rowPreview.status)) continue;

      try {
        const outcome = await this.prisma.$transaction(async (transaction) => {
          const hostname = row.data.hostname.trim();
          const existing = await transaction.asset.findFirst({
            where: { name: { equals: hostname, mode: 'insensitive' } },
            select: {
              id: true,
              name: true,
              networkInterfaces: {
                where: { isCurrent: true },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
                take: 1,
                select: { ipAddresses: true },
              },
            },
          });
          if (existing) {
            return {
              kind: 'duplicate' as const,
              existingAsset: this.presentImportRelatedAsset(existing),
            };
          }

          const occurredAt = new Date();
        const type = this.csvAssetType(row.data.type);
        const administrativeStatus = this.csvAdministrativeStatus(row.data.administrativeStatus);
        const attributes = this.csvAttributes(row.data);
        const confidenceScore = MANUAL_CONFIDENCE_SCORE;
        const dataQualityScore = this.calculateCsvDataQuality(row.data);
        const evidencePayload = {
          source,
          format: parsed.format,
          fileName: parsed.fileName,
          line: row.line,
          ...row.data,
        };
        const fingerprint = createHash('sha256')
          .update(JSON.stringify(evidencePayload))
          .digest('hex');

        const asset = await transaction.asset.create({
          data: {
            canonicalKey: spreadsheet
              ? `manual:spreadsheet:hostname:${hostname.toLocaleLowerCase()}`
              : `manual:csv:hostname:${hostname.toLocaleLowerCase()}`,
            name: hostname,
            kind: type,
            operationalStatus: OperationalStatus.UNKNOWN,
            administrativeStatus,
            confidenceScore,
            dataQualityScore,
            firstSeenAt: null,
            lastSeenAt: null,
          },
        });
        const evidence = await transaction.assetEvidence.create({
          data: {
            assetId: asset.id,
            source: MANUAL_SOURCE,
            sourceRecordId: hostname,
            evidenceType,
            payload: evidencePayload,
            fingerprint,
            confidenceScore,
            dataQualityScore,
            observedAt: occurredAt,
          },
        });

        if (attributes.length) {
          await transaction.assetAttribute.createMany({
            data: attributes.map((attribute) => ({
              assetId: asset.id,
              evidenceId: evidence.id,
              key: attribute.key,
              value: attribute.value,
              valueText: attribute.value,
              valueType: AttributeValueType.STRING,
              confidenceScore,
              dataQualityScore,
              isCurrent: true,
              observedAt: occurredAt,
              lastConfirmedAt: occurredAt,
              validFrom: occurredAt,
            })),
          });
        }

        await transaction.networkInterface.create({
          data: {
            assetId: asset.id,
            evidenceId: evidence.id,
            identityKey: row.data.macAddress
              ? `mac:${this.normalizeMac(row.data.macAddress)}`
              : spreadsheet
                ? `spreadsheet-hostname:${hostname.toLocaleLowerCase()}:primary`
                : `csv-hostname:${hostname.toLocaleLowerCase()}:primary`,
            name: spreadsheet ? 'spreadsheet-import-primary' : 'csv-import-primary',
            macAddress: row.data.macAddress ? this.normalizeMac(row.data.macAddress) : null,
            ipAddresses: [row.data.ipAddress.trim()],
            isPrimary: true,
            isCurrent: true,
          },
        });

        const eventData = {
          source,
          format: parsed.format,
          fileName: parsed.fileName,
          line: row.line,
          hostname,
          ipAddress: row.data.ipAddress.trim(),
          actorUserId: SIMULATED_ACTOR_USER_ID,
          comment: row.data.comment || null,
        };
        const event = await transaction.assetEvent.create({
          data: {
            assetId: asset.id,
            evidenceId: evidence.id,
            eventType,
            title: spreadsheet ? 'Ativo importado por planilha' : 'Ativo importado por CSV',
            description:
              row.data.comment ||
              (spreadsheet
                ? 'Declaração manual controlada via importação de planilha.'
                : 'Declaração manual controlada via importação CSV.'),
            data: eventData,
            occurredAt,
          },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            assetId: asset.id,
            actorType: 'USER',
            actorId: SIMULATED_ACTOR_USER_ID,
            action: eventType,
            entityType: 'Asset',
            entityId: asset.id,
            after: {
              hostname,
              ipAddress: row.data.ipAddress.trim(),
              type,
              administrativeStatus,
            },
            metadata: {
              ...eventData,
              eventId: event.id,
              fieldsProvided: attributes.map((attribute) => attribute.key),
              origin: source,
            },
            occurredAt,
          },
        });

        const detail = await transaction.asset.findUniqueOrThrow({
          where: { id: asset.id },
          select: assetDetailSelect,
        });
          return { kind: 'created' as const, asset: presentAssetDetail(detail) };
        });

        if (outcome.kind === 'duplicate') {
          skippedRows.push({
            rowNumber: row.line,
            hostname: row.data.hostname.trim(),
            ipAddress: row.data.ipAddress.trim(),
            reason: `O hostname ${row.data.hostname.trim()} já está cadastrado no Atlas.`,
            existingAssetId: outcome.existingAsset.id,
          });
        } else {
          createdAssets.push(outcome.asset);
        }
      } catch {
        failedRows.push({
          rowNumber: row.line,
          hostname: row.data.hostname.trim(),
          ipAddress: row.data.ipAddress.trim(),
          reason: 'Não foi possível importar esta linha com segurança.',
        });
      }
    }

    const warnings = preview.rows.flatMap((row) => row.warnings);
    const uniqueSkippedRows = [...new Map(skippedRows.map((row) => [row.rowNumber, row])).values()];

    return {
      processedCount: parsed.rows.length,
      importedCount: createdAssets.length,
      createdCount: createdAssets.length,
      skippedCount: uniqueSkippedRows.length,
      failedCount: invalidRows.length + failedRows.length,
      errors: invalidRows.flatMap((row) => row.errors),
      format: parsed.format,
      warningCount: warnings.length,
      warnings,
      assets: createdAssets,
      summary: {
        total: parsed.rows.length,
        created: createdAssets.length,
        skipped: uniqueSkippedRows.length,
        invalid: invalidRows.length,
        failed: failedRows.length,
        warnings: warnings.length,
      },
      createdAssets,
      skippedRows: uniqueSkippedRows,
      invalidRows,
      failedRows,
    };
  }

  async enrichManually(id: string, payload: ManualEnrichmentDto) {
    const attributes = Object.entries(payload.attributes).flatMap(([key, value]) =>
      typeof value === 'string' && value.trim() ? [{ key, value: value.trim() }] : [],
    );
    if (!attributes.length) {
      throw new BadRequestException('At least one non-empty attribute is required.');
    }

    const occurredAt = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const asset = await transaction.asset.findUnique({
        where: { id },
        select: {
          id: true,
          canonicalKey: true,
          name: true,
          kind: true,
          administrativeStatus: true,
          confidenceScore: true,
          dataQualityScore: true,
          lastSeenAt: true,
          attributes: {
            where: { isCurrent: true },
            select: {
              id: true,
              key: true,
              valueText: true,
              value: true,
              lastConfirmedAt: true,
            },
          },
          networkInterfaces: {
            where: { isCurrent: true },
            select: { macAddress: true, ipAddresses: true },
          },
        },
      });
      if (!asset) throw new NotFoundException(`Asset ${id} was not found.`);

      const currentByKey = new Map(
        asset.attributes.map((attribute) => [this.normalizeAttributeKey(attribute.key), attribute]),
      );
      for (const attribute of attributes) {
        const current = currentByKey.get(this.normalizeAttributeKey(attribute.key));
        const currentValue = this.attributeText(current);
        if (
          currentValue &&
          currentValue.toLocaleLowerCase() !== attribute.value.toLocaleLowerCase()
        ) {
          throw new ConflictException(
            `O campo ${attribute.key} já possui um valor atual diferente. Para evitar sobrescrever evidências, a alteração não foi aplicada.`,
          );
        }
      }

      const mergedValues = new Map(
        asset.attributes.flatMap((attribute) => {
          const value = this.attributeText(attribute);
          return value ? [[this.normalizeAttributeKey(attribute.key), value] as const] : [];
        }),
      );
      attributes.forEach((attribute) =>
        mergedValues.set(this.normalizeAttributeKey(attribute.key), attribute.value),
      );
      const calculatedQuality = this.calculateEnrichedDataQuality(asset, mergedValues);
      const currentQuality = asset.dataQualityScore?.toNumber() ?? 0;
      const dataQualityScore = Math.max(currentQuality, calculatedQuality);
      const evidencePayload = {
        reason: payload.reason,
        comment: payload.comment ?? null,
        attributes: Object.fromEntries(
          attributes.map((attribute) => [attribute.key, attribute.value]),
        ),
      };
      const evidence = await transaction.assetEvidence.create({
        data: {
          assetId: id,
          source: MANUAL_SOURCE,
          evidenceType: MANUAL_ENRICHMENT_EVIDENCE_TYPE,
          payload: evidencePayload,
          fingerprint: createHash('sha256').update(JSON.stringify(evidencePayload)).digest('hex'),
          confidenceScore: MANUAL_CONFIDENCE_SCORE,
          dataQualityScore,
          observedAt: occurredAt,
        },
        select: { id: true },
      });

      const createdAttributes: string[] = [];
      const confirmedAttributes: string[] = [];
      for (const attribute of attributes) {
        const current = currentByKey.get(this.normalizeAttributeKey(attribute.key));
        if (current) {
          await transaction.assetAttribute.update({
            where: { id: current.id },
            data: {
              confirmationCount: { increment: 1 },
              lastConfirmedAt:
                current.lastConfirmedAt > occurredAt ? current.lastConfirmedAt : occurredAt,
            },
          });
          confirmedAttributes.push(attribute.key);
        } else {
          await transaction.assetAttribute.create({
            data: {
              assetId: id,
              evidenceId: evidence.id,
              key: attribute.key,
              value: attribute.value,
              valueText: attribute.value,
              valueType: AttributeValueType.STRING,
              confidenceScore: MANUAL_CONFIDENCE_SCORE,
              dataQualityScore,
              isCurrent: true,
              observedAt: occurredAt,
              lastConfirmedAt: occurredAt,
              validFrom: occurredAt,
            },
          });
          createdAttributes.push(attribute.key);
        }
      }

      await transaction.asset.update({ where: { id }, data: { dataQualityScore } });
      const eventData = {
        reason: payload.reason,
        comment: payload.comment ?? null,
        attributes: Object.fromEntries(
          attributes.map((attribute) => [attribute.key, attribute.value]),
        ),
        createdAttributes,
        confirmedAttributes,
        source: MANUAL_SOURCE,
        actorUserId: SIMULATED_ACTOR_USER_ID,
      };
      const previousValues = Object.fromEntries(
        attributes.map((attribute) => {
          const current = currentByKey.get(this.normalizeAttributeKey(attribute.key));
          return [attribute.key, this.attributeText(current)];
        }),
      );
      const event = await transaction.assetEvent.create({
        data: {
          assetId: id,
          evidenceId: evidence.id,
          eventType: MANUAL_ENRICHMENT_EVENT_TYPE,
          title: 'Ativo enriquecido manualmente',
          description: payload.reason,
          data: eventData,
          occurredAt,
        },
        select: { id: true },
      });
      const auditLog = await transaction.auditLog.create({
        data: {
          assetId: id,
          actorType: 'USER',
          actorId: SIMULATED_ACTOR_USER_ID,
          action: MANUAL_ENRICHMENT_EVENT_TYPE,
          entityType: 'ASSET',
          entityId: id,
          before: previousValues,
          after: Object.fromEntries(
            attributes.map((attribute) => [attribute.key, attribute.value]),
          ),
          metadata: eventData,
          occurredAt,
        },
        select: { id: true },
      });
      const detail = await transaction.asset.findUniqueOrThrow({
        where: { id },
        select: assetDetailSelect,
      });

      return {
        asset: presentAssetDetail(detail),
        createdAttributes,
        confirmedAttributes,
        evidenceId: evidence.id,
        eventId: event.id,
        auditLogId: auditLog.id,
      };
    });
  }

  private async buildImportPreview(parsed: ParsedAssetImport) {
    const hostnames = [...new Set(parsed.rows.map((row) => row.data.hostname.trim().toLocaleLowerCase()).filter(Boolean))];
    const ipAddresses = [...new Set(parsed.rows.map((row) => row.data.ipAddress.trim()).filter((ip) => isIP(ip) > 0))];
    const [existingAssets, existingInterfaces] = await Promise.all([
      hostnames.length
        ? this.prisma.asset.findMany({
            where: {
              OR: hostnames.map((hostname) => ({
                name: { equals: hostname, mode: 'insensitive' as const },
              })),
            },
            select: {
              id: true,
              name: true,
              networkInterfaces: {
                where: { isCurrent: true },
                orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'desc' as const }],
                take: 1,
                select: { ipAddresses: true },
              },
            },
          })
        : [],
      ipAddresses.length
        ? this.prisma.networkInterface.findMany({
            where: { ipAddresses: { hasSome: ipAddresses } },
            select: {
              ipAddresses: true,
              asset: {
                select: {
                  id: true,
                  name: true,
                  networkInterfaces: {
                    where: { isCurrent: true },
                    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'desc' as const }],
                    take: 1,
                    select: { ipAddresses: true },
                  },
                },
              },
            },
          })
        : [],
    ]);
    const existingByHostname = new Map(
      existingAssets.map((asset) => [asset.name.toLocaleLowerCase(), this.presentImportRelatedAsset(asset)]),
    );
    const assetsByIp = new Map<string, AssetImportRelatedAsset[]>();
    for (const networkInterface of existingInterfaces) {
      const relatedAsset = this.presentImportRelatedAsset(networkInterface.asset);
      for (const ipAddress of networkInterface.ipAddresses) {
        if (!ipAddresses.includes(ipAddress)) continue;
        const current = assetsByIp.get(ipAddress) ?? [];
        if (!current.some((asset) => asset.id === relatedAsset.id)) current.push(relatedAsset);
        assetsByIp.set(ipAddress, current);
      }
    }

    const firstHostnameRows = new Map<string, number>();
    const firstIpRows = new Map<string, { line: number; hostname: string }>();
    const rows: AssetImportPreviewRow[] = parsed.rows.map((row) => {
      const hostname = row.data.hostname.trim();
      const ipAddress = row.data.ipAddress.trim();
      const errors: AssetImportValidationIssue[] = [];
      const warnings: AssetImportValidationIssue[] = [];
      const addError = (field: string, code: string, message: string) =>
        errors.push({ line: row.line, rowNumber: row.line, field, code, message });
      const addWarning = (
        field: string,
        code: string,
        message: string,
        relatedAssets?: AssetImportRelatedAsset[],
      ) => warnings.push({ line: row.line, rowNumber: row.line, field, code, message, relatedAssets });

      if (!hostname) addError('hostname', 'REQUIRED_HOSTNAME', 'Hostname é obrigatório.');
      if (!ipAddress) addError('ipAddress', 'REQUIRED_IP_ADDRESS', 'ipAddress é obrigatório.');
      else if (isIP(ipAddress) === 0) addError('ipAddress', 'INVALID_IP_ADDRESS', `O IP ${ipAddress} possui formato inválido.`);

      const lengthLimits: Partial<Record<keyof AssetImportRow, number>> = {
        hostname: 255,
        ipAddress: 45,
        operatingSystem: 255,
        osVersion: 100,
        location: 255,
        owner: 255,
        department: 255,
        type: 100,
        administrativeStatus: 100,
        manufacturer: 255,
        model: 255,
        serialNumber: 255,
        macAddress: 64,
        environment: 100,
        criticality: 100,
        comment: 1000,
      };
      for (const [field, limit] of Object.entries(lengthLimits) as Array<[keyof AssetImportRow, number]>) {
        if (row.data[field].length > limit) {
          addError(field, 'VALUE_TOO_LONG', `O campo ${field} excede o limite de ${limit} caracteres.`);
        }
      }
      if (
        row.data.type.trim() &&
        !MANUAL_ASSET_TYPES.includes(this.csvAssetType(row.data.type) as (typeof MANUAL_ASSET_TYPES)[number])
      ) {
        addError('type', 'INVALID_ASSET_TYPE', 'Tipo de ativo inválido.');
      }
      if (
        row.data.administrativeStatus.trim() &&
        !Object.values(AdministrativeStatus).includes(this.csvAdministrativeStatus(row.data.administrativeStatus))
      ) {
        addError('administrativeStatus', 'INVALID_ADMINISTRATIVE_STATUS', 'Status administrativo inválido.');
      }

      let existingAsset: AssetImportRelatedAsset | undefined;
      let duplicateInFile = false;
      const hasIntrinsicErrors = errors.length > 0;
      if (hostname && !hasIntrinsicErrors) {
        const normalizedHostname = hostname.toLocaleLowerCase();
        const firstLine = firstHostnameRows.get(normalizedHostname);
        if (firstLine) {
          duplicateInFile = true;
          addError(
            'hostname',
            'DUPLICATE_HOSTNAME_IN_FILE',
            `O hostname ${hostname} já aparece na linha ${firstLine} desta importação.`,
          );
        } else {
          firstHostnameRows.set(normalizedHostname, row.line);
          existingAsset = existingByHostname.get(normalizedHostname);
          if (existingAsset) {
            addError('hostname', 'DUPLICATE_HOSTNAME', `O hostname ${hostname} já está cadastrado no Atlas.`);
          }
        }
      }

      if (ipAddress && isIP(ipAddress) > 0) {
        const firstIp = firstIpRows.get(ipAddress);
        if (firstIp) {
          addWarning(
            'ipAddress',
            'DUPLICATE_IP_IN_FILE',
            `O IP ${ipAddress} também aparece na linha ${firstIp.line} (${firstIp.hostname || 'hostname não informado'}), mas esta linha pode ser importada.`,
          );
        } else {
          firstIpRows.set(ipAddress, { line: row.line, hostname });
        }
        const relatedAssets = assetsByIp.get(ipAddress) ?? [];
        if (relatedAssets.length) {
          addWarning(
            'ipAddress',
            'DUPLICATE_IP',
            `O IP ${ipAddress} também está associado a ${relatedAssets.map((asset) => asset.hostname).join(', ')}, mas esta linha pode ser importada porque IP não é identidade absoluta.`,
            relatedAssets,
          );
        }
      }

      const duplicate = Boolean(existingAsset) || duplicateInFile;
      const hasInvalidField = errors.some((error) => !error.code.startsWith('DUPLICATE_HOSTNAME'));
      const status: AssetImportPreviewRow['status'] = hasInvalidField
        ? 'INVALID'
        : duplicate
          ? 'DUPLICATE'
          : warnings.length
            ? 'VALID_WITH_WARNINGS'
            : 'VALID';
      return { rowNumber: row.line, hostname, ipAddress, status, errors, warnings, existingAsset };
    });

    return {
      format: parsed.format,
      fileName: parsed.fileName,
      summary: {
        total: rows.length,
        valid: rows.filter((row) => ['VALID', 'VALID_WITH_WARNINGS'].includes(row.status)).length,
        duplicates: rows.filter((row) => row.status === 'DUPLICATE').length,
        invalid: rows.filter((row) => row.status === 'INVALID').length,
        warnings: rows.reduce((total, row) => total + row.warnings.length, 0),
      },
      rows,
    };
  }

  private presentImportRelatedAsset(asset: {
    id: string;
    name: string;
    networkInterfaces: Array<{ ipAddresses: string[] }>;
  }): AssetImportRelatedAsset {
    return {
      id: asset.id,
      hostname: asset.name,
      primaryIp: asset.networkInterfaces[0]?.ipAddresses[0] ?? null,
    };
  }

  private csvAssetType(value: string): string {
    if (!value.trim()) return 'UNKNOWN';
    return CSV_IMPORT_ASSET_TYPE_LABELS[this.normalizeCsvLabel(value)] ?? value.trim().toUpperCase();
  }

  private csvAdministrativeStatus(value: string): AdministrativeStatus {
    if (!value.trim()) return AdministrativeStatus.IN_USE;
    return (
      CSV_IMPORT_ADMIN_STATUS_LABELS[this.normalizeCsvLabel(value)] ??
      (value.trim().toUpperCase() as AdministrativeStatus)
    );
  }

  private csvAttributes(row: AssetImportRow): Array<{ key: string; value: string }> {
    const candidates: Array<[string, string]> = [
      ['hostname', row.hostname],
      ['operatingSystem', row.operatingSystem],
      ['osVersion', row.osVersion],
      ['location', row.location],
      ['owner', row.owner],
      ['department', row.department],
      ['type', this.csvAssetType(row.type)],
      ['administrativeStatus', this.csvAdministrativeStatus(row.administrativeStatus)],
      ['manufacturer', row.manufacturer],
      ['model', row.model],
      ['serialNumber', row.serialNumber],
      ['environment', row.environment],
      ['criticality', row.criticality],
      ['comment', row.comment],
    ];
    return candidates.flatMap(([key, value]) =>
      value?.trim() ? [{ key, value: value.trim() }] : [],
    );
  }

  private calculateCsvDataQuality(row: AssetImportRow): number {
    const values = [
      row.hostname,
      row.ipAddress,
      row.operatingSystem,
      row.osVersion,
      row.location,
      row.owner,
      row.department,
      row.type,
      row.administrativeStatus,
      row.manufacturer,
      row.model,
      row.serialNumber,
      row.macAddress,
      row.environment,
      row.criticality,
      row.comment,
    ];
    const completed = values.filter((value) => value.trim()).length;
    return Math.round((completed / values.length) * 10000) / 100;
  }

  private normalizeCsvLabel(value: string): string {
    return value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .toLocaleUpperCase();
  }

  private normalizeMac(value: string): string {
    return value.trim().toLocaleLowerCase().replaceAll('-', ':').replace(/\s/g, '');
  }

  private attributeText(attribute: { valueText: string | null; value: unknown } | undefined) {
    if (!attribute) return null;
    if (attribute.valueText?.trim()) return attribute.valueText.trim();
    return typeof attribute.value === 'string' && attribute.value.trim()
      ? attribute.value.trim()
      : null;
  }

  private normalizeAttributeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private calculateEnrichedDataQuality(
    asset: {
      id: string;
      canonicalKey: string | null;
      name: string;
      kind: string;
      administrativeStatus: string;
      lastSeenAt: Date | null;
      networkInterfaces: Array<{ macAddress: string | null; ipAddresses: string[] }>;
    },
    attributes: Map<string, string>,
  ): number {
    const hasNetwork = asset.networkInterfaces.some(
      (networkInterface) =>
        Boolean(networkInterface.macAddress) || networkInterface.ipAddresses.length > 0,
    );
    const values = [
      asset.canonicalKey ?? asset.id,
      asset.name,
      asset.kind,
      asset.administrativeStatus,
      attributes.get('SERIALNUMBER'),
      attributes.get('MANUFACTURER'),
      attributes.get('MODEL'),
      attributes.get('OPERATINGSYSTEM') ?? attributes.get('OS'),
      attributes.get('OSVERSION'),
      attributes.get('LOCATION'),
      attributes.get('OWNER'),
      attributes.get('DEPARTMENT'),
      attributes.get('ENVIRONMENT'),
      attributes.get('CRITICALITY'),
      asset.lastSeenAt || hasNetwork ? 'observed' : undefined,
    ];
    const completed = values.filter(Boolean).length;
    return Math.round((completed / values.length) * 10000) / 100;
  }
}
