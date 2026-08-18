-- Tech Radar: company-driven technology-opportunity radar.
--
-- Additive only. No existing table is reshaped and no data is rewritten; the
-- Fintech Radar tables (FintechArticle / ArticleMatch) are left untouched and
-- its module is simply gated off via Organization.fintechRadarEnabled.
--
-- The TechItem / TechOpportunity split is intentional: the shared write-up of a
-- technology is stored once, and only the per-company fit judgement multiplies
-- with the number of tracked companies.

-- CreateEnum
CREATE TYPE "CompanyRelationship" AS ENUM ('CUSTOMER', 'PROSPECT');

-- CreateEnum
CREATE TYPE "TrackedCompanyStatus" AS ENUM ('PENDING_RESEARCH', 'ACTIVE', 'RESEARCH_FAILED');

-- CreateEnum
CREATE TYPE "TechOpportunityStatus" AS ENUM ('DISCOVERED', 'DRAFTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TechDraftStatus" AS ENUM ('PENDING_REVIEW', 'PREPARED', 'SENT', 'DISMISSED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "techRadarEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TrackedCompany" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "website" TEXT,
    "relationship" "CompanyRelationship" NOT NULL DEFAULT 'PROSPECT',
    "companyId" TEXT,
    "profile" JSONB,
    "profileError" TEXT,
    "researchedAt" TIMESTAMP(3),
    "lastScanAt" TIMESTAMP(3),
    "scanIntervalDays" INTEGER NOT NULL DEFAULT 7,
    "status" "TrackedCompanyStatus" NOT NULL DEFAULT 'PENDING_RESEARCH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechItem" (
    "id" TEXT NOT NULL,
    "vendor" TEXT,
    "technology" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "thin" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechOpportunity" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "trackedCompanyId" TEXT NOT NULL,
    "fitRationale" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "TechOpportunityStatus" NOT NULL DEFAULT 'DISCOVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechOpportunityDraft" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "draftMessage" TEXT NOT NULL,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "whatsappMessage" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'LINKEDIN',
    "status" "TechDraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechOpportunityDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedCompany_orgId_name_key" ON "TrackedCompany"("orgId", "name");

-- CreateIndex
CREATE INDEX "TrackedCompany_status_idx" ON "TrackedCompany"("status");

-- CreateIndex
CREATE INDEX "TrackedCompany_orgId_status_idx" ON "TrackedCompany"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TechItem_dedupeKey_key" ON "TechItem"("dedupeKey");

-- CreateIndex
CREATE INDEX "TechItem_createdAt_idx" ON "TechItem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechOpportunity_trackedCompanyId_itemId_key" ON "TechOpportunity"("trackedCompanyId", "itemId");

-- CreateIndex
CREATE INDEX "TechOpportunity_trackedCompanyId_status_idx" ON "TechOpportunity"("trackedCompanyId", "status");

-- CreateIndex
CREATE INDEX "TechOpportunity_status_idx" ON "TechOpportunity"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TechOpportunityDraft_opportunityId_contactId_key" ON "TechOpportunityDraft"("opportunityId", "contactId");

-- CreateIndex
CREATE INDEX "TechOpportunityDraft_ownerId_status_idx" ON "TechOpportunityDraft"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "TrackedCompany" ADD CONSTRAINT "TrackedCompany_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedCompany" ADD CONSTRAINT "TrackedCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechOpportunity" ADD CONSTRAINT "TechOpportunity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "TechItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechOpportunity" ADD CONSTRAINT "TechOpportunity_trackedCompanyId_fkey" FOREIGN KEY ("trackedCompanyId") REFERENCES "TrackedCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechOpportunityDraft" ADD CONSTRAINT "TechOpportunityDraft_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "TechOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechOpportunityDraft" ADD CONSTRAINT "TechOpportunityDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechOpportunityDraft" ADD CONSTRAINT "TechOpportunityDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
