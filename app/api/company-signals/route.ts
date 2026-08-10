import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const drafts = await prisma.companySignalDraft.findMany({
    where: {
      ownerId: ctx.effectiveUserId,
      // APPROVED = a prepare task is queued/running; PREPARED = draft is typed in an
      // open tab / Gmail compose, waiting for the user's "שלחתי" confirmation.
      status: { in: ["PENDING_REVIEW", "APPROVED", "PREPARED"] },
      // Only surface signals for small companies; null staffCount is excluded (fail closed)
      signal: { company: { staffCount: { lte: 500 } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      channel: true,
      draftMessage: true,
      emailSubject: true,
      emailBody: true,
      whatsappMessage: true,
      createdAt: true,
      contact: { select: { fullName: true, currentTitle: true, linkedinUrl: true, email: true, phone: true } },
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
