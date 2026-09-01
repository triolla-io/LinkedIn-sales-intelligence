-- Radar v3, Phase B: per-industry source packs, item tags, and the learning loop's handle.
-- ADDITIVE ONLY. Prod runs `prisma migrate deploy` at boot and a failed migration
-- crash-loops the app into a 502, so nothing here drops, renames or rewrites anything.

-- The fixed 10 global + 10 Israeli outlets per industry, plus that industry's closed tag
-- vocabulary. A table rather than a code constant because a human edits the list in the
-- UI; the pull itself is free RSS, which is what lifts the relevance ceiling that three
-- exhausted paid providers imposed on 2026-08-31.
CREATE TABLE "RadarSourcePack" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "industryKey" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "taxonomy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarSourcePack_pkey" PRIMARY KEY ("id")
);

-- One pack per (org, industry). NULL orgId means "built-in", and Postgres counts NULLs as
-- distinct here, so this does not constrain the built-in rows — resolution handles that.
CREATE UNIQUE INDEX "RadarSourcePack_orgId_industryKey_key" ON "RadarSourcePack"("orgId", "industryKey");
CREATE INDEX "RadarSourcePack_industryKey_idx" ON "RadarSourcePack"("industryKey");

-- Closed-taxonomy tags attached by triage. Kept apart from `categories`, which the company
-- path still reads: person matching is tag OVERLAP, and free text loses on synonyms.
ALTER TABLE "TechItem" ADD COLUMN "industryTags" TEXT[] DEFAULT '{}';

-- Nullable on purpose: nothing reads it yet, and NULL must mean "never tuned" rather than
-- "weight zero", which is the difference between an untouched axis and a suppressed one.
ALTER TABLE "RadarAxis" ADD COLUMN "tagWeight" DOUBLE PRECISION;
