-- CreateEnum
CREATE TYPE "ConnectionRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IGNORED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ProspectingRunStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'SEARCH';
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'CONNECT';

-- AlterTable
ALTER TABLE "ExtensionTask" ADD COLUMN IF NOT EXISTS "prospectingRunId" TEXT;
ALTER TABLE "ExtensionTask" ADD COLUMN IF NOT EXISTS "connectionRequestId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProspectingRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ProspectingRunStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConnectionRequest" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT,
    "linkedinUrn" TEXT NOT NULL,
    "profileUrl" TEXT,
    "fullName" TEXT,
    "status" "ConnectionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProspectingRun_ownerId_status_idx" ON "ProspectingRun"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectionRequest_ownerId_linkedinUrn_key" ON "ConnectionRequest"("ownerId", "linkedinUrn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConnectionRequest_ownerId_status_idx" ON "ConnectionRequest"("ownerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConnectionRequest_runId_status_idx" ON "ConnectionRequest"("runId", "status");

-- AddForeignKey
ALTER TABLE "ProspectingRun" ADD CONSTRAINT "ProspectingRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionRequest" ADD CONSTRAINT "ConnectionRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionRequest" ADD CONSTRAINT "ConnectionRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
