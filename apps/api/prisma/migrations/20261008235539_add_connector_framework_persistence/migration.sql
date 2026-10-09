-- CreateEnum
CREATE TYPE "ConnectorRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConnectorRunTrigger" AS ENUM ('REQUESTED', 'SCHEDULE', 'INTERNAL');

-- AlterTable
ALTER TABLE "asset_evidence" ADD COLUMN     "connector_observation_key" CHAR(64),
ADD COLUMN     "connector_run_id" UUID;

-- CreateTable
CREATE TABLE "connector_instances" (
    "id" UUID NOT NULL,
    "connector_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configuration_version" INTEGER NOT NULL DEFAULT 1,
    "configuration" JSONB NOT NULL,
    "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_expression" TEXT,
    "schedule_time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connector_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_secret_references" (
    "connector_instance_id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "provider_kind" TEXT NOT NULL,
    "logical_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connector_secret_references_pkey" PRIMARY KEY ("connector_instance_id","slot")
);

-- CreateTable
CREATE TABLE "connector_runs" (
    "id" UUID NOT NULL,
    "connector_instance_id" UUID NOT NULL,
    "status" "ConnectorRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" "ConnectorRunTrigger" NOT NULL,
    "trigger_actor_type" TEXT NOT NULL,
    "trigger_actor_id" TEXT NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "observed_count" INTEGER NOT NULL DEFAULT 0,
    "ingested_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connector_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_instances_connector_type_enabled_idx" ON "connector_instances"("connector_type", "enabled");

-- CreateIndex
CREATE INDEX "connector_instances_enabled_updated_at_idx" ON "connector_instances"("enabled", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "connector_runs_request_fingerprint_key" ON "connector_runs"("request_fingerprint");

-- CreateIndex
CREATE INDEX "connector_runs_connector_instance_id_created_at_idx" ON "connector_runs"("connector_instance_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "connector_runs_status_created_at_idx" ON "connector_runs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "connector_runs_trigger_actor_type_trigger_actor_id_created__idx" ON "connector_runs"("trigger_actor_type", "trigger_actor_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "asset_evidence_connector_observation_key_key" ON "asset_evidence"("connector_observation_key");

-- CreateIndex
CREATE INDEX "asset_evidence_connector_run_id_observed_at_idx" ON "asset_evidence"("connector_run_id", "observed_at" DESC);

-- AddForeignKey
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_connector_run_id_fkey" FOREIGN KEY ("connector_run_id") REFERENCES "connector_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_secret_references" ADD CONSTRAINT "connector_secret_references_connector_instance_id_fkey" FOREIGN KEY ("connector_instance_id") REFERENCES "connector_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_connector_instance_id_fkey" FOREIGN KEY ("connector_instance_id") REFERENCES "connector_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
