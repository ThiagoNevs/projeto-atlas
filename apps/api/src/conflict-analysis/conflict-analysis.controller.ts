import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { ConflictAnalysisService } from './conflict-analysis.service';

@Controller('assets')
export class ConflictAnalysisController {
  constructor(private readonly conflictAnalysis: ConflictAnalysisService) {}

  @Get(':id/conflict-analysis')
  analyzeAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.conflictAnalysis.analyzeAsset(id);
  }
}
