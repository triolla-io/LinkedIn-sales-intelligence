-- Two additions driven by the first scan a human ran themselves.
--
-- businessLine: the line attribution was computed for the cap but thrown away, so the
-- drafting stage had no way to spread across lines. In that run both energy
-- opportunities were left with zero drafts because the finance ones had already spent
-- every contact's message budget — the diversity we built was real in the feed and
-- absent in the outreach.
--
-- contactSuggestion: an opportunity with nobody senior to send it to currently reads as
-- a dead end. Holding a recommendation of which role to acquire turns it into a lead.

-- AlterTable
ALTER TABLE "TechOpportunity" ADD COLUMN "businessLine" TEXT;
ALTER TABLE "TechOpportunity" ADD COLUMN "contactSuggestion" TEXT;
