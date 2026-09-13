import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import {
  AttributeValueType,
  ConflictStatus,
  NetworkDiscoveryMethod,
  NetworkDiscoveryResultStatus,
  NetworkDiscoveryRunStatus,
  OperationalStatus,
  Prisma,
} from '../generated/prisma/client';
import { auditActorType, type CurrentActor } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNetworkDiscoveryProfileDto } from './dto/create-network-discovery-profile.dto';
import { UpdateNetworkDiscoveryProfileDto } from './dto/update-network-discovery-profile.dto';
import { isIpv4Cidr } from './validators/is-ipv4-cidr';

const MAX_SIMULATED_TARGETS_PER_RUN = 3;
const NETWORK_CONFLICT_TYPE = 'NETWORK_IDENTITY_CONFLICT';

type SimulatedObservation = {
  ipAddress: string;
  macAddress: string;
  hostname: string;
  method: NetworkDiscoveryMethod;
  confidenceScore: number;
};

@Injectable()
export class NetworkDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  findProfiles() {
    return this.prisma.networkDiscoveryProfile.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: { _count: { select: { runs: true } } },
    });
  }

  async createProfile(dto: CreateNetworkDiscoveryProfileDto, actor: CurrentActor) {
    this.validateScope(dto.allowedCidrs);

    return this.prisma.$transaction(async (transaction) => {
      const profile = await transaction.networkDiscoveryProfile.create({
        data: {
          ...dto,
          description: dto.description || null,
          deniedCidrs: dto.deniedCidrs ?? [],
          scheduleEnabled: dto.scheduleEnabled ?? false,
          scheduleExpression: dto.scheduleExpression || null,
        },
        include: { _count: { select: { runs: true } } },
      });

      await transaction.auditLog.create({
        data: {
          actorType: auditActorType(actor),
          actorId: actor.id,
          action: 'NETWORK_DISCOVERY_PROFILE_CREATED',
          entityType: 'NetworkDiscoveryProfile',
          entityId: profile.id,
          after: this.profileAuditSnapshot(profile),
        },
      });

      return profile;
    });
  }

  async findProfile(id: string) {
    const profile = await this.prisma.networkDiscoveryProfile.findUnique({
      where: { id },
      include: {
        _count: { select: { runs: true } },
        runs: { orderBy: { startedAt: 'desc' }, take: 10 },
      },
    });

    if (!profile) throw new NotFoundException(`Network discovery profile ${id} was not found.`);
    return profile;
  }

  async updateProfile(id: string, dto: UpdateNetworkDiscoveryProfileDto, actor: CurrentActor) {
    if (dto.allowedCidrs !== undefined) this.validateScope(dto.allowedCidrs);

    return this.prisma.$transaction(async (transaction) => {
      const lockedRows = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "network_discovery_profiles"
          WHERE "id" = CAST(${id} AS uuid)
          FOR UPDATE
        `,
      );
      if (lockedRows.length === 0) {
        throw new NotFoundException(`Network discovery profile ${id} was not found.`);
      }

      const current = await transaction.networkDiscoveryProfile.findUnique({ where: { id } });
      if (!current) throw new NotFoundException(`Network discovery profile ${id} was not found.`);

      if (dto.allowedCidrs === undefined) this.validateScope(current.allowedCidrs);

      const updated = await transaction.networkDiscoveryProfile.update({
        where: { id },
        data: {
          ...dto,
          description: dto.description === undefined ? undefined : dto.description || null,
          scheduleExpression:
            dto.scheduleExpression === undefined ? undefined : dto.scheduleExpression || null,
        },
        include: { _count: { select: { runs: true } } },
      });

      await transaction.auditLog.create({
        data: {
          actorType: auditActorType(actor),
          actorId: actor.id,
          action: 'NETWORK_DISCOVERY_PROFILE_UPDATED',
          entityType: 'NetworkDiscoveryProfile',
          entityId: updated.id,
          before: this.profileAuditSnapshot(current),
          after: this.profileAuditSnapshot(updated),
        },
      });

      return updated;
    });
  }

  private profileAuditSnapshot(profile: {
    name: string;
    description: string | null;
    enabled: boolean;
    mode: string;
    allowedCidrs: string[];
    deniedCidrs: string[];
    rateLimitPerMinute: number;
    scheduleEnabled: boolean;
    scheduleExpression: string | null;
    methods: string[];
  }): Prisma.InputJsonObject {
    return {
      name: profile.name,
      description: profile.description,
      enabled: profile.enabled,
      mode: profile.mode,
      allowedCidrs: profile.allowedCidrs,
      deniedCidrs: profile.deniedCidrs,
      rateLimitPerMinute: profile.rateLimitPerMinute,
      scheduleEnabled: profile.scheduleEnabled,
      scheduleExpression: profile.scheduleExpression,
      methods: profile.methods,
    };
  }

  findRuns() {
    return this.prisma.networkDiscoveryRun.findMany({
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      include: {
        profile: { select: { id: true, name: true, mode: true } },
      },
    });
  }

  async findRun(id: string) {
    const run = await this.prisma.networkDiscoveryRun.findUnique({
      where: { id },
      include: {
        profile: true,
        results: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { asset: { select: { id: true, name: true, canonicalKey: true } } },
        },
      },
    });

    if (!run) throw new NotFoundException(`Network discovery run ${id} was not found.`);
    return run;
  }

  async runProfile(id: string, actor: CurrentActor) {
    const profile = await this.prisma.networkDiscoveryProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException(`Network discovery profile ${id} was not found.`);
    if (!profile.enabled) {
      await this.recordRejectedExecution(
        profile.id,
        'PROFILE_DISABLED',
        'O perfil está desabilitado.',
        actor,
      );
      throw new BadRequestException('Disabled network discovery profiles cannot be executed.');
    }

    let targets: string[];
    try {
      this.validateExecutionConfiguration(profile);
      targets = this.generateTargets(
        profile.allowedCidrs,
        profile.deniedCidrs,
        Math.min(profile.rateLimitPerMinute, MAX_SIMULATED_TARGETS_PER_RUN),
      );
      if (!targets.length) {
        throw new BadRequestException('The configured scope has no safe targets to simulate.');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        await this.recordRejectedExecution(
          profile.id,
          'INVALID_CONFIGURATION',
          error.message,
          actor,
        );
      }
      throw error;
    }

    const startedAt = new Date();
    const run = await this.prisma.networkDiscoveryRun.create({
      data: {
        profileId: profile.id,
        status: NetworkDiscoveryRunStatus.RUNNING,
        startedAt,
        totalTargets: targets.length,
        summary: {
          simulation: true,
          mode: profile.mode,
          methods: profile.methods,
          allowedCidrs: profile.allowedCidrs,
        },
      },
    });

    try {
      return await this.prisma.$transaction(async (transaction) => {
        let discoveredAssetCount = 0;
        let updatedAssetCount = 0;
        const affectedAssetIds = new Set<string>();

        for (const [index, ipAddress] of targets.entries()) {
          const observation = this.simulatedObservation(
            profile.id,
            ipAddress,
            profile.methods[index % profile.methods.length]!,
          );
          const processed = await this.processObservation(
            transaction,
            run.id,
            profile.id,
            observation,
          );
          affectedAssetIds.add(processed.assetId);
          if (processed.status === NetworkDiscoveryResultStatus.DISCOVERED) {
            discoveredAssetCount += 1;
          } else {
            updatedAssetCount += 1;
          }
        }

        const finishedAt = new Date();
        for (const assetId of affectedAssetIds) {
          await transaction.assetEvent.createMany({
            data: [
              {
                assetId,
                eventType: 'NETWORK_DISCOVERY_RUN_STARTED',
                title: 'Descoberta de rede iniciada',
                description: `Execução simulada do perfil ${profile.name} iniciada.`,
                data: { runId: run.id, profileId: profile.id, simulation: true },
                occurredAt: startedAt,
              },
              {
                assetId,
                eventType: 'NETWORK_DISCOVERY_RUN_FINISHED',
                title: 'Descoberta de rede concluída',
                description: `Execução simulada do perfil ${profile.name} concluída.`,
                data: { runId: run.id, profileId: profile.id, simulation: true },
                occurredAt: finishedAt,
              },
            ],
          });
        }

        const summary = {
          simulation: true,
          message: 'Descoberta leve simulada concluída sem tráfego real de rede.',
          totalTargets: targets.length,
          discoveredCount: targets.length,
          createdAssetCount: discoveredAssetCount,
          updatedAssetCount,
        };
        const completedRun = await transaction.networkDiscoveryRun.update({
          where: { id: run.id },
          data: {
            status: NetworkDiscoveryRunStatus.COMPLETED,
            finishedAt,
            discoveredCount: targets.length,
            createdAssetCount: discoveredAssetCount,
            updatedAssetCount,
            summary,
          },
          include: {
            profile: { select: { id: true, name: true, mode: true } },
            results: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: { asset: { select: { id: true, name: true, canonicalKey: true } } },
            },
          },
        });

        await transaction.auditLog.create({
          data: {
            actorType: auditActorType(actor),
            actorId: actor.id,
            action: 'NETWORK_DISCOVERY_RUN_EXECUTED',
            entityType: 'NetworkDiscoveryRun',
            entityId: run.id,
            after: { status: NetworkDiscoveryRunStatus.COMPLETED },
            metadata: {
              profileId: profile.id,
              profileName: profile.name,
              ...summary,
            },
            occurredAt: finishedAt,
          },
        });

        return completedRun;
      });
    } catch (error) {
      const finishedAt = new Date();
      const failureSummary = {
        simulation: true,
        errorCode: 'SIMULATION_FAILED',
        message: 'A execução simulada falhou e foi encerrada de forma controlada.',
      };

      await this.prisma.$transaction([
        this.prisma.networkDiscoveryRun.update({
          where: { id: run.id },
          data: {
            status: NetworkDiscoveryRunStatus.FAILED,
            finishedAt,
            errorCount: 1,
            summary: failureSummary,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            actorType: auditActorType(actor),
            actorId: actor.id,
            action: 'NETWORK_DISCOVERY_RUN_FAILED',
            entityType: 'NetworkDiscoveryRun',
            entityId: run.id,
            after: { status: NetworkDiscoveryRunStatus.FAILED },
            metadata: {
              profileId: profile.id,
              profileName: profile.name,
              errorType: error instanceof Error ? error.name : 'UnknownError',
              ...failureSummary,
            },
            occurredAt: finishedAt,
          },
        }),
      ]);

      throw new InternalServerErrorException({
        message: 'A execução simulada falhou. Consulte o histórico para mais detalhes.',
        runId: run.id,
      });
    }
  }

  private async processObservation(
    transaction: Prisma.TransactionClient,
    runId: string,
    profileId: string,
    observation: SimulatedObservation,
  ): Promise<{ assetId: string; status: NetworkDiscoveryResultStatus }> {
    const strongCandidates = await transaction.asset.findMany({
      where: {
        OR: [
          { name: { equals: observation.hostname, mode: 'insensitive' } },
          {
            networkInterfaces: {
              some: { macAddress: observation.macAddress },
            },
          },
        ],
      },
      select: { id: true },
      take: 2,
    });
    const ipOnlyCandidates = strongCandidates.length
      ? []
      : await transaction.asset.findMany({
          where: {
            networkInterfaces: {
              some: { ipAddresses: { has: observation.ipAddress }, macAddress: null },
            },
          },
          select: { id: true },
          take: 2,
        });
    const canonicalKey = `network-discovery:${profileId}:${observation.macAddress}`;
    const canonicalAsset = await transaction.asset.findUnique({
      where: { canonicalKey },
      select: { id: true },
    });
    const observedAt = new Date();
    const candidates = strongCandidates.length ? strongCandidates : ipOnlyCandidates;
    const matchedAssetId = candidates.length === 1 ? candidates[0]!.id : canonicalAsset?.id;
    const created = !matchedAssetId;
    const asset = matchedAssetId
      ? await transaction.asset.update({
          where: { id: matchedAssetId },
          data: {
            operationalStatus: OperationalStatus.SEEN_RECENTLY,
            lastSeenAt: observedAt,
            confidenceScore: observation.confidenceScore,
          },
        })
      : await transaction.asset.create({
          data: {
            canonicalKey,
            name: observation.hostname,
            kind:
              observation.method === NetworkDiscoveryMethod.ARP_SIMULATED
                ? 'NETWORK_DEVICE'
                : 'UNKNOWN',
            operationalStatus: OperationalStatus.SEEN_RECENTLY,
            confidenceScore: observation.confidenceScore,
            dataQualityScore: 65,
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
          },
        });

    const raw: Prisma.InputJsonObject = {
      simulation: true,
      ipAddress: observation.ipAddress,
      macAddress: observation.macAddress,
      hostname: observation.hostname,
      method: observation.method,
    };
    const evidence = await transaction.assetEvidence.create({
      data: {
        assetId: asset.id,
        source: 'network-discovery-lite',
        sourceRecordId: `${runId}:${observation.ipAddress}`,
        evidenceType: 'NETWORK_DISCOVERY',
        payload: raw,
        fingerprint: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
        confidenceScore: observation.confidenceScore,
        dataQualityScore: 65,
        observedAt,
      },
    });

    await this.reconcileObservedAttribute(
      transaction,
      asset.id,
      evidence.id,
      'hostname',
      observation.hostname,
      observation.confidenceScore,
      observedAt,
    );
    await this.reconcileNetworkInterface(
      transaction,
      asset.id,
      evidence.id,
      observation,
      observedAt,
    );
    await this.registerNetworkIdentityConflict(
      transaction,
      asset.id,
      evidence.id,
      observation,
      observedAt,
    );

    const status = created
      ? NetworkDiscoveryResultStatus.DISCOVERED
      : NetworkDiscoveryResultStatus.UPDATED;
    await transaction.networkDiscoveryResult.create({
      data: {
        runId,
        assetId: asset.id,
        ipAddress: observation.ipAddress,
        macAddress: observation.macAddress,
        hostname: observation.hostname,
        source: 'network-discovery-lite',
        method: observation.method,
        confidenceScore: observation.confidenceScore,
        status,
        raw,
      },
    });
    await transaction.assetEvent.create({
      data: {
        assetId: asset.id,
        evidenceId: evidence.id,
        eventType: 'NETWORK_DISCOVERY_ASSET_FOUND',
        title: 'Ativo encontrado pela descoberta de rede',
        description: `Observação simulada em ${observation.ipAddress}.`,
        data: { runId, profileId, method: observation.method, simulation: true },
        occurredAt: observedAt,
      },
    });

    return { assetId: asset.id, status };
  }

  private async reconcileObservedAttribute(
    transaction: Prisma.TransactionClient,
    assetId: string,
    evidenceId: string,
    key: string,
    value: string,
    confidenceScore: number,
    observedAt: Date,
  ): Promise<void> {
    const current = await transaction.assetAttribute.findFirst({
      where: { assetId, key, isCurrent: true },
    });
    if (current?.valueText === value) {
      await transaction.assetAttribute.update({
        where: { id: current.id },
        data: {
          evidenceId,
          lastConfirmedAt: observedAt,
          confirmationCount: { increment: 1 },
        },
      });
      return;
    }
    if (current) {
      await transaction.assetAttribute.update({
        where: { id: current.id },
        data: { isCurrent: false, validTo: observedAt },
      });
    }
    await transaction.assetAttribute.create({
      data: {
        assetId,
        evidenceId,
        key,
        value,
        valueText: value,
        valueType: AttributeValueType.STRING,
        confidenceScore,
        dataQualityScore: 65,
        observedAt,
        lastConfirmedAt: observedAt,
        validFrom: observedAt,
      },
    });
  }

  private async reconcileNetworkInterface(
    transaction: Prisma.TransactionClient,
    assetId: string,
    evidenceId: string,
    observation: SimulatedObservation,
    observedAt: Date,
  ): Promise<void> {
    const identityKey = `mac:${observation.macAddress}`;
    const current = await transaction.networkInterface.findFirst({
      where: { assetId, identityKey },
    });
    if (current) {
      await transaction.networkInterface.update({
        where: { id: current.id },
        data: {
          evidenceId,
          ipAddresses: [...new Set([...current.ipAddresses, observation.ipAddress])],
          isCurrent: true,
          observedAt,
          lastSeenAt: observedAt,
        },
      });
      return;
    }
    await transaction.networkInterface.create({
      data: {
        assetId,
        evidenceId,
        identityKey,
        name: `mac-${observation.macAddress.replaceAll(':', '')}`,
        macAddress: observation.macAddress,
        ipAddresses: [observation.ipAddress],
        isPrimary: true,
        isCurrent: true,
        observedAt,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
      },
    });
  }

  private async registerNetworkIdentityConflict(
    transaction: Prisma.TransactionClient,
    assetId: string,
    evidenceId: string,
    observation: SimulatedObservation,
    observedAt: Date,
  ): Promise<void> {
    const conflictingInterface = await transaction.networkInterface.findFirst({
      where: {
        assetId: { not: assetId },
        ipAddresses: { has: observation.ipAddress },
        macAddress: { not: observation.macAddress },
      },
      select: { macAddress: true },
    });
    if (!conflictingInterface?.macAddress) return;

    const attributeKey = `network.ip.${observation.ipAddress}`;
    const existing = await transaction.conflict.findFirst({
      where: {
        assetId,
        conflictType: NETWORK_CONFLICT_TYPE,
        attributeKey,
        status: ConflictStatus.OPEN,
      },
      select: { id: true },
    });
    if (existing) {
      await transaction.conflict.update({
        where: { id: existing.id },
        data: { lastDetectedAt: observedAt, occurrenceCount: { increment: 1 } },
      });
      return;
    }
    await transaction.conflict.create({
      data: {
        assetId,
        conflictType: NETWORK_CONFLICT_TYPE,
        attributeKey,
        status: ConflictStatus.OPEN,
        severity: 3,
        impact: 'HIGH',
        suggestionReason: 'O mesmo IP foi observado em endereços MAC diferentes.',
        detectedAt: observedAt,
        lastDetectedAt: observedAt,
        values: {
          create: [conflictingInterface.macAddress, observation.macAddress].map((macAddress) => ({
            evidenceId,
            value: { ipAddress: observation.ipAddress, macAddress },
            normalizedValue: macAddress,
            source: 'network-discovery-lite',
            confidenceScore: observation.confidenceScore,
            observedAt,
          })),
        },
      },
    });
  }

  private async recordRejectedExecution(
    profileId: string,
    reasonCode: string,
    reason: string,
    actor: CurrentActor,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: auditActorType(actor),
        actorId: actor.id,
        action: 'NETWORK_DISCOVERY_RUN_REJECTED',
        entityType: 'NetworkDiscoveryProfile',
        entityId: profileId,
        metadata: { profileId, reasonCode, reason, simulation: true },
      },
    });
  }

  private validateExecutionConfiguration(profile: {
    allowedCidrs: string[];
    rateLimitPerMinute: number;
    methods: NetworkDiscoveryMethod[];
    scheduleEnabled: boolean;
    scheduleExpression: string | null;
  }): void {
    this.validateScope(profile.allowedCidrs);
    if (profile.rateLimitPerMinute < 1 || profile.rateLimitPerMinute > 60) {
      throw new BadRequestException('The rate limit must be between 1 and 60 per minute.');
    }
    if (!profile.methods.length) {
      throw new BadRequestException('At least one simulated discovery method is required.');
    }
    if (profile.scheduleEnabled && !profile.scheduleExpression?.trim()) {
      throw new BadRequestException('scheduleExpression is required when scheduleEnabled is true.');
    }
  }

  private validateScope(allowedCidrs: string[]): void {
    if (!allowedCidrs.length)
      throw new BadRequestException('At least one allowed CIDR is required.');
    if (allowedCidrs.some((cidr) => !isIpv4Cidr(cidr))) {
      throw new BadRequestException('Each allowed CIDR must be a valid IPv4 CIDR.');
    }
    if (allowedCidrs.some((cidr) => cidr.trim() === '0.0.0.0/0')) {
      throw new BadRequestException('CIDR 0.0.0.0/0 is not allowed for network discovery.');
    }
    if (allowedCidrs.some((cidr) => !this.isPrivateCidr(cidr))) {
      throw new BadRequestException('No MVP, a descoberta de rede permite apenas CIDRs privados.');
    }
  }

  private isPrivateCidr(cidr: string): boolean {
    const candidate = this.cidrBounds(cidr);
    return ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some((privateCidr) => {
      const allowed = this.cidrBounds(privateCidr);
      return candidate.network >= allowed.network && candidate.broadcast <= allowed.broadcast;
    });
  }

  private generateTargets(allowedCidrs: string[], deniedCidrs: string[], limit: number): string[] {
    const targets: string[] = [];
    for (const cidr of allowedCidrs) {
      const { network, broadcast, prefix } = this.cidrBounds(cidr);
      const first = prefix <= 30 ? network + 1 : network;
      const last = prefix <= 30 ? broadcast - 1 : broadcast;
      const cappedLast = Math.min(last, first + 1023);
      for (let value = first; value <= cappedLast && targets.length < limit; value += 1) {
        const ipAddress = this.numberToIp(value);
        if (!deniedCidrs.some((denied) => this.ipInCidr(value, denied))) targets.push(ipAddress);
      }
      if (targets.length >= limit) break;
    }
    return [...new Set(targets)];
  }

  private simulatedObservation(
    profileId: string,
    ipAddress: string,
    method: NetworkDiscoveryMethod,
  ): SimulatedObservation {
    const digest = createHash('sha256').update(`${profileId}:${ipAddress}`).digest('hex');
    const macAddress = `02:${digest.slice(0, 2)}:${digest.slice(2, 4)}:${digest.slice(4, 6)}:${digest.slice(6, 8)}:${digest.slice(8, 10)}`;
    const confidenceByMethod: Record<NetworkDiscoveryMethod, number> = {
      ICMP_SIMULATED: 62,
      DNS_REVERSE_SIMULATED: 72,
      ARP_SIMULATED: 82,
    };

    return {
      ipAddress,
      macAddress,
      hostname: `ND-${ipAddress.replaceAll('.', '-')}`,
      method,
      confidenceScore: confidenceByMethod[method],
    };
  }

  private cidrBounds(cidr: string): { network: number; broadcast: number; prefix: number } {
    const [address, rawPrefix] = cidr.split('/');
    const prefix = Number(rawPrefix);
    const ip = this.ipToNumber(address!);
    const blockSize = 2 ** (32 - prefix);
    const network = Math.floor(ip / blockSize) * blockSize;
    return { network, broadcast: network + blockSize - 1, prefix };
  }

  private ipInCidr(ip: number, cidr: string): boolean {
    const { network, broadcast } = this.cidrBounds(cidr);
    return ip >= network && ip <= broadcast;
  }

  private ipToNumber(ipAddress: string): number {
    return ipAddress
      .split('.')
      .map(Number)
      .reduce((value, octet) => value * 256 + octet, 0);
  }

  private numberToIp(value: number): string {
    return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
  }
}
