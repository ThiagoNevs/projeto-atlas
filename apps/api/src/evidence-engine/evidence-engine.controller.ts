import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { EvidenceAnalysisService } from './evidence-analysis.service';

@Controller('assets')
export class EvidenceEngineController {
  constructor(private readonly evidenceAnalysis: EvidenceAnalysisService) {}

  @Get(':id/evidence-analysis')
  @RequirePermissions(ATLAS_PERMISSIONS.analysisRead)
  analyzeAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.evidenceAnalysis.analyzeAsset(id);
  }
}
