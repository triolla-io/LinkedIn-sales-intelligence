-- AlterEnum
ALTER TYPE "CampaignChannel" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "SentMessage" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "metadata" JSONB;
