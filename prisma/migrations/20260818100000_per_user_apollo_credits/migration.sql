-- Per-user Apollo credit caps. The org-wide monthly pool (EnrichmentSpend +
-- Organization.monthlyApolloBudget) is left untouched and stays the outer
-- ceiling; this adds an inner per-user quota so a single user cannot drain it.
-- Additive only: no existing table is reshaped, no data is rewritten.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "perUserMonthlyApolloCredits" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "UserEnrichmentSpend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserEnrichmentSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEnrichmentSpend_userId_month_key" ON "UserEnrichmentSpend"("userId", "month");

-- CreateIndex
CREATE INDEX "UserEnrichmentSpend_orgId_month_idx" ON "UserEnrichmentSpend"("orgId", "month");

-- AddForeignKey
ALTER TABLE "UserEnrichmentSpend" ADD CONSTRAINT "UserEnrichmentSpend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
