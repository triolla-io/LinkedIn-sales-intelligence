
-- CreateEnum
CREATE TYPE "ProspectingTargetType" AS ENUM ('KEYWORDS', 'COMPANY');

-- CreateEnum
CREATE TYPE "CompanyTargetStatus" AS ENUM ('PENDING', 'RESOLVING', 'READY', 'SEARCHING', 'DONE', 'FAILED', 'REMOVED');

-- AlterEnum
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'RESOLVE_COMPANY';

-- AlterEnum
ALTER TYPE "ExtensionTaskStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "ProspectingEventType" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "ProspectingRun" ADD COLUMN     "targetType" "ProspectingTargetType" NOT NULL DEFAULT 'KEYWORDS';

-- AlterTable
ALTER TABLE "ConnectionRequest" ADD COLUMN     "companyTargetId" TEXT;

-- CreateTable
CREATE TABLE "ProspectingCompanyTarget" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHebrew" TEXT,
    "linkedinUrl" TEXT,
    "linkedinSlug" TEXT,
    "linkedinCompanyId" TEXT,
    "resolvedName" TEXT,
    "website" TEXT,
    "vertical" TEXT,
    "dedupKey" TEXT NOT NULL,
    "status" "CompanyTargetStatus" NOT NULL DEFAULT 'PENDING',
    "searchPage" INTEGER NOT NULL DEFAULT 1,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectingCompanyTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectingCompanyTarget_runId_status_idx" ON "ProspectingCompanyTarget"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectingCompanyTarget_runId_dedupKey_key" ON "ProspectingCompanyTarget"("runId", "dedupKey");

-- CreateIndex
CREATE INDEX "ConnectionRequest_companyTargetId_idx" ON "ConnectionRequest"("companyTargetId");

-- AddForeignKey
ALTER TABLE "ProspectingCompanyTarget" ADD CONSTRAINT "ProspectingCompanyTarget_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProspectingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionRequest" ADD CONSTRAINT "ConnectionRequest_companyTargetId_fkey" FOREIGN KEY ("companyTargetId") REFERENCES "ProspectingCompanyTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

