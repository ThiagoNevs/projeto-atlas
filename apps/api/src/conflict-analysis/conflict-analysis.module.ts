import { Module } from '@nestjs/common';

import { ConflictAnalysisController } from './conflict-analysis.controller';
import { ConflictAnalysisPolicy } from './conflict-analysis.policy';
import { ConflictAnalysisService } from './conflict-analysis.service';
import { ConflictFindingsController } from './conflict-findings.controller';
import { ConflictFindingsInventoryBuilder } from './conflict-findings-inventory.builder';
import { ConflictFindingsService } from './conflict-findings.service';

@Module({
  controllers: [ConflictAnalysisController, ConflictFindingsController],
  providers: [
    ConflictAnalysisPolicy,
    ConflictAnalysisService,
    ConflictFindingsInventoryBuilder,
    ConflictFindingsService,
  ],
  exports: [ConflictAnalysisService],
})
export class ConflictAnalysisModule {}
