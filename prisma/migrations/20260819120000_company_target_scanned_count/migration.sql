-- Count the people LinkedIn returned for a company, matching the searched role or not.
--
-- Without it, a company whose searches returned 25 people who all held the wrong role was
-- indistinguishable from a company whose searches returned nothing: both showed "0 נמצאו" and
-- the run reported COMPLETED with no explanation (adi@triolla.io / Playtika, 2026-08-18).

-- AlterTable
ALTER TABLE "ProspectingCompanyTarget" ADD COLUMN     "scannedCount" INTEGER NOT NULL DEFAULT 0;
