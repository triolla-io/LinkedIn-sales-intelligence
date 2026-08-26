ALTER TYPE "RadarAxisKind" ADD VALUE 'INDUSTRY';
ALTER TYPE "RadarAxisSource" ADD VALUE 'INDUSTRY';
ALTER TABLE "PersonProfile" ADD COLUMN "domains" JSONB;
ALTER TABLE "PersonAxis" ADD COLUMN "evidence" JSONB;
ALTER TABLE "RadarDraft" ADD COLUMN "pilotHeldAt" TIMESTAMP(3);
CREATE TABLE "NewsQueryCache" (
    "id" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsQueryCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsQueryCache_queryKey_key" ON "NewsQueryCache"("queryKey");
CREATE INDEX "NewsQueryCache_fetchedAt_idx" ON "NewsQueryCache"("fetchedAt");
