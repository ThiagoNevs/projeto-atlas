import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { EvidencesService } from './evidences.service';

@Controller('assets')
export class EvidencesController {
  constructor(private readonly evidencesService: EvidencesService) {}

  @Get(':id/evidences')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  findByAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.evidencesService.findByAsset(id);
  }
}
