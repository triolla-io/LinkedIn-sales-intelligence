import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { draftTechMessage } from "@/lib/tech-radar/draft";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";

/**
 * Lift a personal-gate rejection.
 *
 * The override cancels the REJECTION, not the quality bar: the message is written by
 * the same path the pipeline uses, guard and retries included. If the writing cannot
 * produce a clean message, the override fails loudly rather than storing a bad one —
 * the point is to teach the gate, not to bypass the checks behind it.
 *
 * The reason is recorded with the event. Without it the learning loop knows only that
 * the gate was wrong, not what it was wrong about, which is half the value.
 */

/** Kept short: it is a note for the learning loop, not a memo. */
const MAX_REASON = 300;

export const POST = withTenant(async (req: NextRequest, ctx) => {
  // .../drafts/<id>/override
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : "";

  const draft = await prisma.radarDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    select: {
      id: true,
      status: true,
      whyHim: true,
      discardReason: true,
      contact: {
        select: { fullName: true, hebrewFirstName: true, currentTitle: true, currentCompany: true },
      },
      item: { select: { title: true, summary: true, technology: true, sources: true } },
    },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Only a rejection can be lifted. Anything else is already on its way to a human.
  if (draft.status !== "VETOED") {
    return NextResponse.json({ error: "not_vetoed" }, { status: 409 });
  }

  let message: string;
  try {
    message = await draftTechMessage({
      contactFullName: draft.contact.fullName,
      hebrewFirstName: draft.contact.hebrewFirstName,
      contactTitle: draft.contact.currentTitle,
      companyName: draft.contact.currentCompany ?? "",
      technology: draft.item.technology ?? draft.item.title,
      vendor: null,
      // The human's reason is the person-specific argument when they gave one; otherwise
      // fall back to what the gate itself said about him.
      fitRationale: reason || draft.whyHim || draft.item.title,
      sourceUrl: firstSourceUrl(draft.item.sources),
      itemText: `${draft.item.title}\n${draft.item.summary ?? ""}`,
    });
  } catch (err) {
    // A failure here means the guard could not be satisfied. Saying so beats storing a
    // message that the pipeline itself would have refused to send.
    return NextResponse.json(
      { error: "draft_failed", detail: (err as Error).message },
      { status: 502 }
    );
  }

  // Guarded transition: two clicks cannot produce two overrides of one rejection.
  const claimed = await prisma.radarDraft.updateMany({
    where: { id: draft.id, status: "VETOED" },
    data: { status: "PENDING_REVIEW", draftMessage: message, discardReason: null },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "not_vetoed" }, { status: 409 });

  await prisma.radarFeedback.create({
    data: {
      draftId: draft.id,
      event: "OVERRIDDEN",
      reason: reason || null,
      draftBefore: draft.discardReason ?? draft.whyHim ?? null,
      sentAfter: message,
    },
  });

  return NextResponse.json({ ok: true });
});
