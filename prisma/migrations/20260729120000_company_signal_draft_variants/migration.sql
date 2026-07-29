-- Email + WhatsApp message variants on company-signal drafts (display + copy only).
-- Additive nullable columns — existing drafts keep NULL and render LinkedIn-only.

-- AlterTable
ALTER TABLE "CompanySignalDraft" ADD COLUMN "emailSubject" TEXT,
ADD COLUMN "emailBody" TEXT,
ADD COLUMN "whatsappMessage" TEXT;
