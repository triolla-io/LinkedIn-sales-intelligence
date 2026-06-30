-- CreateEnum
CREATE TYPE "ProspectingEventType" AS ENUM ('DISCOVERED', 'SKIPPED', 'QUEUED', 'SCHEDULED', 'QUOTA_DEFERRED', 'SEND_ATTEMPT', 'SENT', 'FAILED', 'ALREADY_PENDING', 'ALREADY_CONNECTED', 'CHECKPOINT');

-- CreateTable
CREATE TABLE "ProspectingEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "connectionRequestId" TEXT,
    "type" "ProspectingEventType" NOT NULL,
    "message" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectingEvent_runId_createdAt_idx" ON "ProspectingEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectingEvent_connectionRequestId_idx" ON "ProspectingEvent"("connectionRequestId");

-- AddForeignKey
ALTER TABLE "ProspectingEvent" ADD CONSTRAINT "ProspectingEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
