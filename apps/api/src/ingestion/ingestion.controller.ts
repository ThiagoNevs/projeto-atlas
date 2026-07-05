import { Body, Controller, Post } from '@nestjs/common';

import { IngestAssetDto } from './dto/ingest-asset.dto';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('assets')
  ingestAsset(@Body() dto: IngestAssetDto) {
    return this.ingestionService.ingestAsset(dto);
  }
}
