-- Prepare-not-send review flow (company signals + fintech radar):
-- the extension types the message into LinkedIn compose and leaves the tab open;
-- the user sends manually and confirms, so nothing auto-sends.

-- AlterEnum
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'PREPARE_MESSAGE';

-- AlterEnum
ALTER TYPE "CompanySignalDraftStatus" ADD VALUE 'PREPARED';

-- AlterEnum
ALTER TYPE "ArticleMatchStatus" ADD VALUE 'PREPARING';

-- AlterEnum
ALTER TYPE "ArticleMatchStatus" ADD VALUE 'PREPARED';

-- AlterTable
ALTER TABLE "ExtensionTask" ADD COLUMN "articleMatchId" TEXT;
