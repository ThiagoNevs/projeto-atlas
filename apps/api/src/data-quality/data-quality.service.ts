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
    select: { key: true, valueText: true, value: true },
  },
  networkInterfaces: {
    where: { isCurrent: true },
    orderBy: [{ isPrimary: 'desc' as const }, { lastSeenAt: 'desc' as const }],
    select: { ipAddresses: true, macAddress: true, isPrimary: true },
  },
} satisfies Prisma.AssetSelect;

type QualityAsset = Prisma.AssetGetPayload<{ select: typeof qualityAssetSelect }>;

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
    const serialNumber = this.attributeValue(asset, ATTRIBUTE_KEYS.serialNumber);
    const manufacturer = this.attributeValue(asset, ATTRIBUTE_KEYS.manufacturer);
    const model = this.attributeValue(asset, ATTRIBUTE_KEYS.model);
    const operatingSystem = this.attributeValue(asset, ATTRIBUTE_KEYS.operatingSystem);
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
    };
  }

  private attributeValue(asset: QualityAsset, keys: readonly string[]): string | null {
    const normalizedKeys = new Set(keys.map((key) => this.normalizeKey(key)));
    const attribute = asset.attributes.find((item) =>
      normalizedKeys.has(this.normalizeKey(item.key)),
    );
    if (!attribute) return null;
    if (attribute.valueText?.trim()) return attribute.valueText.trim();
    return typeof attribute.value === 'string' && attribute.value.trim()
      ? attribute.value.trim()
      : null;
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
