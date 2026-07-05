import { Module } from '@nestjs/common';

import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';

@Module({
  controllers: [TimelineController],
  providers: [TimelineService],
})
export class TimelineModule {}
