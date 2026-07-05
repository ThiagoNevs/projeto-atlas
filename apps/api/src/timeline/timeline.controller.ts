import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { TimelineService } from './timeline.service';

@Controller('assets')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get(':id/timeline')
  findByAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.timelineService.findByAsset(id);
  }
}
