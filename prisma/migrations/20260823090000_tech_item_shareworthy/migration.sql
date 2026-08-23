-- Additive, idempotent. Prod applies this via `prisma migrate deploy` at boot, and a
-- failed migration there crash-loops the app into a 502.
ALTER TABLE "TechItem" ADD COLUMN IF NOT EXISTS "shareworthy" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "TechItem" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'other';
