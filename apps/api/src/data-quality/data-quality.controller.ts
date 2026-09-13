import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentActor as Actor } from '../auth/current-actor.decorator';
import type { CurrentActor } from '../auth/auth.types';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { DataQualityService } from './data-quality.service';
import { QueryDataQualityAssetsDto } from './dto/query-data-quality-assets.dto';

@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly dataQualityService: DataQualityService) {}

  @Get('summary')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  summary() {
    return this.dataQualityService.getSummary();
  }

  @Get('assets')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  assets(@Query() query: QueryDataQualityAssetsDto) {
    return this.dataQualityService.findAssets(query);
  }

  @Get('assets/export')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryExport)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="atlas-qualidade-dos-dados.csv"')
  exportAssets(@Query() query: QueryDataQualityAssetsDto, @Actor() actor: CurrentActor) {
    return this.dataQualityService.exportAssets(query, actor);
  }
}
