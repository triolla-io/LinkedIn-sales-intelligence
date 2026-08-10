import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const articles = await prisma.fintechArticle.findMany({
    where: {
      // PREPARING/PREPARED = mid prepare-not-send flow; keep them visible until the
      // user confirms "שלחתי" (or dismisses).
      matches: { some: { ownerId: ctx.effectiveUserId, status: { in: ["SUGGESTED", "PREPARING", "PREPARED"] }, draftMessage: { not: null } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, title: true, summary: true, url: true, source: true, publishedAt: true,
      matches: {
        where: { ownerId: ctx.effectiveUserId, status: { in: ["SUGGESTED", "PREPARING", "PREPARED"] }, draftMessage: { not: null } },
        orderBy: { score: "desc" },
        select: {
          id: true, status: true, sentChannel: true, score: true, reason: true, draftMessage: true,
          contact: { select: { fullName: true, currentTitle: true, email: true, phone: true, linkedinUrl: true } },
        },
      },
    },
  });
  return NextResponse.json({ articles });
});
