import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ATLAS_PERMISSIONS } from '../auth/permissions';
import { CurrentActor as Actor } from '../auth/current-actor.decorator';
import type { CurrentActor } from '../auth/auth.types';
import { RequirePermissions } from '../auth/require-permissions.decorator';

import { ConflictsService } from './conflicts.service';
import { QueryConflictsDto } from './dto/query-conflicts.dto';
import { UpdateConflictStatusDto } from './dto/update-conflict-status.dto';

@Controller('conflicts')
export class ConflictsController {
  constructor(private readonly conflictsService: ConflictsService) {}

  @Get()
  @RequirePermissions(ATLAS_PERMISSIONS.conflictRead)
  findAll(@Query() query: QueryConflictsDto) {
    return this.conflictsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(ATLAS_PERMISSIONS.conflictRead)
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.conflictsService.findOne(id);
  }

  @Patch(':id/status')
  @RequirePermissions(ATLAS_PERMISSIONS.conflictManage)
  updateStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: UpdateConflictStatusDto,
    @Actor() actor: CurrentActor,
  ) {
    return this.conflictsService.updateStatus(id, payload, actor);
  }
}
