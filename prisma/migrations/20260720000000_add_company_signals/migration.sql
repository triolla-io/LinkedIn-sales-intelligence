-- CompanySignal / CompanySignalDraft feature
-- Hand-extracted from `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
-- (the full-diff/shadow-db approaches were not usable against the shared dev DB;
-- see task-1-report.md for details). Only new objects for this feature are included.

-- CreateEnum
CREATE TYPE "CompanySignalType" AS ENUM ('FUNDING', 'HIRING_GROWTH', 'OFFICE_MOVE', 'PRODUCT_LAUNCH', 'AWARD', 'MILESTONE', 'EXEC_HIRE');

-- CreateEnum
CREATE TYPE "CompanySignalStatus" AS ENUM ('DETECTED', 'VERIFIED', 'DRAFTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompanySignalDraftStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'SENT', 'DISMISSED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "companySignalsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "lastSignalCheckAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ExtensionTask" ADD COLUMN     "companySignalDraftId" TEXT;

-- CreateTable
CREATE TABLE "CompanySignal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "signalType" "CompanySignalType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sources" JSONB NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT NOT NULL,
    "status" "CompanySignalStatus" NOT NULL DEFAULT 'DETECTED',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySignalDraft" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "draftMessage" TEXT NOT NULL,
    "status" "CompanySignalDraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "channel" TEXT NOT NULL DEFAULT 'LINKEDIN',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySignalDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanySignal_status_idx" ON "CompanySignal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySignal_companyId_dedupeKey_key" ON "CompanySignal"("companyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "CompanySignalDraft_ownerId_status_idx" ON "CompanySignalDraft"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySignalDraft_signalId_contactId_key" ON "CompanySignalDraft"("signalId", "contactId");

-- AddForeignKey
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignalDraft" ADD CONSTRAINT "CompanySignalDraft_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "CompanySignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignalDraft" ADD CONSTRAINT "CompanySignalDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignalDraft" ADD CONSTRAINT "CompanySignalDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
