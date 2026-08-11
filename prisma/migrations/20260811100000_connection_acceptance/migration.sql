-- Connection acceptance detection: nightly extension scrape of the user's own
-- connections list, cross-matched against SENT connection requests.

-- AlterEnum
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'SCRAPE_CONNECTIONS';

-- AlterEnum
ALTER TYPE "ProspectingEventType" ADD VALUE 'ACCEPTED';

-- AlterTable
ALTER TABLE "ConnectionRequest" ADD COLUMN "acceptedAt" TIMESTAMP(3);
