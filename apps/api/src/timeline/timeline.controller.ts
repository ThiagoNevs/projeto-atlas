import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { TimelineService } from './timeline.service';

@Controller('assets')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get(':id/timeline')
  @RequirePermissions(ATLAS_PERMISSIONS.inventoryRead)
  findByAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.timelineService.findByAsset(id);
  }
}
