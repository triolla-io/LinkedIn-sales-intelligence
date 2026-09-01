-- The reject list of a radar run. Additive: a new table and its indexes only.
CREATE TABLE "RadarDropout" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contactId" TEXT,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shareworthy" DOUBLE PRECISION,
    "stature" DOUBLE PRECISION,
    "floor" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarDropout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RadarDropout_runId_floor_idx" ON "RadarDropout"("runId", "floor");
CREATE INDEX "RadarDropout_host_createdAt_idx" ON "RadarDropout"("host", "createdAt");
