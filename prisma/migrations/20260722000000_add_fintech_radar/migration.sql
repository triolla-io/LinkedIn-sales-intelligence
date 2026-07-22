-- CreateEnum
CREATE TYPE "ArticleMatchStatus" AS ENUM ('SUGGESTED', 'DISMISSED', 'SENT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "fintechRadarEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FintechArticle" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mentionedCompanies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relevantRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FintechArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleMatch" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "draftMessage" TEXT,
    "status" "ArticleMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "sentChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FintechArticle_url_key" ON "FintechArticle"("url");
CREATE INDEX "FintechArticle_createdAt_idx" ON "FintechArticle"("createdAt");
CREATE UNIQUE INDEX "ArticleMatch_articleId_contactId_key" ON "ArticleMatch"("articleId", "contactId");
CREATE INDEX "ArticleMatch_ownerId_status_idx" ON "ArticleMatch"("ownerId", "status");
CREATE INDEX "ArticleMatch_ownerId_createdAt_idx" ON "ArticleMatch"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArticleMatch" ADD CONSTRAINT "ArticleMatch_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "FintechArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleMatch" ADD CONSTRAINT "ArticleMatch_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
