-- Additive, idempotent. Marks the one axis per person that came from what the company is
-- doing now rather than from the job title.
ALTER TABLE "PersonAxis" ADD COLUMN IF NOT EXISTS "agenda" BOOLEAN NOT NULL DEFAULT false;
