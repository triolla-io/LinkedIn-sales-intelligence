import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const rows = await prisma.contactJobChange.findMany({
    where: {
      contact: { ownerId: ctx.effectiveUserId },
      status: { in: ["PENDING_REVIEW", "APPROVED", "SENT"] },
    },
    orderBy: { detectedAt: "desc" },
    take: 200,
    select: {
      id: true,
      contactId: true,
      prevTitle: true,
      newTitle: true,
      prevCompany: true,
      newCompany: true,
      detectedAt: true,
      status: true,
      changeType: true,
      draftMessage: true,
      sentAt: true,
      contact: { select: { fullName: true, linkedinUrl: true } },
    },
  });

  // Surface the most recent failed send per change so a bounced approve explains itself.
  const failed = await prisma.extensionTask.findMany({
    where: { jobChangeId: { in: rows.map((r) => r.id) }, kind: "SEND", status: "FAILED" },
    orderBy: { createdAt: "desc" },
    select: { jobChangeId: true, errorMessage: true, errorCode: true },
  });
  const errorByChange = new Map<string, string>();
  for (const t of failed) {
    if (t.jobChangeId && !errorByChange.has(t.jobChangeId)) {
      errorByChange.set(t.jobChangeId, t.errorMessage ?? t.errorCode ?? "send_failed");
    }
  }

  return NextResponse.json({
    changes: rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      fullName: r.contact.fullName,
      linkedinUrl: r.contact.linkedinUrl,
      prevTitle: r.prevTitle,
      newTitle: r.newTitle,
      prevCompany: r.prevCompany,
      newCompany: r.newCompany,
      detectedAt: r.detectedAt.toISOString(),
      status: r.status,
      changeType: r.changeType,
      draftMessage: r.draftMessage,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      lastSendError: r.status === "PENDING_REVIEW" ? (errorByChange.get(r.id) ?? null) : null,
    })),
  });
});
