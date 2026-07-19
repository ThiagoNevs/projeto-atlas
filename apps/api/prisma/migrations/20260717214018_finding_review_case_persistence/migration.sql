-- CreateEnum
CREATE TYPE "FindingReviewCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'WAITING_FOR_EVIDENCE', 'RESOLVED', 'DISMISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FindingReviewStaleness" AS ENUM ('CURRENT', 'CHANGED', 'NO_LONGER_DETECTED', 'POLICY_VERSION_CHANGED', 'ASSET_UNAVAILABLE', 'REQUIRES_REFRESH');

-- CreateTable
CREATE TABLE "finding_review_cases" (
    "id" UUID NOT NULL,
    "finding_id" TEXT NOT NULL,
    "finding_type" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "review_subject_key" TEXT NOT NULL,
    "active_review_subject_key" TEXT,
    "creation_request_id" TEXT NOT NULL,
    "status" "FindingReviewCaseStatus" NOT NULL DEFAULT 'OPEN',
    "staleness" "FindingReviewStaleness" NOT NULL DEFAULT 'CURRENT',
    "original_snapshot" JSONB NOT NULL,
    "original_snapshot_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "finding_generated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "finding_review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_review_case_assets" (
    "case_id" UUID NOT NULL,
    "asset_id" UUID,
    "asset_id_at_creation" UUID NOT NULL,
    "asset_name_at_creation" TEXT,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_review_case_assets_pkey" PRIMARY KEY ("case_id","asset_id_at_creation")
);

-- CreateTable
CREATE TABLE "finding_review_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "version_before" INTEGER,
    "version_after" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "request_id" TEXT,
    "previous_status" "FindingReviewCaseStatus",
    "next_status" "FindingReviewCaseStatus",
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finding_review_cases_active_review_subject_key_key" ON "finding_review_cases"("active_review_subject_key");

-- CreateIndex
CREATE UNIQUE INDEX "finding_review_cases_creation_request_id_key" ON "finding_review_cases"("creation_request_id");

-- CreateIndex
CREATE INDEX "finding_review_cases_status_updated_at_idx" ON "finding_review_cases"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "finding_review_cases_staleness_updated_at_idx" ON "finding_review_cases"("staleness", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "finding_review_cases_finding_id_policy_version_idx" ON "finding_review_cases"("finding_id", "policy_version");

-- CreateIndex
CREATE INDEX "finding_review_cases_review_subject_key_idx" ON "finding_review_cases"("review_subject_key");

-- CreateIndex
CREATE INDEX "finding_review_cases_created_at_id_idx" ON "finding_review_cases"("created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "finding_review_case_assets_asset_id_idx" ON "finding_review_case_assets"("asset_id");

-- CreateIndex
CREATE INDEX "finding_review_events_case_id_occurred_at_id_idx" ON "finding_review_events"("case_id", "occurred_at" DESC, "id");

-- CreateIndex
CREATE INDEX "finding_review_events_actor_id_occurred_at_idx" ON "finding_review_events"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "finding_review_events_case_id_version_after_key" ON "finding_review_events"("case_id", "version_after");

-- CreateIndex
CREATE UNIQUE INDEX "finding_review_events_case_id_request_id_key" ON "finding_review_events"("case_id", "request_id");

-- AddForeignKey
ALTER TABLE "finding_review_case_assets" ADD CONSTRAINT "finding_review_case_assets_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "finding_review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_review_case_assets" ADD CONSTRAINT "finding_review_case_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_review_events" ADD CONSTRAINT "finding_review_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "finding_review_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
