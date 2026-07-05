import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { EvidencesService } from './evidences.service';

@Controller('assets')
export class EvidencesController {
  constructor(private readonly evidencesService: EvidencesService) {}

  @Get(':id/evidences')
  findByAsset(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.evidencesService.findByAsset(id);
  }
}
