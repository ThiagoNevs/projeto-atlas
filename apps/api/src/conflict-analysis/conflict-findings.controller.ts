import { Controller, Get, Query } from '@nestjs/common';

import { ConflictFindingsService } from './conflict-findings.service';
import { QueryConflictFindingsDto } from './dto/query-conflict-findings.dto';

@Controller('conflict-analysis')
export class ConflictFindingsController {
  constructor(private readonly findings: ConflictFindingsService) {}

  @Get('findings')
  findAll(@Query() query: QueryConflictFindingsDto) {
    return this.findings.findAll(query);
  }
}
