import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';

import { ConflictsService } from './conflicts.service';
import { QueryConflictsDto } from './dto/query-conflicts.dto';
import { UpdateConflictStatusDto } from './dto/update-conflict-status.dto';

@Controller('conflicts')
export class ConflictsController {
  constructor(private readonly conflictsService: ConflictsService) {}

  @Get()
  findAll(@Query() query: QueryConflictsDto) {
    return this.conflictsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.conflictsService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() payload: UpdateConflictStatusDto,
  ) {
    return this.conflictsService.updateStatus(id, payload);
  }
}
