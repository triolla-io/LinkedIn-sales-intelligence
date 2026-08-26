-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "about" TEXT;
ALTER TABLE "Contact" ADD COLUMN "experience" JSONB;
ALTER TABLE "Contact" ADD COLUMN "profileScrapedAt" TIMESTAMP(3);
