import { Controller, Get } from '@nestjs/common';

import { DataSourcesService } from './data-sources.service';

@Controller('data-sources')
export class DataSourcesController {
  constructor(private readonly dataSourcesService: DataSourcesService) {}

  @Get()
  findAll() {
    return this.dataSourcesService.findAll();
  }
}
