import { Module } from '@nestjs/common';

import { EvidenceAnalysisService } from './evidence-analysis.service';
import { EvidenceEngineController } from './evidence-engine.controller';
import { EvidenceEngineService } from './evidence-engine.service';

@Module({
  controllers: [EvidenceEngineController],
  providers: [EvidenceEngineService, EvidenceAnalysisService],
  exports: [EvidenceEngineService, EvidenceAnalysisService],
})
export class EvidenceEngineModule {}
