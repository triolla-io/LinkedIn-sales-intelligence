-- CreateTable
CREATE TABLE "RadarScanRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "topical" INTEGER NOT NULL DEFAULT 0,
    "important" INTEGER NOT NULL DEFAULT 0,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "drafts" INTEGER NOT NULL DEFAULT 0,
    "vetoed" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "axisStats" JSONB,

    CONSTRAINT "RadarScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadarScanRun_orgId_startedAt_idx" ON "RadarScanRun"("orgId", "startedAt");

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "messageLanguage" TEXT NOT NULL DEFAULT 'he';

-- AlterTable
ALTER TABLE "PersonAxis" ADD COLUMN "mutedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ExtensionTask" ADD COLUMN "radarDraftId" TEXT;

-- AlterEnum
ALTER TYPE "RadarFeedbackEvent" ADD VALUE 'OVERRIDDEN';
