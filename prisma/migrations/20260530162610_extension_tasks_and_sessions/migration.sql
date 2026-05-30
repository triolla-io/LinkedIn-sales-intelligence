-- CreateEnum
CREATE TYPE "ExtensionTaskKind" AS ENUM ('SEND', 'CHECK_REPLY');

-- CreateEnum
CREATE TYPE "ExtensionTaskStatus" AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtensionAlertKind" AS ENUM ('OFFLINE', 'CHECKPOINT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecipientStatus" ADD VALUE 'QUEUED';
ALTER TYPE "RecipientStatus" ADD VALUE 'REPLIED';

-- CreateTable
CREATE TABLE "ExtensionTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ExtensionTaskKind" NOT NULL,
    "status" "ExtensionTaskStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "recipientId" TEXT,
    "sequenceExecutionId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ExtensionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ExtensionAlertKind" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ExtensionAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtensionTask_userId_status_scheduledFor_idx" ON "ExtensionTask"("userId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ExtensionTask_recipientId_idx" ON "ExtensionTask"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionSession_userId_key" ON "ExtensionSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionSession_tokenHash_key" ON "ExtensionSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ExtensionAlert_userId_resolvedAt_idx" ON "ExtensionAlert"("userId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "ExtensionTask" ADD CONSTRAINT "ExtensionTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionSession" ADD CONSTRAINT "ExtensionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionAlert" ADD CONSTRAINT "ExtensionAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
