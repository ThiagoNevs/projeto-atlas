import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @RequirePermissions(ATLAS_PERMISSIONS.auditRead)
  findAll(@Query() query: QueryAuditLogsDto) {
    return this.auditLogsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(ATLAS_PERMISSIONS.auditRead)
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.auditLogsService.findOne(id);
  }
}
