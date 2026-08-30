import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { enforceCommentRules } from "@/lib/post-comments/draft";

/**
 * Post-comment draft actions — prepare-not-send, same shape as the radar drafts route
 * (app/api/radar/drafts/[id]/route.ts): a PREPARE_COMMENT extension task types the
 * comment into the post and hands the tab over; "sent" is only the user's own
 * confirmation that they pressed LinkedIn's submit button — nothing here posts anything.
 */

type Body =
  | { action: "save"; comment: string }
  | { action: "prepare"; comment: string }
  | { action: "dismiss"; reason?: string }
  | { action: "sent" };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  // Tenancy: a draft belonging to another user matches nothing here and 404s, exactly
  // like one that doesn't exist.
  const draft = await prisma.postCommentDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    select: {
      id: true,
      post: { select: { postUrl: true } },
      contact: { select: { fullName: true } },
    },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "save" || body.action === "prepare") {
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const violations = enforceCommentRules(comment);
    if (violations.length > 0) {
      return NextResponse.json({ error: "guard", violations }, { status: 422 });
    }

    if (body.action === "save") {
      await prisma.postCommentDraft.update({
        where: { id: draft.id },
        data: { commentText: comment },
      });
      return NextResponse.json({ ok: true });
    }

    // prepare — guarded transition: updateMany only flips PENDING_REVIEW -> PREPARING,
    // so a double-click (two PATCH requests racing) can create at most one
    // PREPARE_COMMENT task; the second call's updateMany matches zero rows and 409s
    // before ever reaching extensionTask.create.
    const flipped = await prisma.postCommentDraft.updateMany({
      where: { id: draft.id, status: "PENDING_REVIEW" },
      data: { status: "PREPARING", commentText: comment },
    });
    if (flipped.count === 0) {
      return NextResponse.json({ error: "not_pending" }, { status: 409 });
    }

    // No send jitter: the user is waiting for the tab and the actual send is human.
    await prisma.extensionTask.create({
      data: {
        userId: ctx.effectiveUserId,
        kind: "PREPARE_COMMENT",
        payload: {
          postUrl: draft.post.postUrl,
          text: comment,
          recipientName: draft.contact.fullName,
        } as Prisma.InputJsonValue,
        postCommentDraftId: draft.id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "dismiss") {
    // Guarded like every other transition: a draft already SENT must never be
    // overwritten to DISMISSED — that would erase the record that a comment was
    // actually sent.
    const flipped = await prisma.postCommentDraft.updateMany({
      where: { id: draft.id, status: { not: "SENT" } },
      data: { status: "DISMISSED", dismissReason: body.reason ?? null },
    });
    if (flipped.count === 0) {
      return NextResponse.json({ error: "already_sent" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "sent") {
    // Guarded the same way as prepare: only a draft actually in flight can be marked
    // sent, so a stray or repeated "sent" on an already-sent/dismissed draft 409s
    // instead of silently overwriting sentAt.
    const flipped = await prisma.postCommentDraft.updateMany({
      where: { id: draft.id, status: { in: ["PREPARED", "PREPARING"] } },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (flipped.count === 0) {
      return NextResponse.json({ error: "not_prepared" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
