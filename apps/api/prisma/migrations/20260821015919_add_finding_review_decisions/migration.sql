-- CreateEnum
CREATE TYPE "FindingReviewIdentityConclusion" AS ENUM ('SAME_ASSET', 'DIFFERENT_ASSETS');

-- CreateTable
CREATE TABLE "finding_review_decisions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "identity_conclusion" "FindingReviewIdentityConclusion" NOT NULL,
    "justification" TEXT NOT NULL,
    "case_version" INTEGER NOT NULL,
    "created_by" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finding_review_decisions_request_fingerprint_key" ON "finding_review_decisions"("request_fingerprint");

-- CreateIndex
CREATE INDEX "finding_review_decisions_case_id_created_at_idx" ON "finding_review_decisions"("case_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "finding_review_decisions_case_id_case_version_key" ON "finding_review_decisions"("case_id", "case_version");

-- AddForeignKey
ALTER TABLE "finding_review_decisions" ADD CONSTRAINT "finding_review_decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "finding_review_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
