-- AlterEnum
BEGIN;
CREATE TYPE "CampaignChannel_new" AS ENUM ('EMAIL', 'WHATSAPP');
ALTER TABLE "Campaign" ALTER COLUMN "channel" TYPE "CampaignChannel_new" USING ("channel"::text::"CampaignChannel_new");
ALTER TYPE "CampaignChannel" RENAME TO "CampaignChannel_old";
ALTER TYPE "CampaignChannel_new" RENAME TO "CampaignChannel";
DROP TYPE "public"."CampaignChannel_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "LinkedinSession" DROP CONSTRAINT "LinkedinSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "SyncJob" DROP CONSTRAINT "SyncJob_userId_fkey";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "connectedAt";

-- DropTable
DROP TABLE "LinkedinSession";

-- DropTable
DROP TABLE "SyncJob";

-- DropEnum
DROP TYPE "SessionStatus";

-- DropEnum
DROP TYPE "SyncType";
