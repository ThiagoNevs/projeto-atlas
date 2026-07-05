-- Extend the administrative lifecycle without removing legacy values.
ALTER TYPE "AdministrativeStatus" ADD VALUE IF NOT EXISTS 'IN_STOCK';
ALTER TYPE "AdministrativeStatus" ADD VALUE IF NOT EXISTS 'DEACTIVATED';
ALTER TYPE "AdministrativeStatus" ADD VALUE IF NOT EXISTS 'DISCARDED';
ALTER TYPE "AdministrativeStatus" ADD VALUE IF NOT EXISTS 'LOST';
ALTER TYPE "AdministrativeStatus" ADD VALUE IF NOT EXISTS 'STOLEN';
ALTER TYPE "AdministrativeStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
