import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { scheduleJitteredSend } from "@/lib/extension/schedule-send";
import { sendEmail } from "@/lib/gmail/client";

type Body =
  | { action: "approve"; message: string; channel?: "linkedin" | "email"; subject?: string }
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
  if (body.action !== "approve") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  const channel = body.channel ?? "linkedin";

  if (channel === "email") {
    const subject = (body.subject ?? "").trim();
    if (!subject) return NextResponse.json({ error: "empty_subject" }, { status: 400 });
    if (!draft.contact.email) return NextResponse.json({ error: "no_email" }, { status: 400 });

    // Guarded transition, same double-click protection as the LinkedIn path.
    const claimedEmail = await prisma.companySignalDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "APPROVED", emailSubject: subject, emailBody: message },
    });
    if (claimedEmail.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

    const owner = await prisma.user.findUnique({
      where: { id: ctx.effectiveUserId },
      select: { emailSignature: true },
    });
    try {
      await sendEmail(ctx.effectiveUserId, {
        to: draft.contact.email,
        subject,
        body: message,
        signatureHtml: owner?.emailSignature,
      });
    } catch (e) {
      // Roll back to PENDING_REVIEW so the draft is not stranded in APPROVED with nothing sent.
      await prisma.companySignalDraft.updateMany({
        where: { id: draft.id, status: "APPROVED" },
        data: { status: "PENDING_REVIEW" },
      });
      const msg = e instanceof Error ? e.message : "send_failed";
      const friendly =
        msg === "NO_GOOGLE_ACCOUNT" || msg === "GMAIL_SCOPE_MISSING" ? "gmail_not_connected" : "email_send_failed";
      return NextResponse.json({ error: friendly }, { status: 502 });
    }

    await prisma.$transaction([
      prisma.sentMessage.create({
        data: {
          senderId: ctx.effectiveUserId,
          actorId: ctx.effectiveUserId,
          contactId: draft.contact.id,
          body: message,
          status: "SENT",
          sentAt: new Date(),
          metadata: { channel: "email", companySignalDraftId: draft.id } as Prisma.InputJsonValue,
        },
      }),
      prisma.companySignalDraft.update({ where: { id: draft.id }, data: { status: "SENT" } }),
    ]);
    return NextResponse.json({ ok: true, sent: "email" });
  }

  if (!draft.contact.linkedinUrl) {
    return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });
  }

  // Guarded transition: only PENDING_REVIEW → APPROVED queues a send, so a double-click can't send twice.
  const claimed = await prisma.companySignalDraft.updateMany({
    where: { id: draft.id, status: "PENDING_REVIEW" },
    data: { status: "APPROVED", draftMessage: message },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

  // Humanized spacing: never fire back-to-back with other queued/recent SENDs (STA-18).
  const { scheduledFor, delaySeconds } = await scheduleJitteredSend(ctx.effectiveUserId);
  console.info(
    `[company-signals] send jitter delay=${delaySeconds.toFixed(2)}s draft=${draft.id} recipient=${draft.contact.linkedinUrl} scheduledFor=${scheduledFor.toISOString()}`
  );

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
      scheduledFor,
    },
  });

  return NextResponse.json({ ok: true });
});
