-- Why an opportunity has nobody to send to.
--
-- The screen showed one message — "you have no senior contact at this company" — for
-- three different situations, and it was false for two of them: contacts existed but
-- none owned that kind of decision, or the right people were already holding enough
-- open drafts this week. Only the first is a gap in their contact list.

-- AlterTable
ALTER TABLE "TechOpportunity" ADD COLUMN "blockReason" TEXT;
