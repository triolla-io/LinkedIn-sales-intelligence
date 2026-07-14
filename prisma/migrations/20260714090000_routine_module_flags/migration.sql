-- AlterTable: per-user master switch for the Routine connections module.
-- OFF = effective pause: tick/scheduler skip the user's runs; run statuses are never mutated.
ALTER TABLE "User" ADD COLUMN "routineConnectionsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: per-org opt-in for automatic job-change checks.
-- Preference only while the job-check crons are disabled in code; ticks will filter by it once re-enabled.
ALTER TABLE "Organization" ADD COLUMN "jobCheckEnabled" BOOLEAN NOT NULL DEFAULT false;
