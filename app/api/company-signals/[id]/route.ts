import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

type Body = { action: "approve"; message: string } | { action: "dismiss" };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  // withTenant discards route params; extract ID from URL pathname
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const draft = await prisma.companySignalDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    include: { contact: { select: { fullName: true, linkedinUrl: true } } },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "dismiss") {
    await prisma.companySignalDraft.update({ where: { id: draft.id }, data: { status: "DISMISSED" } });
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "approve") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  if (!draft.contact.linkedinUrl) {
    return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });
  }

  // Guarded transition: only PENDING_REVIEW → APPROVED queues a send, so a double-click can't send twice.
  const claimed = await prisma.companySignalDraft.updateMany({
    where: { id: draft.id, status: "PENDING_REVIEW" },
    data: { status: "APPROVED", draftMessage: message },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

  await prisma.extensionTask.create({
    data: {
      userId: ctx.effectiveUserId,
      kind: "SEND",
      payload: {
        linkedinUrl: draft.contact.linkedinUrl,
        text: message,
        recipientName: draft.contact.fullName ?? "",
      } as Prisma.InputJsonValue,
      companySignalDraftId: draft.id,
      scheduledFor: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
});
