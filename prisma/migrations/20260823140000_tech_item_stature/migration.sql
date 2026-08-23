-- Additive, idempotent. Weight, separate from relevance: a niche-tool write-up can be
-- squarely on-topic and still carry no gift.
ALTER TABLE "TechItem" ADD COLUMN IF NOT EXISTS "stature" DOUBLE PRECISION NOT NULL DEFAULT 0;
