import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';

import { AssetsService } from './assets.service';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { UpdateAdministrativeStatusDto } from './dto/update-administrative-status.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  findAll(@Query() query: QueryAssetsDto) {
    return this.assetsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.assetsService.findOne(id);
  }

  @Patch(':id/administrative-status')
  updateAdministrativeStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: UpdateAdministrativeStatusDto,
  ) {
    return this.assetsService.updateAdministrativeStatus(id, payload);
  }
}
