-- AlterTable: LinkedIn Industry Codes V2 facet ids for the prospecting search
-- (industry=["id",...] URL param). Empty array = no industry filter.
ALTER TABLE "ProspectingRun" ADD COLUMN "industryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
