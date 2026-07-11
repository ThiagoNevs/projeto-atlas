import { Controller, Get, Header, Query } from '@nestjs/common';

import { DataQualityService } from './data-quality.service';
import { QueryDataQualityAssetsDto } from './dto/query-data-quality-assets.dto';

@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly dataQualityService: DataQualityService) {}

  @Get('summary')
  summary() {
    return this.dataQualityService.getSummary();
  }

  @Get('assets')
  assets(@Query() query: QueryDataQualityAssetsDto) {
    return this.dataQualityService.findAssets(query);
  }

  @Get('assets/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="atlas-qualidade-dos-dados.csv"')
  exportAssets(@Query() query: QueryDataQualityAssetsDto) {
    return this.dataQualityService.exportAssets(query);
  }
}
