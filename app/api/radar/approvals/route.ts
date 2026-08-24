import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";
import { figuresSourced } from "@/lib/tech-radar/draft-guard";
import { deriveQuietReason, type QuietReason } from "@/lib/tech-radar/quiet";

/**
 * The morning story, in one scoped call: pending drafts with honest chips, the scan
 * subline, and an explained quiet list.
 *
 * Chips say only what the data knows. factsVerified is a mechanical check of the
 * message's figures against the source's own words — never an LLM claim. The last-
 * message chip is "הודעה אחרונה מכאן", from SentMessage — NOT "דיברתם לאחרונה", which
 * the data cannot know (calls, coffee, their replies all live off-platform).
 */

function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/** The single place QuietReason becomes screen copy — zero jargon by construction. */
function quietText(reason: QuietReason): string {
  switch (reason.kind) {
    case "waiting":
      return reason.daysSinceMessage === 0
        ? "קיבל הודעה היום — בהמתנה"
        : `קיבל הודעה לפני ${reason.daysSinceMessage} ימים — בהמתנה`;
    case "all_vetoed":
      return `${reason.count} מועמדות נפסלו בשער האישי`;
    case "no_material":
      return "אין חומר בתחומים שלו השבוע";
  }
}

export const GET = withTenant(async (_req, ctx) => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);

  const [pending, profiles, scan] = await Promise.all([
    prisma.radarDraft.findMany({
      where: { ownerId: ctx.effectiveUserId, status: "PENDING_REVIEW" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        draftMessage: true,
        whyHim: true,
        createdAt: true,
        contact: {
          select: { id: true, fullName: true, currentTitle: true, currentCompany: true, linkedinUrl: true },
        },
        item: {
          select: { title: true, summary: true, sources: true, publishedAt: true, createdAt: true },
        },
      },
    }),
    prisma.personProfile.findMany({
      where: { contact: { ownerId: ctx.effectiveUserId, removedAt: null } },
      select: { contact: { select: { id: true, fullName: true, currentCompany: true } } },
    }),
    prisma.radarScanRun.findFirst({
      where: { orgId: ctx.org.id, finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { scanned: true, vetoed: true, finishedAt: true },
    }),
  ]);

  const contactIds = [...new Set([...profiles.map((p) => p.contact.id), ...pending.map((d) => d.contact.id)])];

  const [lastMsgs, vetoedRows, overriddenRows] = await Promise.all([
    contactIds.length
      ? prisma.sentMessage.groupBy({
          by: ["contactId"],
          where: { contactId: { in: contactIds } },
          _max: { sentAt: true },
        })
      : [],
    prisma.radarDraft.groupBy({
      by: ["contactId"],
      where: { ownerId: ctx.effectiveUserId, status: "VETOED", createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    pending.length
      ? prisma.radarFeedback.findMany({
          where: { draftId: { in: pending.map((d) => d.id) }, event: "OVERRIDDEN" },
          select: { draftId: true },
        })
      : [],
  ]);

  const lastByContact = new Map(lastMsgs.map((m) => [m.contactId, m._max.sentAt]));
  const vetoedByContact = new Map(vetoedRows.map((v) => [v.contactId, v._count._all]));
  const overridden = new Set(overriddenRows.map((o) => o.draftId));

  const drafts = pending.map((d) => {
    const canonicalUrl = firstSourceUrl(d.item.sources);
    const sourceText = `${d.item.title}\n${d.item.summary}`;
    const message = d.draftMessage ?? "";
    // The chip only exists when there is a figure to verify AND it verifies. A message
    // with no numbers has nothing to prove — no chip, not a green one.
    const prose = canonicalUrl ? message.split(canonicalUrl).join(" ") : message;
    const factsVerified = /\d/.test(prose) && figuresSourced(message, sourceText, canonicalUrl);
    return {
      id: d.id,
      contact: d.contact,
      message,
      whyHim: d.whyHim,
      canonicalUrl,
      sourceHost: sourceHost(canonicalUrl),
      sourcePublishedAt: d.item.publishedAt ?? d.item.createdAt,
      factsVerified,
      lastMessageFromUsAt: lastByContact.get(d.contact.id) ?? null,
      overridden: overridden.has(d.id),
    };
  });

  const pendingContactIds = new Set(pending.map((d) => d.contact.id));
  const quiet = profiles
    .filter((p) => !pendingContactIds.has(p.contact.id))
    .map((p) => ({
      contactId: p.contact.id,
      fullName: p.contact.fullName,
      company: p.contact.currentCompany,
      reason: quietText(
        deriveQuietReason({
          lastMessageAt: lastByContact.get(p.contact.id) ?? null,
          vetoedThisWeek: vetoedByContact.get(p.contact.id) ?? 0,
          now,
        })
      ),
    }));

  return NextResponse.json({
    firstName: (ctx.user.name ?? "").trim().split(/\s+/)[0] ?? "",
    scan: scan ? { scanned: scan.scanned, vetoed: scan.vetoed, finishedAt: scan.finishedAt } : null,
    drafts,
    quiet,
  });
});
