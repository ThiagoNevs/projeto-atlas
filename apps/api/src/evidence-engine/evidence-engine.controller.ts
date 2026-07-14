import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { EvidenceAnalysisService } from './evidence-analysis.service';

@Controller('assets')
export class EvidenceEngineController {
  constructor(private readonly evidenceAnalysis: EvidenceAnalysisService) {}

  @Get(':id/evidence-analysis')
  analyzeAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.evidenceAnalysis.analyzeAsset(id);
  }
}
