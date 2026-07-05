import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AssetsModule } from './assets/assets.module';
import { ConflictsModule } from './conflicts/conflicts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DataQualityModule } from './data-quality/data-quality.module';
import { EvidencesModule } from './evidences/evidences.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { NetworkDiscoveryModule } from './network-discovery/network-discovery.module';
import { PrismaModule } from './prisma/prisma.module';
import { TimelineModule } from './timeline/timeline.module';

@Module({
  imports: [
    PrismaModule,
    IngestionModule,
    AssetsModule,
    EvidencesModule,
    TimelineModule,
    ConflictsModule,
    NetworkDiscoveryModule,
    DashboardModule,
    AuditLogsModule,
    DataQualityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
