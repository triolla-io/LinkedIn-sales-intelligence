import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Prepare-not-send review flow, identical in shape to the Fintech Radar one: LinkedIn
 * goes through a PREPARE_MESSAGE extension task that types the draft and hands the tab
 * over; email/WhatsApp open a pre-filled compose client-side and record PREPARED. "sent"
 * is the user's own confirmation that they clicked Send. No channel marks SENT on open.
 */
type Body =
  | { action: "dismiss" }
  | { action: "prepare"; message: string }
  | { action: "prepared"; channel: "email" | "whatsapp"; message: string }
  | { action: "sent"; channel?: "email" | "linkedin" | "whatsapp" }
  | { action: "save"; message: string };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const draft = await prisma.techOpportunityDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    select: { id: true, contact: { select: { fullName: true, linkedinUrl: true } } },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "dismiss") {
    await prisma.techOpportunityDraft.update({ where: { id: draft.id }, data: { status: "DISMISSED" } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "save") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    await prisma.techOpportunityDraft.update({ where: { id: draft.id }, data: { draftMessage: message } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "prepare") {
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    if (!draft.contact.linkedinUrl) return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });

    // Guarded transition so a double-click cannot queue two prepare tasks.
    const claimed = await prisma.techOpportunityDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "PREPARING", draftMessage: message, channel: "LINKEDIN" },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

    // No send jitter: the user is waiting for the tab and the actual send is human.
    await prisma.extensionTask.create({
      data: {
        userId: ctx.effectiveUserId,
        kind: "PREPARE_MESSAGE",
        payload: {
          linkedinUrl: draft.contact.linkedinUrl,
          text: message,
          recipientName: draft.contact.fullName ?? "",
        } as Prisma.InputJsonValue,
        techDraftId: draft.id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "prepared") {
    if (!["email", "whatsapp"].includes(body.channel)) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    const claimed = await prisma.techOpportunityDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "PREPARED", draftMessage: message, channel: body.channel.toUpperCase() },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "sent") {
    if (body.channel !== undefined && !["email", "linkedin", "whatsapp"].includes(body.channel)) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }
    await prisma.techOpportunityDraft.update({
      where: { id: draft.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        ...(body.channel ? { channel: body.channel.toUpperCase() } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
