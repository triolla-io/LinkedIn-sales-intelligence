-- CreateEnum
CREATE TYPE "RadarAxisKind" AS ENUM ('ROLE_COMPANY', 'COMPANY_MONITOR');

-- CreateEnum
CREATE TYPE "RadarAxisStatus" AS ENUM ('ACTIVE', 'MERGED', 'TOO_BROAD', 'RETIRED');

-- CreateEnum
CREATE TYPE "RadarAxisSource" AS ENUM ('ROLE_COMPANY', 'COMPANY_MONITOR');

-- CreateEnum
CREATE TYPE "RadarDraftStatus" AS ENUM ('PENDING_REVIEW', 'PREPARING', 'PREPARED', 'SENT', 'DISMISSED', 'VETOED');

-- CreateEnum
CREATE TYPE "RadarFeedbackEvent" AS ENUM ('SENT', 'EDITED', 'DISCARDED');

-- CreateTable
CREATE TABLE "RadarAxis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "RadarAxisKind" NOT NULL,
    "searchQueries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "subscriberCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RadarAxisStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" TEXT,
    "trackedCompanyId" TEXT,
    "medianShareworthy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarAxis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonProfile" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "roleLens" TEXT NOT NULL,
    "employerTrackedCompanyId" TEXT,
    "personalNotes" TEXT,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonAxis" (
    "id" TEXT NOT NULL,
    "personProfileId" TEXT NOT NULL,
    "axisId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rationale" TEXT NOT NULL,
    "source" "RadarAxisSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonAxis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AxisMatch" (
    "id" TEXT NOT NULL,
    "axisId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AxisMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarDraft" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "axisId" TEXT,
    "ownerId" TEXT NOT NULL,
    "draftMessage" TEXT,
    "whyHim" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceParts" JSONB,
    "status" "RadarDraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "discardReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadarDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarFeedback" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "event" "RadarFeedbackEvent" NOT NULL,
    "reason" TEXT,
    "draftBefore" TEXT,
    "sentAfter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarDomain" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "penalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discards" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RadarDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RadarAxis_orgId_status_idx" ON "RadarAxis"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RadarAxis_orgId_key_key" ON "RadarAxis"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PersonProfile_contactId_key" ON "PersonProfile"("contactId");

-- CreateIndex
CREATE INDEX "PersonProfile_employerTrackedCompanyId_idx" ON "PersonProfile"("employerTrackedCompanyId");

-- CreateIndex
CREATE INDEX "PersonAxis_axisId_idx" ON "PersonAxis"("axisId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonAxis_personProfileId_axisId_key" ON "PersonAxis"("personProfileId", "axisId");

-- CreateIndex
CREATE INDEX "AxisMatch_itemId_idx" ON "AxisMatch"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AxisMatch_axisId_itemId_key" ON "AxisMatch"("axisId", "itemId");

-- CreateIndex
CREATE INDEX "RadarDraft_ownerId_status_idx" ON "RadarDraft"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RadarDraft_contactId_itemId_key" ON "RadarDraft"("contactId", "itemId");

-- CreateIndex
CREATE INDEX "RadarFeedback_draftId_idx" ON "RadarFeedback"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "RadarDomain_orgId_domain_key" ON "RadarDomain"("orgId", "domain");

-- AddForeignKey
ALTER TABLE "RadarAxis" ADD CONSTRAINT "RadarAxis_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarAxis" ADD CONSTRAINT "RadarAxis_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "RadarAxis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAxis" ADD CONSTRAINT "PersonAxis_personProfileId_fkey" FOREIGN KEY ("personProfileId") REFERENCES "PersonProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAxis" ADD CONSTRAINT "PersonAxis_axisId_fkey" FOREIGN KEY ("axisId") REFERENCES "RadarAxis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AxisMatch" ADD CONSTRAINT "AxisMatch_axisId_fkey" FOREIGN KEY ("axisId") REFERENCES "RadarAxis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AxisMatch" ADD CONSTRAINT "AxisMatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "TechItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarDraft" ADD CONSTRAINT "RadarDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarDraft" ADD CONSTRAINT "RadarDraft_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "TechItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarDraft" ADD CONSTRAINT "RadarDraft_axisId_fkey" FOREIGN KEY ("axisId") REFERENCES "RadarAxis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarDraft" ADD CONSTRAINT "RadarDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

