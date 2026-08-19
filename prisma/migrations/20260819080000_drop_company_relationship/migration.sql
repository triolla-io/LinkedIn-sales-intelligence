-- Drop the customer/prospect distinction.
--
-- It was introduced to pick between two message registers. The register split was
-- dropped first (one advisory phrasing covers both), which left the field as a label
-- nobody acted on — so it goes too. Safe to drop: the Tech Radar has never been
-- enabled in production, so no real data is lost.

-- AlterTable
ALTER TABLE "TrackedCompany" DROP COLUMN "relationship";

-- DropEnum
DROP TYPE "CompanyRelationship";
