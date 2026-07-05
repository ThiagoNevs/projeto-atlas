import { Module } from '@nestjs/common';

import { ConflictsController } from './conflicts.controller';
import { ConflictsService } from './conflicts.service';

@Module({
  controllers: [ConflictsController],
  providers: [ConflictsService],
})
export class ConflictsModule {}
