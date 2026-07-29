-- Half-hour send-window granularity: minute offset (0 or 30) within the start/end hour.
-- Additive with defaults — existing rows keep whole-hour windows (:00).

-- AlterTable
ALTER TABLE "ProspectingRun" ADD COLUMN "sendMinutesStart" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sendMinutesEnd" INTEGER NOT NULL DEFAULT 0;
