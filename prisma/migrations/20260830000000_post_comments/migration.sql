-- New task kinds. NOTE: a new enum value cannot be USED in the same
-- transaction that adds it — this migration only adds, never inserts.
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'SCRAPE_POSTS';
ALTER TYPE "ExtensionTaskKind" ADD VALUE 'PREPARE_COMMENT';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "postCommentsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contact" ADD COLUMN "postWatchEnabled" BOOLEAN;
ALTER TABLE "Contact" ADD COLUMN "postWatchAddedAt" TIMESTAMP(3);
ALTER TABLE "ExtensionTask" ADD COLUMN "postCommentDraftId" TEXT;

-- CreateEnum
CREATE TYPE "PostCommentDraftStatus" AS ENUM ('PENDING_REVIEW', 'PREPARING', 'PREPARED', 'SENT', 'DISMISSED');

-- CreateTable
CREATE TABLE "LinkedInPost" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "activityUrn" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "postedAgoText" TEXT,
    "postedAt" TIMESTAMP(3),
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkedInPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostCommentDraft" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "commentText" TEXT NOT NULL,
    "status" "PostCommentDraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "dismissReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostCommentDraft_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "LinkedInPost_ownerId_activityUrn_key" ON "LinkedInPost"("ownerId", "activityUrn");
CREATE INDEX "LinkedInPost_contactId_idx" ON "LinkedInPost"("contactId");
CREATE UNIQUE INDEX "PostCommentDraft_postId_key" ON "PostCommentDraft"("postId");
CREATE INDEX "PostCommentDraft_ownerId_status_idx" ON "PostCommentDraft"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "LinkedInPost" ADD CONSTRAINT "LinkedInPost_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostCommentDraft" ADD CONSTRAINT "PostCommentDraft_postId_fkey" FOREIGN KEY ("postId") REFERENCES "LinkedInPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostCommentDraft" ADD CONSTRAINT "PostCommentDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
