import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Prepare-not-send review flow (user decision 2026-08-10): nothing auto-sends.
 * - "prepare"  (LinkedIn): queue a PREPARE_MESSAGE extension task — the extension types
 *   the message into LinkedIn compose and hands the open tab to the user, who clicks
 *   Send themselves. Status: PENDING_REVIEW → APPROVED (→ PREPARED via task result).
 * - "prepared" (email): the client opened a pre-filled Gmail compose window; just record
 *   PREPARED so the card waits for confirmation.
 * - "sent": the user confirms they actually hit Send — only now a SentMessage is recorded.
 */
type Body =
  | { action: "prepare"; message: string }
  | { action: "prepared"; channel: "email"; subject: string; message: string }
  | { action: "sent" }
  | { action: "dismiss" };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  // withTenant discards route params; extract ID from URL pathname
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const draft = await prisma.companySignalDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    include: { contact: { select: { id: true, fullName: true, linkedinUrl: true, email: true } } },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "dismiss") {
    await prisma.companySignalDraft.update({ where: { id: draft.id }, data: { status: "DISMISSED" } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "prepare") {
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    if (!draft.contact.linkedinUrl) return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });

    // Guarded transition: only PENDING_REVIEW → APPROVED queues a task, so a
    // double-click can't queue two prepare tasks.
    const claimed = await prisma.companySignalDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "APPROVED", draftMessage: message, channel: "LINKEDIN" },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

    // No send jitter (STA-18 applies to automated sends only): the user is sitting in
    // front of the screen waiting for the tab, and the actual send is human anyway.
    await prisma.extensionTask.create({
      data: {
        userId: ctx.effectiveUserId,
        kind: "PREPARE_MESSAGE",
        payload: {
          linkedinUrl: draft.contact.linkedinUrl,
          text: message,
          recipientName: draft.contact.fullName ?? "",
        } as Prisma.InputJsonValue,
        companySignalDraftId: draft.id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "prepared") {
    if (body.channel !== "email") return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    const subject = (body.subject ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!subject || !message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    if (!draft.contact.email) return NextResponse.json({ error: "no_email" }, { status: 400 });

    const claimed = await prisma.companySignalDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "PREPARED", emailSubject: subject, emailBody: message, channel: "EMAIL" },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "sent") {
    // Guarded so a double-click can't record the message twice.
    const claimed = await prisma.companySignalDraft.updateMany({
      where: { id: draft.id, status: "PREPARED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_prepared" }, { status: 409 });

    const isEmail = draft.channel === "EMAIL";
    await prisma.sentMessage.create({
      data: {
        senderId: ctx.effectiveUserId,
        actorId: ctx.effectiveUserId,
        contactId: draft.contact.id,
        body: (isEmail ? draft.emailBody : draft.draftMessage) ?? "",
        status: "SENT",
        sentAt: new Date(),
        metadata: {
          channel: isEmail ? "email" : "linkedin",
          companySignalDraftId: draft.id,
          manualSend: true,
        } as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
