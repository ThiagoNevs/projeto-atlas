import { Controller, Get } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { DataSourcesService } from './data-sources.service';

@Controller('data-sources')
export class DataSourcesController {
  constructor(private readonly dataSourcesService: DataSourcesService) {}

  @Get()
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  findAll() {
    return this.dataSourcesService.findAll();
  }
}
