import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

/**
 * The reviewer feed: every draft still awaiting the user's action. PENDING_REVIEW is a
 * fresh draft; PREPARING/PREPARED stay visible so the card survives until the user
 * confirms "sent" — otherwise the prepare flow loses its confirmation step on the next
 * poll (same reasoning as the radar drafts feed).
 */
export const GET = withTenant(async (_req, ctx) => {
  const drafts = await prisma.postCommentDraft.findMany({
    where: {
      ownerId: ctx.effectiveUserId,
      status: { in: ["PENDING_REVIEW", "PREPARING", "PREPARED"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      commentText: true,
      createdAt: true,
      sentAt: true,
      post: {
        select: { postUrl: true, text: true, postedAt: true, postedAgoText: true },
      },
      contact: {
        select: {
          id: true,
          fullName: true,
          currentTitle: true,
          currentCompany: true,
          linkedinUrl: true,
        },
      },
    },
  });
  return NextResponse.json({ drafts });
});
