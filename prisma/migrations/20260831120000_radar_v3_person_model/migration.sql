-- Radar v3, Phase A: the person model.
-- ADDITIVE ONLY. Prod runs `prisma migrate deploy` at boot and a failed migration
-- crash-loops the app, so nothing here drops or rewrites an existing column.

-- Deep profile scrape (extension 0.7.1): the person's own curated evidence.
ALTER TABLE "Contact" ADD COLUMN "skills" JSONB;
ALTER TABLE "Contact" ADD COLUMN "education" JSONB;

-- The two answers the old model never gave about the PERSON rather than the company.
ALTER TABLE "PersonProfile" ADD COLUMN "audience" JSONB;
ALTER TABLE "PersonProfile" ADD COLUMN "scope" JSONB;

-- Personal entity tags, and human corrections that survive a rebuild.
-- ADD VALUE inside migrate deploy's transaction is fine on PG >= 12 as long as the new
-- value is not USED in the same transaction — it is not.
ALTER TYPE "RadarAxisKind" ADD VALUE 'PERSON_ENTITY';
ALTER TYPE "RadarAxisSource" ADD VALUE 'PERSON_ENTITY';
ALTER TYPE "RadarAxisSource" ADD VALUE 'MANUAL';
