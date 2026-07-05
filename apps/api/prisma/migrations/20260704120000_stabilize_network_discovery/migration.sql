-- Preserve existing result data while aligning the status vocabulary.
ALTER TYPE "NetworkDiscoveryResultStatus" RENAME VALUE 'CREATED' TO 'DISCOVERED';

-- Extend the run lifecycle without modifying the original migration.
ALTER TYPE "NetworkDiscoveryRunStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'RUNNING';
ALTER TYPE "NetworkDiscoveryRunStatus" ADD VALUE IF NOT EXISTS 'CANCELLED' AFTER 'FAILED';
