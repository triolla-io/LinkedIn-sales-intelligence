-- AlterTable: capture the search-card action button ("connect"/"follow"/"pending"/"message")
-- and a send priority (0 = normal, 1 = try last) so likely-unconnectable profiles are attempted
-- only after the clean Connect pool is exhausted.
ALTER TABLE "ConnectionRequest" ADD COLUMN "cardAction" TEXT;
ALTER TABLE "ConnectionRequest" ADD COLUMN "sendPriority" INTEGER NOT NULL DEFAULT 0;
