import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { ConflictAnalysisService } from './conflict-analysis.service';

@Controller('assets')
export class ConflictAnalysisController {
  constructor(private readonly conflictAnalysis: ConflictAnalysisService) {}

  @Get(':id/conflict-analysis')
  @RequirePermissions(ATLAS_PERMISSIONS.analysisRead)
  analyzeAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.conflictAnalysis.analyzeAsset(id);
  }
}
