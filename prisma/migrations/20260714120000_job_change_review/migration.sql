CREATE TYPE "JobChangeStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'SENT', 'DISMISSED');
CREATE TYPE "JobChangeType" AS ENUM ('COMPANY_MOVE', 'PROMOTION', 'TITLE_CHANGE');

ALTER TABLE "ContactJobChange"
  ADD COLUMN "status" "JobChangeStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "changeType" "JobChangeType",
  ADD COLUMN "draftMessage" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3);

-- Rows from the exact-match era are mostly naming-variant false positives
-- (that's why the crons were paused). Retire them so the review page starts clean.
UPDATE "ContactJobChange" SET "status" = 'DISMISSED';

CREATE INDEX "ContactJobChange_status_idx" ON "ContactJobChange"("status");

ALTER TABLE "ExtensionTask" ADD COLUMN "jobChangeId" TEXT;
