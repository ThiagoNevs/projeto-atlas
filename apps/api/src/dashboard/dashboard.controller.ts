import { Controller, Get } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  getSummary() {
    return this.dashboardService.getSummary();
  }
}
