import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const drafts = await prisma.companySignalDraft.findMany({
    where: {
      ownerId: ctx.effectiveUserId,
      status: "PENDING_REVIEW",
      // Only surface signals for small companies; null staffCount is excluded (fail closed)
      signal: { company: { staffCount: { lte: 500 } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      draftMessage: true,
      createdAt: true,
      contact: { select: { fullName: true, currentTitle: true, linkedinUrl: true } },
      signal: {
        select: {
          signalType: true, title: true, summary: true, confidence: true,
          sources: true, eventDate: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json({ drafts });
});
