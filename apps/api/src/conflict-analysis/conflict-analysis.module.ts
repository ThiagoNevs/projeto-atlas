import { Module } from '@nestjs/common';

import { ConflictAnalysisController } from './conflict-analysis.controller';
import { ConflictAnalysisPolicy } from './conflict-analysis.policy';
import { ConflictAnalysisService } from './conflict-analysis.service';

@Module({
  controllers: [ConflictAnalysisController],
  providers: [ConflictAnalysisPolicy, ConflictAnalysisService],
  exports: [ConflictAnalysisService],
})
export class ConflictAnalysisModule {}
