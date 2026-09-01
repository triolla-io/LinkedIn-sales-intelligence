import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { checkDraftEdit } from "@/lib/tech-radar/draft-guard";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";
import { pilotHoldEnabled, isPilotReviewer } from "@/lib/tech-radar/pilot-gate";
import { evaluateRelease, STALE_IN_QUEUE_REASON } from "@/lib/tech-radar/person-rank";

/**
 * Radar draft actions — prepare-not-send, same shape as the tech-radar route: LinkedIn
 * goes through a PREPARE_MESSAGE extension task that types the draft and hands the tab
 * over; "sent" is the user's own confirmation that they clicked Send.
 *
 * THE RELEASE GATE lives on `prepare` — the act that actually puts a message in front of
 * a human to send. Creation is free (see person-rank.ts): a candidate inside someone's
 * 7-day window still becomes a draft and waits in their queue. Here it is either
 * released, WITHHELD with the window's own Hebrew reason (409, nothing queued, the draft
 * untouched so it can be released later), or CLOSED because its article aged past the
 * freshness window while it waited — never sent stale, never dropped without a reason.
 * `save`, `dismiss` and `sent` are bookkeeping and stay ungated: `sent` in particular
 * must always record reality, or a real send loses its confirmation step.
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

  // Pilot gate: this is the ACTUAL enforcement, not just visibility. Without this check a
  // held draft's id (leaked nowhere else once 3a/3b/3c are fixed, but reachable by anyone
  // who already has it) could still be prepared or marked sent by its owner, bypassing the
  // whole review gate. A held draft 404s here for a non-reviewer, exactly like a draft that
  // does not exist or belongs to someone else (2026-08-26 final review, Finding 3d).
  const holdsFromThisViewer = pilotHoldEnabled() && !isPilotReviewer(ctx.user.email);

  const draft = await prisma.radarDraft.findFirst({
    where: {
      id,
      ownerId: ctx.effectiveUserId,
      ...(holdsFromThisViewer ? { pilotHeldAt: null } : {}),
    },
    select: {
      id: true,
      draftMessage: true,
      status: true,
      contact: {
        select: {
          fullName: true,
          linkedinUrl: true,
          // The pacing signal, read through the contact this owner-scoped draft hangs off
          // — so it needs no second tenancy filter of its own. BOTH channels count: a
          // campaign/sequence message (SentMessage) and a radar draft this person already
          // confirmed as sent. Reading only one of them would pace against half the truth.
          messages: {
            where: { status: "SENT" },
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { sentAt: true },
          },
          radarDrafts: {
            where: { status: "SENT", sentAt: { not: null } },
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { sentAt: true },
          },
        },
      },
      item: { select: { title: true, summary: true, sources: true, publishedAt: true } },
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

    // The release gate. Both stops carry `message` in Hebrew, which the approvals card
    // renders as-is — a withhold or a close that a human cannot read on screen is the
    // silent-SKIP failure this project has a standing rule against.
    const lastMessageAt = [
      draft.contact.messages[0]?.sentAt ?? null,
      draft.contact.radarDrafts[0]?.sentAt ?? null,
    ]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const release = evaluateRelease({
      itemPublishedAt: draft.item.publishedAt,
      lastMessageAt,
      now: new Date(),
    });

    if (release.action === "close") {
      // Closed here and not merely refused: the article is past the window, so no later
      // click can make this sendable. judgeAndDraft sweeps these once per run too; this
      // is the guard for the gap between sweeps.
      await prisma.radarDraft.update({
        where: { id: draft.id },
        data: { status: "DISMISSED", discardReason: STALE_IN_QUEUE_REASON },
      });
      await prisma.radarFeedback.create({
        data: { draftId: draft.id, event: "DISCARDED", reason: STALE_IN_QUEUE_REASON },
      });
      return NextResponse.json(
        { error: STALE_IN_QUEUE_REASON, message: release.hebrew, ageDays: release.ageDays },
        { status: 409 }
      );
    }

    if (release.action === "withhold") {
      // Nothing is written: the draft stays PENDING_REVIEW and becomes releasable on its
      // own once the window opens. Withheld is a DERIVED state, not a stored one.
      return NextResponse.json(
        {
          error: "withheld",
          reason: release.reason,
          message: release.hebrew,
          daysUntilOpen: release.daysUntilOpen,
        },
        { status: 409 }
      );
    }

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
