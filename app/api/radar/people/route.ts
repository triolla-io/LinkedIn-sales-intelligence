import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { matchExistingCompany } from "@/lib/tech-radar/population";
import { derivePrepStatus } from "@/lib/tech-radar/prep-status";
import { pilotHoldEnabled, isPilotReviewer } from "@/lib/tech-radar/pilot-gate";

/**
 * The people on the radar, and the contacts who could join them.
 *
 * Adding someone fires `radar.person.prepare` — the SCOPED pipeline. It is the only
 * place in the UI that spends research money, so it is deliberately one person per
 * click, and re-adding an already-tracked person is refused rather than paying twice.
 */

/**
 * The person-outward scan has no cron: during the pilot it is run by hand. Saying
 * "ראשון בבוקר" here would invent a schedule that does not exist — the screen may only
 * promise what the system actually does.
 */
export const NEXT_SCAN_LABEL = "בסריקה הבאה שתריצי";

const PROFILE_SELECT = {
  id: true,
  axes: {
    select: {
      id: true,
      mutedAt: true,
      source: true,
      axis: { select: { id: true, label: true } },
    },
  },
} as const;

export const GET = withTenant(async (_req, ctx) => {
  const now = new Date();

  // Candidates live at ./candidates and are searched in the database — this list polls
  // while someone is being prepared, and must not carry an address book behind it.
  const [people, employers] = await Promise.all([
    prisma.contact.findMany({
      where: { ownerId: ctx.effectiveUserId, removedAt: null, radarInclude: true },
      orderBy: { fullName: "asc" },
      select: {
        id: true, fullName: true, currentTitle: true, currentCompany: true, companyId: true,
        radarInclude: true, radarAddedAt: true,
        personProfile: { select: PROFILE_SELECT },
      },
    }),
    prisma.trackedCompany.findMany({
      where: { orgId: ctx.org.id },
      select: { id: true, name: true, aliases: true, status: true, profileError: true, companyId: true },
    }),
  ]);

  // Pilot gate: a held draft must not inflate the "X ממתין" count shown for a contact on
  // this tab — the count has to match what the owner can actually see and act on
  // (2026-08-26 final review, Finding 3c).
  const holdsFromThisViewer = pilotHoldEnabled() && !isPilotReviewer(ctx.user.email);

  const pendingByContact = new Map(
    (
      await prisma.radarDraft.groupBy({
        by: ["contactId"],
        where: {
          ownerId: ctx.effectiveUserId,
          status: { in: ["PENDING_REVIEW", "PREPARING", "PREPARED"] },
          ...(holdsFromThisViewer ? { pilotHeldAt: null } : {}),
        },
        _count: { _all: true },
      })
    ).map((r) => [r.contactId, r._count._all])
  );

  return NextResponse.json({
    people: people.map((c) => {
      const employer = findEmployer(c, employers);
      const axes = c.personProfile?.axes ?? [];
      const live = axes.filter((a) => a.mutedAt == null);
      // The shared industry net (layer 1) is not one of THIS person's own axes for the
      // purpose of "was this person modelled" — see the comment on derivePrepStatus's
      // axisCount param.
      const ownAxisCount = live.filter((a) => a.source !== "INDUSTRY").length;
      return {
        contactId: c.id,
        fullName: c.fullName,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        active: c.radarInclude === true,
        axisCount: live.length,
        pendingDrafts: pendingByContact.get(c.id) ?? 0,
        prep: derivePrepStatus({
          radarAddedAt: c.radarAddedAt,
          hasEmployer: employer != null,
          employerStatus: employer?.status ?? null,
          employerError: employer?.profileError ?? null,
          axisCount: ownAxisCount,
          hasProfile: c.personProfile != null,
          nextScanLabel: NEXT_SCAN_LABEL,
          now,
        }),
      };
    }),
  });
});

/** The same normalized match the population pipeline uses — never a second implementation. */
export function findEmployer<T extends { id: string; name: string; aliases: string[]; companyId: string | null }>(
  contact: { currentCompany: string | null; companyId: string | null },
  employers: T[]
): T | null {
  if (contact.companyId != null) {
    const byId = employers.find((e) => e.companyId === contact.companyId);
    if (byId) return byId;
  }
  const id = matchExistingCompany(
    { companyId: contact.companyId, name: contact.currentCompany ?? "", staffCount: null, website: null },
    employers
  );
  return id ? (employers.find((e) => e.id === id) ?? null) : null;
}

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json()) as { contactId?: string; retry?: boolean };
  const contactId = typeof body.contactId === "string" ? body.contactId : "";
  if (!contactId) return NextResponse.json({ error: "missing_contact" }, { status: 400 });

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: ctx.effectiveUserId, removedAt: null },
    select: { id: true, radarInclude: true },
  });
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Re-adding someone already tracked would pay for their employer research a second
  // time. Retry is the explicit way to ask for that.
  if (contact.radarInclude === true && body.retry !== true) {
    return NextResponse.json({ error: "already_tracked" }, { status: 409 });
  }

  // radarAddedAt is also the stall clock, so a retry restarts it — otherwise the card
  // would report "stuck" the instant it was retried.
  await prisma.contact.update({
    where: { id: contact.id },
    data: { radarInclude: true, radarAddedAt: new Date() },
  });

  await inngest.send({
    name: "radar.person.prepare",
    data: { orgId: ctx.org.id, ownerId: ctx.effectiveUserId, contactId: contact.id },
  });

  return NextResponse.json({ ok: true });
});
