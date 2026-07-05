import { Module } from '@nestjs/common';

import { DataQualityController } from './data-quality.controller';
import { DataQualityService } from './data-quality.service';

@Module({
  controllers: [DataQualityController],
  providers: [DataQualityService],
})
export class DataQualityModule {}
