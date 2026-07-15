import { Module } from '@nestjs/common';

import { EvidenceAnalysisService } from './evidence-analysis.service';
import { EvidenceEngineController } from './evidence-engine.controller';
import { EvidenceEngineService } from './evidence-engine.service';
import { ShadowDecisionPolicy } from './shadow-decision.policy';

@Module({
  controllers: [EvidenceEngineController],
  providers: [ShadowDecisionPolicy, EvidenceEngineService, EvidenceAnalysisService],
  exports: [EvidenceEngineService, EvidenceAnalysisService],
})
export class EvidenceEngineModule {}
