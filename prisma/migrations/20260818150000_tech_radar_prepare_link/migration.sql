-- Wire the Tech Radar prepare-not-send flow into the extension task pipeline.
--
-- PREPARING is the claimed state between "user pressed prepare" and "the extension
-- finished typing", so a double-click cannot queue two PREPARE_MESSAGE tasks.
-- ExtensionTask.techDraftId follows the existing polymorphic-link convention on that
-- table (nullable, no FK by design) alongside articleMatchId and companySignalDraftId.

-- AlterEnum
ALTER TYPE "TechDraftStatus" ADD VALUE 'PREPARING' AFTER 'PENDING_REVIEW';

-- AlterTable
ALTER TABLE "ExtensionTask" ADD COLUMN "techDraftId" TEXT;
