-- AlterTable: raise the default daily connection-request cap from 8 to 15.
-- Only affects rows created without an explicit dailyCap; existing runs are unchanged.
ALTER TABLE "ProspectingRun" ALTER COLUMN "dailyCap" SET DEFAULT 15;
