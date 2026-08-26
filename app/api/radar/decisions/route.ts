import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";
import { deriveJourney } from "@/lib/tech-radar/journey";
import type { AxisStat } from "@/lib/tech-radar/person-scan";
import { pilotHoldEnabled, isPilotReviewer } from "@/lib/tech-radar/pilot-gate";

/**
 * How the system decided, per article.
 *
 * Deliberately includes what STOPPED. A screen built from survivors cannot tell a gate
 * that is working from one that rejects everything, and calibrating the gates is the
 * only reason this tab exists.
 */

function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export const GET = withTenant(async (_req, ctx) => {
  const profiles = await prisma.personProfile.findMany({
    where: { contact: { ownerId: ctx.effectiveUserId, removedAt: null } },
    select: {
      contact: { select: { id: true, fullName: true } },
      axes: { select: { mutedAt: true, axis: { select: { id: true, label: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Which person each axis belongs to. A shared axis legitimately maps to several, and
  // each of them gets their own row on the screen — that is what "per person" means.
  const peopleByAxis = new Map<string, { contactId: string; fullName: string }[]>();
  for (const p of profiles) {
    for (const a of p.axes) {
      if (a.mutedAt != null) continue; // a muted axis is not something he is watched for
      const list = peopleByAxis.get(a.axis.id) ?? [];
      list.push({ contactId: p.contact.id, fullName: p.contact.fullName });
      peopleByAxis.set(a.axis.id, list);
    }
  }
  const axisIds = [...peopleByAxis.keys()];

  // Pilot gate: a held draft's existence must not leak through this screen's journey
  // funnel — deriveJourney turns a draft's status into a visible step, so a held row has
  // to be excluded from the query itself, not merely hidden after the fact (2026-08-26
  // final review, Finding 3b).
  const holdsFromThisViewer = pilotHoldEnabled() && !isPilotReviewer(ctx.user.email);

  const [matches, drafts, run] = await Promise.all([
    axisIds.length
      ? prisma.axisMatch.findMany({
          // A match judged against an axis a rebuild retired is not the current
          // decision. (axisIds already comes from LIVE subscriptions, so this is the
          // belt to that braces: an axis can be retired for one person and live for
          // another, and the match itself carries the flag.)
          where: { axisId: { in: axisIds }, supersededAt: null },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            axisId: true,
            score: true,
            rationale: true,
            item: {
              select: { id: true, title: true, thin: true, shareworthy: true, stature: true, kind: true, sources: true },
            },
          },
        })
      : [],
    prisma.radarDraft.findMany({
      // Without this a stale veto attaches itself to an item that reaches the screen
      // through a DIFFERENT live axis, and reads as this week's decision.
      where: {
        ownerId: ctx.effectiveUserId,
        supersededAt: null,
        ...(holdsFromThisViewer ? { pilotHeldAt: null } : {}),
      },
      select: {
        id: true, contactId: true, axisId: true, itemId: true, status: true,
        whyHim: true, discardReason: true,
      },
    }),
    prisma.radarScanRun.findFirst({
      where: { orgId: ctx.org.id, finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      select: {
        scanned: true, topical: true, important: true, connected: true, drafts: true,
        finishedAt: true, axisStats: true, report: true,
      },
    }),
  ]);

  const draftFor = new Map(drafts.map((d) => [`${d.contactId}|${d.itemId}`, d]));

  // One row per (article × person it was judged for). The same article can stop for one
  // person and pass for another, and collapsing that would hide exactly the comparison
  // this screen exists to support.
  const items = matches.flatMap((m) =>
    (peopleByAxis.get(m.axisId) ?? []).map((person) => {
      const draft = draftFor.get(`${person.contactId}|${m.item.id}`) ?? null;
      const journey = deriveJourney({
        item: {
          thin: m.item.thin,
          shareworthy: m.item.shareworthy,
          stature: m.item.stature,
          kind: m.item.kind,
        },
        match: { score: m.score, rationale: m.rationale },
        draft: draft
          ? { status: draft.status, whyHim: draft.whyHim, discardReason: draft.discardReason }
          : null,
      });
      const url = firstSourceUrl(m.item.sources);
      return {
        itemId: m.item.id,
        title: m.item.title,
        url,
        sourceHost: sourceHost(url),
        snippetOnly: m.item.thin,
        person,
        journey,
        // Only a lift-able rejection carries an id; nothing else offers the button.
        draftId: journey.overridable && draft ? draft.id : null,
      };
    })
  );

  const stats = Array.isArray(run?.axisStats) ? (run.axisStats as unknown as AxisStat[]) : [];
  // How many items the hard freshness gate rejected before triage ever saw them — so a
  // week with zero results everywhere can say WHY instead of looking indistinguishable
  // from a broken radar.
  const report = run?.report as unknown as
    | {
        staleDropped?: number;
        undatedDropped?: number;
        articlesByLayer?: { layer1: number; layer3: number; layer4: number };
        expiredLayer3?: string[];
      }
    | null
    | undefined;

  return NextResponse.json({
    run: run
      ? {
          scanned: run.scanned,
          topical: run.topical,
          important: run.important,
          connected: run.connected,
          drafts: run.drafts,
          finishedAt: run.finishedAt,
          staleDropped: report?.staleDropped ?? 0,
          undatedDropped: report?.undatedDropped ?? 0,
          // Unlike staleDropped/undatedDropped above, these do NOT default — a run from
          // before the layer cake landed has no notion of layers at all, and a silent 0
          // would read as "nothing reached layer 1/3/4" rather than "this run predates
          // the concept". `undefined` here is dropped by JSON.stringify, so an old run's
          // payload simply omits the keys.
          articlesByLayer: report?.articlesByLayer,
          expiredLayer3: report?.expiredLayer3,
        }
      : null,
    items,
    people: profiles.map((p) => ({ contactId: p.contact.id, fullName: p.contact.fullName })),
    // Only the axes that came back with nothing. An axis that found things does not
    // belong in a section about silence.
    quietAxes: stats
      .filter((s) => s.results === 0)
      .map((s) => ({
        label: s.label,
        person: (peopleByAxis.get(s.axisId) ?? []).map((p) => p.fullName).join(", "),
        queries: s.queries,
        results: s.results,
        hebrewNoIsraeliSource: s.hebrewNoIsraeliSource,
      })),
  });
});
