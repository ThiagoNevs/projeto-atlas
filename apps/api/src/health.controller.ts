import { Controller, Get, Res } from '@nestjs/common';

import { Public } from './auth/public.decorator';
import { HealthReadinessService } from './health-readiness.service';
import type { HealthStatus } from '@atlas/shared';

interface HealthResponse {
  status(code: number): this;
}

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: HealthReadinessService) {}

  @Get()
  @Public()
  check(): HealthStatus {
    return {
      service: 'atlas-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  @Public()
  checkLive(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  async checkReady(
    @Res({ passthrough: true }) response: HealthResponse,
  ): Promise<{ status: 'ready' | 'not_ready' }> {
    const ready = await this.readiness.isReady();
    if (!ready) {
      response.status(503);
      return { status: 'not_ready' };
    }
    return { status: 'ready' };
  }
}
