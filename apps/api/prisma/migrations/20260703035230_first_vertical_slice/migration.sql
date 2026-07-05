/*
  Warnings:

  - You are about to alter the column `confidence` on the `asset_attributes` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.
  - You are about to alter the column `quality_score` on the `asset_attributes` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.
  - You are about to alter the column `confidence` on the `asset_evidence` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.
  - You are about to alter the column `quality_score` on the `asset_evidence` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.
  - You are about to alter the column `confidence` on the `assets` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.
  - You are about to alter the column `quality_score` on the `assets` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.
  - You are about to alter the column `confidence` on the `conflict_values` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.

*/
-- AlterEnum
ALTER TYPE "AdministrativeStatus" ADD VALUE 'IN_USE';

-- AlterEnum
ALTER TYPE "OperationalStatus" ADD VALUE 'SEEN_RECENTLY';

-- DropIndex
DROP INDEX "asset_evidence_source_source_record_id_key";

-- AlterTable
ALTER TABLE "asset_attributes" ALTER COLUMN "confidence" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "quality_score" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "asset_evidence" ALTER COLUMN "confidence" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "quality_score" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "assets" ALTER COLUMN "administrative_status" SET DEFAULT 'IN_USE',
ALTER COLUMN "confidence" SET DATA TYPE DECIMAL(5,2),
ALTER COLUMN "quality_score" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "conflict_values" ALTER COLUMN "confidence" SET DATA TYPE DECIMAL(5,2);

-- CreateIndex
CREATE INDEX "asset_evidence_source_source_record_id_idx" ON "asset_evidence"("source", "source_record_id");

-- Score constraints (0 to 100)
ALTER TABLE "assets"
ADD CONSTRAINT "assets_confidence_score_check" CHECK ("confidence" BETWEEN 0 AND 100),
ADD CONSTRAINT "assets_data_quality_score_check" CHECK ("quality_score" BETWEEN 0 AND 100);

ALTER TABLE "asset_attributes"
ADD CONSTRAINT "asset_attributes_confidence_score_check" CHECK ("confidence" BETWEEN 0 AND 100),
ADD CONSTRAINT "asset_attributes_data_quality_score_check" CHECK ("quality_score" BETWEEN 0 AND 100);

ALTER TABLE "asset_evidence"
ADD CONSTRAINT "asset_evidence_confidence_score_check" CHECK ("confidence" BETWEEN 0 AND 100),
ADD CONSTRAINT "asset_evidence_data_quality_score_check" CHECK ("quality_score" BETWEEN 0 AND 100);

ALTER TABLE "conflict_values"
ADD CONSTRAINT "conflict_values_confidence_score_check" CHECK ("confidence" BETWEEN 0 AND 100);
