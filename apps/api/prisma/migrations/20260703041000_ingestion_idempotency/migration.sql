-- Attribute confirmations preserve history without duplicating unchanged values.
ALTER TABLE "asset_attributes"
ADD COLUMN "last_confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "confirmation_count" INTEGER NOT NULL DEFAULT 1;

UPDATE "asset_attributes"
SET "last_confirmed_at" = "observed_at";

-- Network interfaces gain a stable identity and an explicit observation lifecycle.
ALTER TABLE "network_interfaces"
ADD COLUMN "identity_key" TEXT,
ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "network_interfaces"
SET
  "first_seen_at" = COALESCE("observed_at", "created_at"),
  "last_seen_at" = COALESCE("observed_at", "updated_at", "created_at");

WITH interface_identities AS (
  SELECT
    "id",
    "asset_id",
    CASE
      WHEN "mac_address" IS NOT NULL THEN 'mac:' || lower(replace("mac_address", '-', ':'))
      WHEN cardinality("ip_addresses") > 0 THEN 'ip:' || lower("ip_addresses"[1])
      ELSE 'legacy:' || "id"::text
    END AS base_key
  FROM "network_interfaces"
), ranked_identities AS (
  SELECT
    "id",
    base_key,
    row_number() OVER (PARTITION BY "asset_id", base_key ORDER BY "id") AS occurrence
  FROM interface_identities
)
UPDATE "network_interfaces" AS network_interface
SET "identity_key" = CASE
  WHEN ranked_identity.occurrence = 1 THEN ranked_identity.base_key
  ELSE ranked_identity.base_key || ':legacy:' || network_interface."id"::text
END
FROM ranked_identities AS ranked_identity
WHERE network_interface."id" = ranked_identity."id";

ALTER TABLE "network_interfaces"
ALTER COLUMN "identity_key" SET NOT NULL;

CREATE UNIQUE INDEX "network_interfaces_asset_id_identity_key_key"
ON "network_interfaces"("asset_id", "identity_key");

CREATE INDEX "network_interfaces_asset_id_is_current_idx"
ON "network_interfaces"("asset_id", "is_current");
