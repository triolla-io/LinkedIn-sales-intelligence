-- Extra names to match contacts on.
--
-- A holding company's employees write their employer many different ways: the live
-- Delek Group run matched 1 contact of 7 because the other six had "Delek" or
-- "Delek US Holdings" on their profile, so the Head of Digital and the CIDO — the two
-- most relevant people — were never considered.

-- AlterTable
ALTER TABLE "TrackedCompany" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
