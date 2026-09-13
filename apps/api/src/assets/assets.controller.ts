import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { CurrentActor as Actor } from '../auth/current-actor.decorator';
import type { CurrentActor } from '../auth/auth.types';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { ASSET_IMPORT_MAX_FILE_BYTES } from './asset-import-parser.service';
import { AssetsService } from './assets.service';
import { CreateManualAssetDto } from './dto/create-manual-asset.dto';
import { ImportAssetsCsvDto } from './dto/import-assets-csv.dto';
import { ManualEnrichmentDto } from './dto/manual-enrichment.dto';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { UpdateAdministrativeStatusDto } from './dto/update-administrative-status.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  findAll(@Query() query: QueryAssetsDto) {
    return this.assetsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.assetsService.findOne(id);
  }

  @Patch(':id/administrative-status')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryStatusUpdate)
  updateAdministrativeStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: UpdateAdministrativeStatusDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.assetsService.updateAdministrativeStatus(id, payload, actor);
  }

  @Post(':id/manual-enrichment')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryMaintain)
  enrichManually(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: ManualEnrichmentDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.assetsService.enrichManually(id, payload, actor);
  }

  @Post('manual')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryMaintain)
  createManual(@Body() payload: CreateManualAssetDto, @Actor() actor: CurrentActor) {
    return this.assetsService.createManual(payload, actor);
  }

  @Post('import/csv')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryImport)
  importCsv(@Body() payload: ImportAssetsCsvDto, @Actor() actor: CurrentActor) {
    return this.assetsService.importCsv(payload, actor);
  }

  @Post('import/preview')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryImport)
  previewCsv(@Body() payload: ImportAssetsCsvDto) {
    return this.assetsService.previewCsv(payload);
  }

  @Post('import/commit')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryImport)
  commitCsv(@Body() payload: ImportAssetsCsvDto, @Actor() actor: CurrentActor) {
    return this.assetsService.commitCsv(payload, actor);
  }

  @Post('import/spreadsheet')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryImport)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES, files: 1 },
    }),
  )
  importSpreadsheet(@Actor() actor: CurrentActor, @UploadedFile() file?: Express.Multer.File) {
    return this.assetsService.importSpreadsheet(file, actor);
  }

  @Post('import/preview/spreadsheet')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryImport)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES, files: 1 },
    }),
  )
  previewSpreadsheet(@UploadedFile() file?: Express.Multer.File) {
    return this.assetsService.previewSpreadsheet(file);
  }

  @Post('import/commit/spreadsheet')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryImport)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES, files: 1 },
    }),
  )
  commitSpreadsheet(@Actor() actor: CurrentActor, @UploadedFile() file?: Express.Multer.File) {
    return this.assetsService.commitSpreadsheet(file, actor);
  }
}
