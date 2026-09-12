import { Controller, Get, Query } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { ConflictFindingsService } from './conflict-findings.service';
import { QueryConflictFindingsDto } from './dto/query-conflict-findings.dto';

@Controller('conflict-analysis')
export class ConflictFindingsController {
  constructor(private readonly findings: ConflictFindingsService) {}

  @Get('findings')
  @RequirePermissions(ATLAS_PERMISSIONS.analysisRead)
  findAll(@Query() query: QueryConflictFindingsDto) {
    return this.findings.findAll(query);
  }
}
