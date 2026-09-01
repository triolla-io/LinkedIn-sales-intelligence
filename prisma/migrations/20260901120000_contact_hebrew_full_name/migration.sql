-- The person's full name as Israeli press writes it. ADDITIVE, nullable: prod runs
-- `prisma migrate deploy` at boot and a failed migration crash-loops the app into a 502.
--
-- Radar person research is unusable without it. A Hebrew query built from `hebrewFirstName`
-- alone carries a given name, which cannot identify anyone ("ארז" matched a story about a
-- different Erez at the same bank), and a Hebrew search RESULT cannot be matched back to a
-- contact whose surname exists only as Latin text.
ALTER TABLE "Contact" ADD COLUMN "hebrewFullName" TEXT;
