-- Gentle connect pacing: warm-up anchor + lower run-cap defaults

ALTER TABLE "User" ADD COLUMN "connectWarmupStartedAt" TIMESTAMP(3);

-- Backfill: existing senders are born mature — anchor = their first successful send.
UPDATE "User" u
SET "connectWarmupStartedAt" = s.first_sent
FROM (
  SELECT "ownerId", MIN("sentAt") AS first_sent
  FROM "ConnectionRequest"
  WHERE "status" = 'SENT' AND "sentAt" IS NOT NULL
  GROUP BY "ownerId"
) s
WHERE u."id" = s."ownerId";

ALTER TABLE "ProspectingRun" ALTER COLUMN "dailyCap" SET DEFAULT 12;
ALTER TABLE "ProspectingRun" ALTER COLUMN "weeklyCap" SET DEFAULT 60;
