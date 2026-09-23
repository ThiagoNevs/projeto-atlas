import { Inject, Injectable } from '@nestjs/common';

import { OperationalLogger } from './operational-context/operational-logger.service';
import { ConnectorExecutionService } from './connector-execution/connector-execution.service';
import { PrismaService } from './prisma/prisma.service';

export const HEALTH_READINESS_TIMEOUT_MS = Symbol('HEALTH_READINESS_TIMEOUT_MS');
export const DEFAULT_HEALTH_READINESS_TIMEOUT_MS = 2_000;

interface ProbeResult {
  readonly ready: boolean;
}

type ReadinessResult =
  { readonly source: 'probe'; readonly ready: boolean } | { readonly source: 'timeout' };

@Injectable()
export class HealthReadinessService {
  private inFlightProbe: Promise<ProbeResult> | undefined;
  private warningEmitted = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorExecution: ConnectorExecutionService,
    private readonly logger: OperationalLogger,
    @Inject(HEALTH_READINESS_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  async isReady(): Promise<boolean> {
    const probe = this.getOrStartProbe();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const timedOut = new Promise<ReadinessResult>((resolve) => {
      timeout = setTimeout(() => resolve({ source: 'timeout' }), this.timeoutMs);
      timeout.unref?.();
    });

    const result = await Promise.race([
      probe.then(({ ready }) => ({ source: 'probe' as const, ready })),
      timedOut,
    ]);
    if (timeout) clearTimeout(timeout);

    if (result.source === 'timeout') {
      this.warnOnce('HEALTH_READINESS_TIMEOUT', 'ReadinessTimeout');
      return false;
    }
    return result.ready;
  }

  private getOrStartProbe(): Promise<ProbeResult> {
    if (this.inFlightProbe) return this.inFlightProbe;

    this.warningEmitted = false;
    const probe = this.executeProbe()
      .then(() => ({ ready: true }))
      .catch(() => {
        this.warnOnce('POSTGRES_READINESS_FAILED', 'DatabaseProbeError');
        return { ready: false };
      })
      .finally(() => {
        if (this.inFlightProbe === probe) {
          this.inFlightProbe = undefined;
          this.warningEmitted = false;
        }
      });
    this.inFlightProbe = probe;
    return probe;
  }

  private async executeProbe(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
    if (!(await this.connectorExecution.isReady())) {
      throw new Error('ConnectorExecutionNotReady');
    }
  }

  private warnOnce(errorCode: string, errorType: string): void {
    if (this.warningEmitted) return;
    this.warningEmitted = true;
    this.logger.warn({
      event: 'health.readiness.failed',
      errorCode,
      errorType,
    });
  }
}
