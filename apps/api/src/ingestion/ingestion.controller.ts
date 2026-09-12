import { Body, Controller, Post } from '@nestjs/common';
import { CurrentActor as Actor } from '../auth/current-actor.decorator';
import type { CurrentActor } from '../auth/auth.types';

import { IngestAssetDto } from './dto/ingest-asset.dto';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('assets')
  ingestAsset(@Body() dto: IngestAssetDto, @Actor() actor: CurrentActor) {
    return this.ingestionService.ingestAsset(dto, actor);
  }
}
