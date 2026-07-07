import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';

import { AssetsService } from './assets.service';
import { CreateManualAssetDto } from './dto/create-manual-asset.dto';
import { ManualEnrichmentDto } from './dto/manual-enrichment.dto';
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

  @Post(':id/manual-enrichment')
  enrichManually(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: ManualEnrichmentDto,
  ) {
    return this.assetsService.enrichManually(id, payload);
  }

  @Post('manual')
  createManual(@Body() payload: CreateManualAssetDto) {
    return this.assetsService.createManual(payload);
  }
}
