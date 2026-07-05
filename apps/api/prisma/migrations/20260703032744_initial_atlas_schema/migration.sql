-- CreateEnum
CREATE TYPE "OperationalStatus" AS ENUM ('UNKNOWN', 'OPERATIONAL', 'DEGRADED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AdministrativeStatus" AS ENUM ('UNKNOWN', 'PLANNED', 'ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AttributeValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DATETIME', 'JSON');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "canonical_key" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "operational_status" "OperationalStatus" NOT NULL DEFAULT 'UNKNOWN',
    "administrative_status" "AdministrativeStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DECIMAL(5,4),
    "quality_score" DECIMAL(5,4),
    "first_seen_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_attributes" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "evidence_id" UUID,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "value_text" TEXT,
    "value_type" "AttributeValueType" NOT NULL DEFAULT 'JSON',
    "confidence" DECIMAL(5,4),
    "quality_score" DECIMAL(5,4),
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_evidence" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_record_id" TEXT,
    "evidence_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fingerprint" TEXT,
    "confidence" DECIMAL(5,4),
    "quality_score" DECIMAL(5,4),
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "asset_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "evidence_id" UUID,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "data" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_interfaces" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "evidence_id" UUID,
    "name" TEXT NOT NULL,
    "mac_address" TEXT,
    "ip_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interface_index" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "observed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "network_interfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflicts" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 1,
    "resolution_value" JSONB,
    "resolution_note" TEXT,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_values" (
    "id" UUID NOT NULL,
    "conflict_id" UUID NOT NULL,
    "evidence_id" UUID,
    "value" JSONB NOT NULL,
    "normalized_value" TEXT,
    "source" TEXT NOT NULL,
    "confidence" DECIMAL(5,4),
    "observed_at" TIMESTAMPTZ(3),
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "asset_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_canonical_key_key" ON "assets"("canonical_key");

-- CreateIndex
CREATE INDEX "assets_kind_idx" ON "assets"("kind");

-- CreateIndex
CREATE INDEX "assets_operational_status_idx" ON "assets"("operational_status");

-- CreateIndex
CREATE INDEX "assets_administrative_status_idx" ON "assets"("administrative_status");

-- CreateIndex
CREATE INDEX "assets_updated_at_idx" ON "assets"("updated_at");

-- CreateIndex
CREATE INDEX "asset_attributes_asset_id_key_is_current_idx" ON "asset_attributes"("asset_id", "key", "is_current");

-- CreateIndex
CREATE INDEX "asset_attributes_asset_id_observed_at_idx" ON "asset_attributes"("asset_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "asset_attributes_evidence_id_idx" ON "asset_attributes"("evidence_id");

-- CreateIndex
CREATE INDEX "asset_evidence_asset_id_observed_at_idx" ON "asset_evidence"("asset_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "asset_evidence_source_observed_at_idx" ON "asset_evidence"("source", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "asset_evidence_fingerprint_idx" ON "asset_evidence"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "asset_evidence_source_source_record_id_key" ON "asset_evidence"("source", "source_record_id");

-- CreateIndex
CREATE INDEX "asset_events_asset_id_occurred_at_idx" ON "asset_events"("asset_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "asset_events_event_type_occurred_at_idx" ON "asset_events"("event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "asset_events_evidence_id_idx" ON "asset_events"("evidence_id");

-- CreateIndex
CREATE INDEX "network_interfaces_asset_id_idx" ON "network_interfaces"("asset_id");

-- CreateIndex
CREATE INDEX "network_interfaces_mac_address_idx" ON "network_interfaces"("mac_address");

-- CreateIndex
CREATE INDEX "network_interfaces_ip_addresses_idx" ON "network_interfaces" USING GIN ("ip_addresses");

-- CreateIndex
CREATE INDEX "network_interfaces_evidence_id_idx" ON "network_interfaces"("evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "network_interfaces_asset_id_name_key" ON "network_interfaces"("asset_id", "name");

-- CreateIndex
CREATE INDEX "conflicts_asset_id_status_detected_at_idx" ON "conflicts"("asset_id", "status", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "conflicts_asset_id_attribute_key_idx" ON "conflicts"("asset_id", "attribute_key");

-- CreateIndex
CREATE INDEX "conflict_values_conflict_id_idx" ON "conflict_values"("conflict_id");

-- CreateIndex
CREATE INDEX "conflict_values_evidence_id_idx" ON "conflict_values"("evidence_id");

-- CreateIndex
CREATE INDEX "audit_logs_asset_id_occurred_at_idx" ON "audit_logs"("asset_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_occurred_at_idx" ON "audit_logs"("actor_type", "actor_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "asset_attributes" ADD CONSTRAINT "asset_attributes_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_attributes" ADD CONSTRAINT "asset_attributes_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "asset_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "asset_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_interfaces" ADD CONSTRAINT "network_interfaces_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_interfaces" ADD CONSTRAINT "network_interfaces_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "asset_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_values" ADD CONSTRAINT "conflict_values_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_values" ADD CONSTRAINT "conflict_values_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "asset_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
