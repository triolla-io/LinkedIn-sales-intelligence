-- Users are Israel-based; nobody ever chose "UTC" — it was only the schema default
-- (there is no settings UI for timezone). Working-hours scheduling (prospecting
-- connects, sequence sends) reads this field, so UTC shifted the 9-18 window +3h
-- and used Mon-Fri workdays (Friday included) instead of Israel's Sun-Thu.
ALTER TABLE "User" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Jerusalem';
UPDATE "User" SET "timezone" = 'Asia/Jerusalem' WHERE "timezone" = 'UTC';

-- One-time repair: release the pending CONNECT that the old timezone + the
-- next-workday-start bug pinned to Friday 2026-07-03 09:00 UTC.
UPDATE "ExtensionTask"
SET "scheduledFor" = now()
WHERE "kind" = 'CONNECT'
  AND "status" = 'PENDING'
  AND "scheduledFor" = '2026-07-03 09:00:00+00';
