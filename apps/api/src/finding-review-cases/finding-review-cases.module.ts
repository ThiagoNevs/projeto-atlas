import { Module } from '@nestjs/common';

import { ConflictAnalysisModule } from '../conflict-analysis/conflict-analysis.module';
import { FindingReviewCasesController } from './finding-review-cases.controller';
import { FindingReviewCasesFeature } from './finding-review-cases.feature';
import { FindingReviewCasesService } from './finding-review-cases.service';
import { FindingReviewDecisionsService } from './finding-review-decisions.service';
import { FindingReviewDecisionSupersessionsService } from './finding-review-decision-supersessions.service';
import { FindingReviewResolutionsService } from './finding-review-resolutions.service';
import { FindingReviewReopensService } from './finding-review-reopens.service';

@Module({
  imports: [ConflictAnalysisModule],
  controllers: [FindingReviewCasesController],
  providers: [
    FindingReviewCasesFeature,
    FindingReviewCasesService,
    FindingReviewDecisionsService,
    FindingReviewDecisionSupersessionsService,
    FindingReviewResolutionsService,
    FindingReviewReopensService,
  ],
})
export class FindingReviewCasesModule {}
