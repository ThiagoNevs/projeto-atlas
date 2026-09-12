import { Controller, Get } from '@nestjs/common';

import { Public } from './auth/public.decorator';
import type { HealthStatus } from '@atlas/shared';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check(): HealthStatus {
    return {
      service: 'atlas-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
