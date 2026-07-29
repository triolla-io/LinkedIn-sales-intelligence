-- Half-hour granularity for sequence-step send windows: minute offset within the end hour.
-- Additive with default — existing steps keep whole-hour window ends (:00).

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN "sendMinuteEnd" INTEGER NOT NULL DEFAULT 0;
