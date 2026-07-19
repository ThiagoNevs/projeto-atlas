-- DropIndex
DROP INDEX "finding_review_events_case_id_version_after_key";

-- CreateIndex
CREATE INDEX "finding_review_events_case_id_version_after_created_at_id_idx" ON "finding_review_events"("case_id", "version_after", "created_at", "id");
