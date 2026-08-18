import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

const OPEN_STATUSES = ["PENDING_REVIEW", "PREPARING", "PREPARED"] as const;

/**
 * The feed: opportunities for this org's tracked companies, each with the drafts that
 * belong to the calling user. Opportunities with no drafts at all are still returned —
 * they carry the "no one to contact" signal, which tells the rep where they need a contact.
 */
export const GET = withTenant(async (_req, ctx) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.effectiveUserId },
    select: { orgId: true },
  });

  const opportunities = await prisma.techOpportunity.findMany({
    where: {
      trackedCompany: { orgId: user.orgId },
      status: { in: ["DISCOVERED", "DRAFTED"] },
    },
    orderBy: [{ createdAt: "desc" }, { score: "desc" }],
    take: 100,
    select: {
      id: true, fitRationale: true, score: true, status: true, createdAt: true,
      trackedCompany: { select: { id: true, name: true, relationship: true } },
      item: {
        select: {
          id: true, vendor: true, technology: true, title: true, summary: true,
          categories: true, sources: true, publishedAt: true, thin: true,
        },
      },
      drafts: {
        where: { ownerId: ctx.effectiveUserId, status: { in: [...OPEN_STATUSES] } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, draftMessage: true, status: true, channel: true,
          contact: {
            select: { fullName: true, currentTitle: true, email: true, phone: true, linkedinUrl: true },
          },
        },
      },
    },
  });
  return NextResponse.json({ opportunities });
});
