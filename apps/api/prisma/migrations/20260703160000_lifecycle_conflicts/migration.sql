ALTER TABLE "conflicts"
ADD COLUMN "conflict_type" TEXT NOT NULL DEFAULT 'ATTRIBUTE_CONFLICT',
ADD COLUMN "impact" TEXT,
ADD COLUMN "suggested_value" TEXT,
ADD COLUMN "suggestion_reason" TEXT,
ADD COLUMN "last_detected_at" TIMESTAMPTZ(3),
ADD COLUMN "occurrence_count" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "conflicts_asset_id_conflict_type_status_idx"
ON "conflicts"("asset_id", "conflict_type", "status");
