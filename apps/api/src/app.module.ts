import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AssetsModule } from './assets/assets.module';
import { ConflictsModule } from './conflicts/conflicts.module';
import { ConflictAnalysisModule } from './conflict-analysis/conflict-analysis.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DataQualityModule } from './data-quality/data-quality.module';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { EvidencesModule } from './evidences/evidences.module';
import { EvidenceEngineModule } from './evidence-engine/evidence-engine.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { FindingReviewCasesModule } from './finding-review-cases/finding-review-cases.module';
import { NetworkDiscoveryModule } from './network-discovery/network-discovery.module';
import { PrismaModule } from './prisma/prisma.module';
import { TimelineModule } from './timeline/timeline.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    IngestionModule,
    AssetsModule,
    EvidencesModule,
    EvidenceEngineModule,
    TimelineModule,
    ConflictsModule,
    ConflictAnalysisModule,
    FindingReviewCasesModule,
    NetworkDiscoveryModule,
    DashboardModule,
    AuditLogsModule,
    DataQualityModule,
    DataSourcesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
