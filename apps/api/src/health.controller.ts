import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@atlas/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      service: 'atlas-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
