import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

/**
 * The person-outward review screen, in one call.
 *
 * Grouped by PERSON, not by company. That is not a display preference: the whole point
 * of v2 is that relevance belongs to a person, and a company-grouped feed re-establishes
 * exactly the frame that produced three identical drafts to three founders.
 *
 * Vetoed candidates are returned alongside accepted ones. A screen that shows only what
 * passed cannot tell a working gate from one that is too strict, and the veto rate is
 * the pilot's central health metric — it belongs on the screen, not in a query someone
 * has to think to run.
 */
export const GET = withTenant(async (_req, ctx) => {
  const profiles = await prisma.personProfile.findMany({
    where: { contact: { ownerId: ctx.effectiveUserId, removedAt: null } },
    select: {
      id: true,
      roleLens: true,
      personalNotes: true,
      refreshedAt: true,
      contact: {
        select: { id: true, fullName: true, currentTitle: true, currentCompany: true, linkedinUrl: true },
      },
      axes: {
        select: {
          weight: true,
          rationale: true,
          axis: {
            select: { id: true, label: true, kind: true, subscriberCount: true, searchQueries: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const contactIds = profiles.map((p) => p.contact.id);
  const axisIds = [...new Set(profiles.flatMap((p) => p.axes.map((a) => a.axis.id)))];

  const [drafts, matches] = await Promise.all([
    prisma.radarDraft.findMany({
      where: { contactId: { in: contactIds } },
      select: {
        id: true, contactId: true, axisId: true, status: true, draftMessage: true,
        whyHim: true, confidence: true, discardReason: true, createdAt: true,
        item: { select: { id: true, title: true, summary: true, kind: true, shareworthy: true, sources: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Matches with no draft are the interesting middle: the axis found something and
    // nobody was chosen for it. Without them the screen cannot distinguish "found
    // nothing" from "found something and stopped".
    prisma.axisMatch.findMany({
      where: { axisId: { in: axisIds } },
      select: {
        axisId: true, score: true, rationale: true,
        item: { select: { id: true, title: true, kind: true, shareworthy: true } },
      },
      orderBy: { score: "desc" },
    }),
  ]);

  const draftsByContact = new Map<string, typeof drafts>();
  for (const d of drafts) {
    const list = draftsByContact.get(d.contactId);
    if (list) list.push(d);
    else draftsByContact.set(d.contactId, [d]);
  }
  const matchesByAxis = new Map<string, typeof matches>();
  for (const m of matches) {
    const list = matchesByAxis.get(m.axisId);
    if (list) list.push(m);
    else matchesByAxis.set(m.axisId, [m]);
  }

  const people = profiles.map((p) => {
    const mine = draftsByContact.get(p.contact.id) ?? [];
    return {
      contactId: p.contact.id,
      fullName: p.contact.fullName,
      currentTitle: p.contact.currentTitle,
      currentCompany: p.contact.currentCompany,
      linkedinUrl: p.contact.linkedinUrl,
      roleLens: p.roleLens,
      personalNotes: p.personalNotes,
      axes: p.axes.map((a) => ({
        id: a.axis.id,
        label: a.axis.label,
        kind: a.axis.kind,
        // How many people share this axis — the number that says whether the catalog is
        // pooling interests or minting one axis per person.
        subscribers: a.axis.subscriberCount,
        weight: a.weight,
        rationale: a.rationale,
        matches: (matchesByAxis.get(a.axis.id) ?? []).slice(0, 5).map((m) => ({
          itemId: m.item.id,
          title: m.item.title,
          kind: m.item.kind,
          shareworthy: m.item.shareworthy,
          score: m.score,
          rationale: m.rationale,
        })),
      })),
      drafts: mine.map((d) => ({
        id: d.id,
        status: d.status,
        message: d.draftMessage,
        whyHim: d.whyHim,
        confidence: d.confidence,
        discardReason: d.discardReason,
        item: { title: d.item.title, kind: d.item.kind, url: firstUrl(d.item.sources) },
      })),
    };
  });

  // So a page opened mid-run can show WHEN it last saw anything, rather than showing
  // emptiness that is indistinguishable from a scan that found nothing.
  const newest = await prisma.techItem.findFirst({
    where: { axisMatches: { some: { axisId: { in: axisIds } } } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const vetoed = drafts.filter((d) => d.status === "VETOED").length;
  const accepted = drafts.length - vetoed;

  return NextResponse.json({
    people,
    health: {
      lastItemAt: newest?.createdAt ?? null,
      people: people.length,
      axes: axisIds.length,
      // The catalog is only pooling interests if some axes have more than one subscriber.
      sharedAxes: [...new Set(profiles.flatMap((p) => p.axes.filter((a) => a.axis.subscriberCount > 1).map((a) => a.axis.id)))].length,
      matches: matches.length,
      accepted,
      vetoed,
      /** The pilot's central metric. Near zero means the gate is lenient; near one means the axes are too broad. */
      vetoRate: accepted + vetoed > 0 ? vetoed / (accepted + vetoed) : null,
    },
  });
});

function firstUrl(sources: unknown): string | null {
  if (!Array.isArray(sources)) return null;
  for (const s of sources) {
    const url = (s as { url?: unknown })?.url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}
