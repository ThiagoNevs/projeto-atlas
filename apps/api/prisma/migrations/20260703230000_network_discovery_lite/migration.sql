-- CreateEnum
CREATE TYPE "NetworkDiscoveryMode" AS ENUM ('PASSIVE', 'LIGHT', 'CONTROLLED');

-- CreateEnum
CREATE TYPE "NetworkDiscoveryMethod" AS ENUM ('ICMP_SIMULATED', 'DNS_REVERSE_SIMULATED', 'ARP_SIMULATED');

-- CreateEnum
CREATE TYPE "NetworkDiscoveryRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NetworkDiscoveryResultStatus" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "network_discovery_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "NetworkDiscoveryMode" NOT NULL,
    "allowed_cidrs" TEXT[] NOT NULL,
    "denied_cidrs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL,
    "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_expression" TEXT,
    "methods" "NetworkDiscoveryMethod"[] NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "network_discovery_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_discovery_runs" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "status" "NetworkDiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "total_targets" INTEGER NOT NULL DEFAULT 0,
    "discovered_count" INTEGER NOT NULL DEFAULT 0,
    "updated_asset_count" INTEGER NOT NULL DEFAULT 0,
    "created_asset_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "network_discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_discovery_results" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "asset_id" UUID,
    "ip_address" TEXT NOT NULL,
    "mac_address" TEXT,
    "hostname" TEXT,
    "source" TEXT NOT NULL,
    "method" "NetworkDiscoveryMethod" NOT NULL,
    "confidence" DECIMAL(5,2),
    "status" "NetworkDiscoveryResultStatus" NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_discovery_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_discovery_profiles_enabled_updated_at_idx" ON "network_discovery_profiles"("enabled", "updated_at" DESC);
CREATE INDEX "network_discovery_runs_profile_id_started_at_idx" ON "network_discovery_runs"("profile_id", "started_at" DESC);
CREATE INDEX "network_discovery_runs_status_started_at_idx" ON "network_discovery_runs"("status", "started_at" DESC);
CREATE INDEX "network_discovery_results_run_id_created_at_idx" ON "network_discovery_results"("run_id", "created_at");
CREATE INDEX "network_discovery_results_asset_id_idx" ON "network_discovery_results"("asset_id");
CREATE INDEX "network_discovery_results_ip_address_idx" ON "network_discovery_results"("ip_address");
CREATE INDEX "network_discovery_results_mac_address_idx" ON "network_discovery_results"("mac_address");

-- AddForeignKey
ALTER TABLE "network_discovery_runs" ADD CONSTRAINT "network_discovery_runs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "network_discovery_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "network_discovery_results" ADD CONSTRAINT "network_discovery_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "network_discovery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "network_discovery_results" ADD CONSTRAINT "network_discovery_results_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
