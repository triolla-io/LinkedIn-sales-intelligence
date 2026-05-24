-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "enrichmentError" TEXT,
ADD COLUMN     "enrichmentLog" JSONB,
ADD COLUMN     "enrichmentRanAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PersonEnrichment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "linkedinUrlNormalized" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "companySize" INTEGER,
    "currentCompany" TEXT,
    "industry" TEXT,
    "rawResponse" JSONB,
    "enrichedByContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonEnrichment_orgId_idx" ON "PersonEnrichment"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonEnrichment_orgId_linkedinUrlNormalized_key" ON "PersonEnrichment"("orgId", "linkedinUrlNormalized");

-- AddForeignKey
ALTER TABLE "PersonEnrichment" ADD CONSTRAINT "PersonEnrichment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
