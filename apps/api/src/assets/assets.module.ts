import { Module } from '@nestjs/common';

import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetImportParserService } from './asset-import-parser.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, AssetImportParserService],
  exports: [AssetsService],
})
export class AssetsModule {}
