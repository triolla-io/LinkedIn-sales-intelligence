import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { checkDraftEdit } from "@/lib/tech-radar/draft-guard";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";

/**
 * Radar draft actions — prepare-not-send, same shape as the tech-radar route: LinkedIn
 * goes through a PREPARE_MESSAGE extension task that types the draft and hands the tab
 * over; "sent" is the user's own confirmation that they clicked Send.
 *
 * save runs the TWO-TIER edit guard: hard violations (foreign link, unsourced figure)
 * reject with 422 and change nothing; soft violations save and come back as warnings —
 * the message is the user's. Every save logs EDITED with the previous text, which is
 * the fuel of phrasing-learning, not just of the guard.
 */

const DISMISS_REASONS = ["not_interesting", "not_now", "weak_source"] as const;
type DismissReason = (typeof DISMISS_REASONS)[number];

type Body =
  | { action: "save"; message: string }
  | { action: "prepare"; message: string }
  | { action: "dismiss"; reason: DismissReason }
  | { action: "sent" };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const draft = await prisma.radarDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    select: {
      id: true,
      draftMessage: true,
      status: true,
      contact: { select: { fullName: true, linkedinUrl: true } },
      item: { select: { title: true, summary: true, sources: true } },
    },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const canonicalUrl = firstSourceUrl(draft.item.sources);
  const sourceText = `${draft.item.title}\n${draft.item.summary}`;

  if (body.action === "save" || body.action === "prepare") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });

    const check = checkDraftEdit(message, { canonicalUrl, sourceText });
    if (check.hard.length > 0) {
      return NextResponse.json({ error: "hard_violation", hard: check.hard }, { status: 422 });
    }

    if (body.action === "save") {
      await prisma.radarDraft.update({ where: { id: draft.id }, data: { draftMessage: message } });
      if (message !== draft.draftMessage) {
        await prisma.radarFeedback.create({
          data: { draftId: draft.id, event: "EDITED", draftBefore: draft.draftMessage ?? "" },
        });
      }
      return NextResponse.json({ ok: true, soft: check.soft });
    }

    // prepare
    if (!draft.contact.linkedinUrl) return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });

    // Guarded transition so a double-click cannot queue two prepare tasks.
    const claimed = await prisma.radarDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "PREPARING", draftMessage: message },
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
        radarDraftId: draft.id,
      },
    });
    return NextResponse.json({ ok: true, soft: check.soft });
  }

  if (body.action === "dismiss") {
    if (!DISMISS_REASONS.includes(body.reason)) {
      return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
    }
    await prisma.radarDraft.update({
      where: { id: draft.id },
      data: { status: "DISMISSED", discardReason: body.reason },
    });
    await prisma.radarFeedback.create({
      data: { draftId: draft.id, event: "DISCARDED", reason: body.reason },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "sent") {
    await prisma.radarDraft.update({
      where: { id: draft.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    await prisma.radarFeedback.create({
      data: { draftId: draft.id, event: "SENT", sentAfter: draft.draftMessage ?? "" },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
