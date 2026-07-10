import { BadRequestException, Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DATA_QUALITY_ISSUES,
  DataQualityIssue,
  QueryDataQualityAssetsDto,
} from './dto/query-data-quality-assets.dto';

const QUALITY_THRESHOLD = 70;
const RECENT_EVIDENCE_DAYS = 30;
const ATTRIBUTE_KEYS = {
  serialNumber: ['serialNumber', 'SERIALNUMBER'],
  manufacturer: ['manufacturer', 'MANUFACTURER'],
  model: ['model', 'MODEL'],
  operatingSystem: ['operatingSystem', 'OPERATINGSYSTEM', 'os', 'OS'],
} as const;
const SEARCH_ATTRIBUTE_KEYS = Object.values(ATTRIBUTE_KEYS).flat();
const MISSING_FIELD_LABELS: Partial<Record<DataQualityIssue, string>> = {
  MISSING_SERIAL_NUMBER: 'Número de série',
  MISSING_MANUFACTURER: 'Fabricante',
  MISSING_MODEL: 'Modelo',
  MISSING_OPERATING_SYSTEM: 'Sistema operacional',
  MISSING_NETWORK_INFO: 'Informações de rede',
  MISSING_ADMINISTRATIVE_STATUS: 'Status administrativo',
};

const qualityAssetSelect = {
  id: true,
  name: true,
  kind: true,
  administrativeStatus: true,
  operationalStatus: true,
  dataQualityScore: true,
  confidenceScore: true,
  lastSeenAt: true,
  attributes: {
    where: { isCurrent: true, key: { in: SEARCH_ATTRIBUTE_KEYS } },
    orderBy: [{ lastConfirmedAt: 'desc' as const }, { observedAt: 'desc' as const }],
    select: { key: true, valueText: true, value: true, evidenceId: true },
  },
  networkInterfaces: {
    where: { isCurrent: true },
    orderBy: [{ isPrimary: 'desc' as const }, { lastSeenAt: 'desc' as const }],
    select: { ipAddresses: true, macAddress: true, isPrimary: true, evidenceId: true },
  },
  evidence: {
    orderBy: [{ observedAt: 'desc' as const }, { ingestedAt: 'desc' as const }],
    take: 3,
    select: {
      id: true,
      source: true,
      evidenceType: true,
      observedAt: true,
      confidenceScore: true,
      dataQualityScore: true,
    },
  },
} satisfies Prisma.AssetSelect;

type QualityAsset = Prisma.AssetGetPayload<{ select: typeof qualityAssetSelect }>;
type QualityEvidence = QualityAsset['evidence'][number];
type ScoreFactorImpact = 'positive' | 'negative';

type AttributeSnapshot = {
  value: string;
  evidenceId: string | null;
};

@Injectable()
export class DataQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const recentCutoff = this.recentCutoff();
    const [
      totalAssets,
      lowDataQuality,
      lowConfidence,
      missingSerialNumber,
      missingManufacturer,
      missingModel,
      missingOperatingSystem,
      missingNetworkInfo,
      assetsWithoutRecentEvidence,
      averages,
    ] = await this.prisma.$transaction([
      this.prisma.asset.count(),
      this.prisma.asset.count({ where: this.issueWhere('LOW_DATA_QUALITY', recentCutoff) }),
      this.prisma.asset.count({ where: this.issueWhere('LOW_CONFIDENCE', recentCutoff) }),
      this.prisma.asset.count({ where: this.issueWhere('MISSING_SERIAL_NUMBER', recentCutoff) }),
      this.prisma.asset.count({ where: this.issueWhere('MISSING_MANUFACTURER', recentCutoff) }),
      this.prisma.asset.count({ where: this.issueWhere('MISSING_MODEL', recentCutoff) }),
      this.prisma.asset.count({
        where: this.issueWhere('MISSING_OPERATING_SYSTEM', recentCutoff),
      }),
      this.prisma.asset.count({ where: this.issueWhere('MISSING_NETWORK_INFO', recentCutoff) }),
      this.prisma.asset.count({ where: this.issueWhere('WITHOUT_RECENT_EVIDENCE', recentCutoff) }),
      this.prisma.asset.aggregate({
        _avg: { dataQualityScore: true, confidenceScore: true },
      }),
    ]);

    return {
      totalAssets,
      lowDataQuality,
      lowConfidence,
      missingSerialNumber,
      missingManufacturer,
      missingModel,
      missingOperatingSystem,
      missingNetworkInfo,
      missingAdministrativeStatus: 0,
      assetsWithoutRecentEvidence,
      averageDataQualityScore: averages._avg.dataQualityScore?.toNumber() ?? 0,
      averageConfidenceScore: averages._avg.confidenceScore?.toNumber() ?? 0,
    };
  }

  async findAssets(query: QueryDataQualityAssetsDto) {
    this.validateScoreRanges(query);
    const recentCutoff = this.recentCutoff();
    const where = this.buildWhere(query, recentCutoff);
    const skip = (query.page - 1) * query.pageSize;

    const [total, assets] = await this.prisma.$transaction([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({
        where,
        select: qualityAssetSelect,
        orderBy: [this.buildOrderBy(query), { id: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: assets.map((asset) => this.presentAsset(asset, recentCutoff)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  private buildWhere(query: QueryDataQualityAssetsDto, recentCutoff: Date): Prisma.AssetWhereInput {
    const search = query.search?.trim();
    const issueFilter = query.issue
      ? this.issueWhere(query.issue, recentCutoff)
      : { OR: DATA_QUALITY_ISSUES.map((issue) => this.issueWhere(issue, recentCutoff)) };

    return {
      kind: query.type,
      administrativeStatus: query.administrativeStatus,
      operationalStatus: query.operationalStatus,
      dataQualityScore:
        query.minDataQualityScore !== undefined || query.maxDataQualityScore !== undefined
          ? { gte: query.minDataQualityScore, lte: query.maxDataQualityScore }
          : undefined,
      confidenceScore:
        query.minConfidenceScore !== undefined || query.maxConfidenceScore !== undefined
          ? { gte: query.minConfidenceScore, lte: query.maxConfidenceScore }
          : undefined,
      AND: [
        issueFilter,
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { kind: { contains: search, mode: 'insensitive' as const } },
                  {
                    attributes: {
                      some: {
                        isCurrent: true,
                        key: { in: SEARCH_ATTRIBUTE_KEYS },
                        valueText: { contains: search, mode: 'insensitive' as const },
                      },
                    },
                  },
                  {
                    networkInterfaces: {
                      some: {
                        isCurrent: true,
                        OR: [
                          { macAddress: { contains: search, mode: 'insensitive' as const } },
                          { ipAddresses: { has: search } },
                        ],
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
  }

  private issueWhere(issue: DataQualityIssue, recentCutoff: Date): Prisma.AssetWhereInput {
    switch (issue) {
      case 'LOW_DATA_QUALITY':
        return { dataQualityScore: { lt: QUALITY_THRESHOLD } };
      case 'LOW_CONFIDENCE':
        return { confidenceScore: { lt: QUALITY_THRESHOLD } };
      case 'MISSING_SERIAL_NUMBER':
        return this.missingAttributeWhere(ATTRIBUTE_KEYS.serialNumber);
      case 'MISSING_MANUFACTURER':
        return this.missingAttributeWhere(ATTRIBUTE_KEYS.manufacturer);
      case 'MISSING_MODEL':
        return this.missingAttributeWhere(ATTRIBUTE_KEYS.model);
      case 'MISSING_OPERATING_SYSTEM':
        return this.missingAttributeWhere(ATTRIBUTE_KEYS.operatingSystem);
      case 'MISSING_NETWORK_INFO':
        return {
          networkInterfaces: {
            none: {
              isCurrent: true,
              OR: [{ macAddress: { not: null } }, { ipAddresses: { isEmpty: false } }],
            },
          },
        };
      case 'MISSING_ADMINISTRATIVE_STATUS':
        return { id: { in: [] } };
      case 'WITHOUT_RECENT_EVIDENCE':
        return { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: recentCutoff } }] };
    }
  }

  private missingAttributeWhere(keys: readonly string[]): Prisma.AssetWhereInput {
    return {
      attributes: {
        none: {
          isCurrent: true,
          key: { in: [...keys] },
          valueText: { not: '' },
        },
      },
    };
  }

  private presentAsset(asset: QualityAsset, recentCutoff: Date) {
    const serialNumberAttribute = this.attributeSnapshot(asset, ATTRIBUTE_KEYS.serialNumber);
    const manufacturerAttribute = this.attributeSnapshot(asset, ATTRIBUTE_KEYS.manufacturer);
    const modelAttribute = this.attributeSnapshot(asset, ATTRIBUTE_KEYS.model);
    const operatingSystemAttribute = this.attributeSnapshot(asset, ATTRIBUTE_KEYS.operatingSystem);
    const serialNumber = serialNumberAttribute?.value ?? null;
    const manufacturer = manufacturerAttribute?.value ?? null;
    const model = modelAttribute?.value ?? null;
    const operatingSystem = operatingSystemAttribute?.value ?? null;
    const networkInterface = asset.networkInterfaces.find(
      (item) => item.macAddress || item.ipAddresses.length > 0,
    );
    const issues: DataQualityIssue[] = [];

    if (asset.dataQualityScore?.lessThan(QUALITY_THRESHOLD)) issues.push('LOW_DATA_QUALITY');
    if (asset.confidenceScore?.lessThan(QUALITY_THRESHOLD)) issues.push('LOW_CONFIDENCE');
    if (!serialNumber) issues.push('MISSING_SERIAL_NUMBER');
    if (!manufacturer) issues.push('MISSING_MANUFACTURER');
    if (!model) issues.push('MISSING_MODEL');
    if (!operatingSystem) issues.push('MISSING_OPERATING_SYSTEM');
    if (!networkInterface) issues.push('MISSING_NETWORK_INFO');
    if (!asset.lastSeenAt || asset.lastSeenAt < recentCutoff)
      issues.push('WITHOUT_RECENT_EVIDENCE');

    return {
      id: asset.id,
      name: asset.name,
      hostname: asset.name,
      type: asset.kind,
      administrativeStatus: asset.administrativeStatus,
      operationalStatus: asset.operationalStatus,
      dataQualityScore: asset.dataQualityScore?.toNumber() ?? null,
      confidenceScore: asset.confidenceScore?.toNumber() ?? null,
      lastSeenAt: asset.lastSeenAt,
      issues,
      missingFields: issues.flatMap((issue) =>
        MISSING_FIELD_LABELS[issue] ? [MISSING_FIELD_LABELS[issue]] : [],
      ),
      primaryIp: networkInterface?.ipAddresses[0] ?? null,
      primaryMac: networkInterface?.macAddress ?? null,
      operatingSystem,
      serialNumber,
      manufacturer,
      model,
      scoreAnalysis: {
        quality: {
          metric: 'Qualidade dos dados',
          score: asset.dataQualityScore?.toNumber() ?? null,
          note: 'Score derivado de completude, rede e recência das evidências. Não representa decisão administrativa e não pode ser editado diretamente.',
          positiveFactors: this.qualityPositiveFactors({
            serialNumber: serialNumberAttribute,
            manufacturer: manufacturerAttribute,
            model: modelAttribute,
            operatingSystem: operatingSystemAttribute,
            networkEvidenceId: networkInterface?.evidenceId ?? null,
            lastSeenAt: asset.lastSeenAt,
            recentCutoff,
          }),
          negativeFactors: this.qualityNegativeFactors({
            serialNumber,
            manufacturer,
            model,
            operatingSystem,
            networkInterface,
            lastSeenAt: asset.lastSeenAt,
            recentCutoff,
          }),
          relatedEvidence: this.relatedEvidence(asset.evidence, [
            serialNumberAttribute?.evidenceId,
            manufacturerAttribute?.evidenceId,
            modelAttribute?.evidenceId,
            operatingSystemAttribute?.evidenceId,
            networkInterface?.evidenceId,
          ]),
        },
        confidence: {
          metric: 'Confiabilidade',
          score: asset.confidenceScore?.toNumber() ?? null,
          note: 'Score derivado da confiança das fontes e evidências observadas. Não representa decisão administrativa e não pode ser editado diretamente.',
          positiveFactors: this.confidencePositiveFactors(asset.evidence),
          negativeFactors: this.confidenceNegativeFactors(asset, recentCutoff),
          relatedEvidence: this.relatedEvidence(
            asset.evidence,
            asset.evidence.map((evidence) => evidence.id),
          ),
        },
      },
    };
  }

  private attributeSnapshot(
    asset: QualityAsset,
    keys: readonly string[],
  ): AttributeSnapshot | null {
    const normalizedKeys = new Set(keys.map((key) => this.normalizeKey(key)));
    const attribute = asset.attributes.find((item) =>
      normalizedKeys.has(this.normalizeKey(item.key)),
    );
    if (!attribute) return null;
    if (attribute.valueText?.trim()) {
      return { value: attribute.valueText.trim(), evidenceId: attribute.evidenceId };
    }
    if (typeof attribute.value === 'string' && attribute.value.trim()) {
      return { value: attribute.value.trim(), evidenceId: attribute.evidenceId };
    }
    return null;
  }

  private qualityPositiveFactors(input: {
    serialNumber: AttributeSnapshot | null;
    manufacturer: AttributeSnapshot | null;
    model: AttributeSnapshot | null;
    operatingSystem: AttributeSnapshot | null;
    networkEvidenceId: string | null;
    lastSeenAt: Date | null;
    recentCutoff: Date;
  }) {
    return [
      input.serialNumber
        ? this.factor(
            'SERIAL_NUMBER_PRESENT',
            'Número de série informado',
            'O ativo possui número de série atual.',
            'positive',
            [input.serialNumber.evidenceId],
          )
        : null,
      input.manufacturer
        ? this.factor(
            'MANUFACTURER_PRESENT',
            'Fabricante informado',
            'O ativo possui fabricante atual.',
            'positive',
            [input.manufacturer.evidenceId],
          )
        : null,
      input.model
        ? this.factor(
            'MODEL_PRESENT',
            'Modelo informado',
            'O ativo possui modelo atual.',
            'positive',
            [input.model.evidenceId],
          )
        : null,
      input.operatingSystem
        ? this.factor(
            'OPERATING_SYSTEM_PRESENT',
            'Sistema operacional informado',
            'O ativo possui sistema operacional atual.',
            'positive',
            [input.operatingSystem.evidenceId],
          )
        : null,
      input.networkEvidenceId
        ? this.factor(
            'NETWORK_INFO_PRESENT',
            'Rede identificada',
            'O ativo possui IP ou MAC atual.',
            'positive',
            [input.networkEvidenceId],
          )
        : null,
      input.lastSeenAt && input.lastSeenAt >= input.recentCutoff
        ? this.factor(
            'RECENT_EVIDENCE_PRESENT',
            'Evidência recente',
            'O ativo possui evidência dentro da janela operacional de 30 dias.',
            'positive',
          )
        : null,
    ].filter((factor) => factor !== null);
  }

  private qualityNegativeFactors(input: {
    serialNumber: string | null;
    manufacturer: string | null;
    model: string | null;
    operatingSystem: string | null;
    networkInterface: QualityAsset['networkInterfaces'][number] | undefined;
    lastSeenAt: Date | null;
    recentCutoff: Date;
  }) {
    return [
      !input.serialNumber
        ? this.factor(
            'MISSING_SERIAL_NUMBER',
            'Número de série ausente',
            'A identificação patrimonial fica menos completa sem número de série.',
            'negative',
          )
        : null,
      !input.manufacturer
        ? this.factor(
            'MISSING_MANUFACTURER',
            'Fabricante ausente',
            'A identificação técnica fica menos completa sem fabricante.',
            'negative',
          )
        : null,
      !input.model
        ? this.factor(
            'MISSING_MODEL',
            'Modelo ausente',
            'A identificação técnica fica menos completa sem modelo.',
            'negative',
          )
        : null,
      !input.operatingSystem
        ? this.factor(
            'MISSING_OPERATING_SYSTEM',
            'Sistema operacional ausente',
            'A análise operacional fica limitada sem sistema operacional.',
            'negative',
          )
        : null,
      !input.networkInterface
        ? this.factor(
            'MISSING_NETWORK_INFO',
            'Rede não identificada',
            'O ativo não possui IP ou MAC atual registrado.',
            'negative',
          )
        : null,
      !input.lastSeenAt || input.lastSeenAt < input.recentCutoff
        ? this.factor(
            'WITHOUT_RECENT_EVIDENCE',
            'Sem evidência recente',
            'O ativo não possui evidência dentro da janela operacional de 30 dias.',
            'negative',
          )
        : null,
    ].filter((factor) => factor !== null);
  }

  private confidencePositiveFactors(evidence: QualityEvidence[]) {
    const technicalEvidence = evidence.find((item) => item.source !== 'MANUAL');
    const multipleEvidence = evidence.length > 1;

    return [
      technicalEvidence
        ? this.factor(
            'TECHNICAL_EVIDENCE_PRESENT',
            'Evidência técnica disponível',
            'Há evidência não manual relacionada ao ativo.',
            'positive',
            [technicalEvidence.id],
          )
        : null,
      multipleEvidence
        ? this.factor(
            'MULTIPLE_EVIDENCES_PRESENT',
            'Múltiplas evidências',
            'Mais de uma evidência recente está relacionada ao ativo.',
            'positive',
            evidence.map((item) => item.id),
          )
        : null,
    ].filter((factor) => factor !== null);
  }

  private confidenceNegativeFactors(asset: QualityAsset, recentCutoff: Date) {
    const latestEvidence = asset.evidence[0];
    return [
      asset.confidenceScore?.lessThan(QUALITY_THRESHOLD)
        ? this.factor(
            'LOW_CONFIDENCE_SCORE',
            'Confiabilidade abaixo de 70',
            'O score atual está abaixo do limite operacional de acompanhamento.',
            'negative',
            latestEvidence ? [latestEvidence.id] : [],
          )
        : null,
      latestEvidence?.source === 'MANUAL'
        ? this.factor(
            'LATEST_EVIDENCE_MANUAL',
            'Evidência mais recente é manual',
            'Informação manual é útil, mas não substitui confirmação técnica.',
            'negative',
            [latestEvidence.id],
          )
        : null,
      !asset.lastSeenAt || asset.lastSeenAt < recentCutoff
        ? this.factor(
            'NO_RECENT_TECHNICAL_CONFIRMATION',
            'Sem confirmação técnica recente',
            'A confiabilidade pode ser afetada pela ausência de observação recente.',
            'negative',
            latestEvidence ? [latestEvidence.id] : [],
          )
        : null,
    ].filter((factor) => factor !== null);
  }

  private factor(
    code: string,
    label: string,
    description: string,
    impact: ScoreFactorImpact,
    evidenceIds: Array<string | null | undefined> = [],
  ) {
    return {
      code,
      label,
      description,
      impact,
      evidenceIds: evidenceIds.filter((id): id is string => Boolean(id)),
    };
  }

  private relatedEvidence(
    evidence: QualityEvidence[],
    preferredIds: Array<string | null | undefined>,
  ) {
    const preferred = new Set(preferredIds.filter((id): id is string => Boolean(id)));
    return evidence
      .filter((item) => preferred.size === 0 || preferred.has(item.id))
      .map((item) => ({
        id: item.id,
        source: item.source,
        evidenceType: item.evidenceType,
        observedAt: item.observedAt,
        confidenceScore: item.confidenceScore?.toNumber() ?? null,
        dataQualityScore: item.dataQualityScore?.toNumber() ?? null,
      }));
  }

  private normalizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private buildOrderBy(query: QueryDataQualityAssetsDto): Prisma.AssetOrderByWithRelationInput {
    const field = query.sortBy === 'type' ? 'kind' : query.sortBy;
    return { [field]: query.sortDirection };
  }

  private validateScoreRanges(query: QueryDataQualityAssetsDto): void {
    if (
      query.minDataQualityScore !== undefined &&
      query.maxDataQualityScore !== undefined &&
      query.minDataQualityScore > query.maxDataQualityScore
    ) {
      throw new BadRequestException(
        'minDataQualityScore must be less than or equal to maxDataQualityScore.',
      );
    }
    if (
      query.minConfidenceScore !== undefined &&
      query.maxConfidenceScore !== undefined &&
      query.minConfidenceScore > query.maxConfidenceScore
    ) {
      throw new BadRequestException(
        'minConfidenceScore must be less than or equal to maxConfidenceScore.',
      );
    }
  }

  private recentCutoff(): Date {
    return new Date(Date.now() - RECENT_EVIDENCE_DAYS * 24 * 60 * 60 * 1_000);
  }
}
