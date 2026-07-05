import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  findAll(@Query() query: QueryAuditLogsDto) {
    return this.auditLogsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.auditLogsService.findOne(id);
  }
}
