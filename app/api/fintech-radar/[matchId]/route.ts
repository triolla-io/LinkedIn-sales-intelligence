import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Prepare-not-send review flow (user decision 2026-08-10): no channel marks SENT on
 * open anymore. LinkedIn goes through a PREPARE_MESSAGE extension task (the extension
 * types the draft and hands the open tab to the user); email/WhatsApp open a pre-filled
 * compose (Gmail / wa.me) client-side and record PREPARED. "sent" is the user's manual
 * confirmation that they actually clicked Send.
 */
type Body =
  | { action: "dismiss" }
  | { action: "prepare"; message: string }
  | { action: "prepared"; channel: "email" | "whatsapp"; message: string }
  | { action: "sent"; channel?: "email" | "linkedin" | "whatsapp" }
  | { action: "save"; message: string };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  // withTenant discards route params; extract matchId from URL pathname
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const match = await prisma.articleMatch.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    select: { id: true, contact: { select: { fullName: true, linkedinUrl: true } } },
  });
  if (!match) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "dismiss") {
    await prisma.articleMatch.update({ where: { id: match.id }, data: { status: "DISMISSED" } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "prepare") {
    const message = (body.message ?? "").trim();
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    if (!match.contact.linkedinUrl) return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });

    // Guarded transition so a double-click can't queue two prepare tasks.
    const claimed = await prisma.articleMatch.updateMany({
      where: { id: match.id, status: "SUGGESTED" },
      data: { status: "PREPARING", draftMessage: message, sentChannel: "linkedin" },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_suggested" }, { status: 409 });

    // No send jitter: the user is waiting for the tab, and the actual send is human.
    await prisma.extensionTask.create({
      data: {
        userId: ctx.effectiveUserId,
        kind: "PREPARE_MESSAGE",
        payload: {
          linkedinUrl: match.contact.linkedinUrl,
          text: message,
          recipientName: match.contact.fullName ?? "",
        } as Prisma.InputJsonValue,
        articleMatchId: match.id,
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
    const claimed = await prisma.articleMatch.updateMany({
      where: { id: match.id, status: "SUGGESTED" },
      data: { status: "PREPARED", draftMessage: message, sentChannel: body.channel },
    });
    if (claimed.count === 0) return NextResponse.json({ error: "not_suggested" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "save") {
    if (typeof body.message !== "string") {
      return NextResponse.json({ error: "empty_message" }, { status: 400 });
    }
    const message = body.message.trim();
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
    await prisma.articleMatch.update({ where: { id: match.id }, data: { draftMessage: message } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "sent") {
    // channel is optional: prepare/prepared already stamped sentChannel, so a bare
    // "sent" confirmation keeps the stored channel.
    if (body.channel !== undefined && !["email", "linkedin", "whatsapp"].includes(body.channel)) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }
    await prisma.articleMatch.update({
      where: { id: match.id },
      data: { status: "SENT", ...(body.channel ? { sentChannel: body.channel } : {}) },
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
