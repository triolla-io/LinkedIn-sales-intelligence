import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const articles = await prisma.fintechArticle.findMany({
    where: { matches: { some: { ownerId: ctx.effectiveUserId, status: "SUGGESTED" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, title: true, summary: true, url: true, source: true, publishedAt: true,
      matches: {
        where: { ownerId: ctx.effectiveUserId, status: "SUGGESTED" },
        orderBy: { score: "desc" },
        select: {
          id: true, score: true, reason: true, draftMessage: true,
          contact: { select: { fullName: true, currentTitle: true, email: true, phone: true, linkedinUrl: true } },
        },
      },
    },
  });
  return NextResponse.json({ articles });
});
