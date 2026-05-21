-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISCONNECTED');

-- AlterEnum
ALTER TYPE "CampaignChannel" ADD VALUE 'LINKEDIN';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "LinkedinSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedCookie" TEXT NOT NULL,
    "cookieExpiresAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedinSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinSession_userId_key" ON "LinkedinSession"("userId");

-- AddForeignKey
ALTER TABLE "LinkedinSession" ADD CONSTRAINT "LinkedinSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
