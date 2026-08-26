import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { derivePrepStatus } from "@/lib/tech-radar/prep-status";
import { findEmployer, NEXT_SCAN_LABEL } from "../route";

/**
 * One person: what the system thinks interests them, and the ability to correct it.
 *
 * Axis provenance reaches the screen in human words — the enum names (ROLE_COMPANY,
 * COMPANY_MONITOR) are internal vocabulary and are translated here, once.
 *
 * Muting never deletes. A deleted axis takes its reason with it; a muted one stays
 * explicable, and a rebuild can respect the correction.
 */

const AXIS_SOURCE: Record<string, "role" | "company"> = {
  ROLE_COMPANY: "role",
  COMPANY_MONITOR: "company",
};

/** Screen copy for a draft's fate. The only place this mapping lives. */
function statusText(d: { status: string; whyHim: string | null; discardReason: string | null }): string {
  switch (d.status) {
    case "PENDING_REVIEW":
    case "PREPARING":
    case "PREPARED":
      return "ממתינה לאישור";
    case "SENT":
      return "נשלחה";
    case "VETOED":
      return d.whyHim ? `לא נשלח — ${d.whyHim}` : "לא נשלח — הקשר לא היה אישי מספיק";
    case "DISMISSED":
      return d.discardReason ? `דילגת — ${DISMISS_HE[d.discardReason] ?? d.discardReason}` : "דילגת";
    default:
      return d.status;
  }
}

const DISMISS_HE: Record<string, string> = {
  not_interesting: "לא מעניין אותו",
  not_now: "לא הזמן",
  weak_source: "מקור חלש",
};

const WEEK_MS = 7 * 864e5;

async function loadPerson(contactId: string, ownerId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, ownerId, removedAt: null },
    select: {
      id: true, fullName: true, currentTitle: true, currentCompany: true, companyId: true,
      linkedinUrl: true, messageLanguage: true, radarInclude: true, radarAddedAt: true,
      personProfile: {
        select: {
          id: true,
          axes: {
            select: {
              id: true, mutedAt: true, source: true,
              axis: { select: { id: true, label: true } },
            },
          },
        },
      },
    },
  });
}

function contactIdFrom(req: NextRequest): string {
  return req.nextUrl.pathname.split("/").at(-1)!;
}

export const GET = withTenant(async (req: NextRequest, ctx) => {
  const contact = await loadPerson(contactIdFrom(req), ctx.effectiveUserId);
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const axes = contact.personProfile?.axes ?? [];
  const axisIds = axes.map((a) => a.axis.id);

  const [employers, drafts, matches, lastMsg] = await Promise.all([
    prisma.trackedCompany.findMany({
      where: { orgId: ctx.org.id },
      select: { id: true, name: true, aliases: true, status: true, profileError: true, companyId: true, profile: true },
    }),
    prisma.radarDraft.findMany({
      where: { contactId: contact.id, ownerId: ctx.effectiveUserId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, status: true, whyHim: true, discardReason: true, createdAt: true,
        item: { select: { title: true } },
      },
    }),
    axisIds.length
      ? prisma.axisMatch.groupBy({
          by: ["axisId"],
          where: { axisId: { in: axisIds }, createdAt: { gte: new Date(Date.now() - WEEK_MS) } },
          _count: { _all: true },
        })
      : [],
    prisma.sentMessage.groupBy({
      by: ["contactId"],
      where: { contactId: contact.id },
      _max: { sentAt: true },
    }),
  ]);

  const foundByAxis = new Map(matches.map((m) => [m.axisId, m._count._all]));
  const employer = findEmployer(contact, employers);
  const live = axes.filter((a) => a.mutedAt == null);

  return NextResponse.json({
    contactId: contact.id,
    fullName: contact.fullName,
    currentTitle: contact.currentTitle,
    currentCompany: contact.currentCompany,
    linkedinUrl: contact.linkedinUrl,
    messageLanguage: contact.messageLanguage === "en" ? "en" : "he",
    active: contact.radarInclude === true,
    lastMessageFromUsAt: lastMsg[0]?._max.sentAt ?? null,
    // The research's explicit "no direct competitors" finding, with its reason — shown
    // so a human can correct the model when it is wrong. Null when competitors exist.
    employerFinding: (() => {
      const p = employer?.profile as { noClearCompetitors?: unknown; noCompetitorsReason?: unknown } | null;
      return p?.noClearCompetitors === true
        ? { noClearCompetitors: true, reason: typeof p.noCompetitorsReason === "string" ? p.noCompetitorsReason : "" }
        : null;
    })(),
    prep: derivePrepStatus({
      radarAddedAt: contact.radarAddedAt,
      hasEmployer: employer != null,
      employerStatus: employer?.status ?? null,
      employerError: employer?.profileError ?? null,
      axisCount: live.length,
      hasProfile: contact.personProfile != null,
      nextScanLabel: NEXT_SCAN_LABEL,
      now: new Date(),
    }),
    axes: axes.map((a) => ({
      id: a.id,
      label: a.axis.label,
      source: AXIS_SOURCE[a.source] ?? "role",
      muted: a.mutedAt != null,
      itemsFound: foundByAxis.get(a.axis.id) ?? 0,
    })),
    history: drafts.map((d) => ({
      id: d.id,
      status: d.status,
      statusText: statusText(d),
      itemTitle: d.item.title,
      at: d.createdAt,
    })),
  });
});

type Body =
  | { action: "language"; value: string }
  | { action: "active"; value: boolean }
  | { action: "muteAxis"; personAxisId: string; muted: boolean };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const contact = await loadPerson(contactIdFrom(req), ctx.effectiveUserId);
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json()) as Body;

  if (body.action === "language") {
    if (body.value !== "he" && body.value !== "en") {
      return NextResponse.json({ error: "invalid_language" }, { status: 400 });
    }
    await prisma.contact.update({ where: { id: contact.id }, data: { messageLanguage: body.value } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "active") {
    if (typeof body.value !== "boolean") {
      return NextResponse.json({ error: "invalid_value" }, { status: 400 });
    }
    // The person and their history stay; only future scanning stops.
    await prisma.contact.update({ where: { id: contact.id }, data: { radarInclude: body.value } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "muteAxis") {
    // Scoped through this person's profile: an axis id from another person must not be
    // mutable through their page.
    const owned = contact.personProfile
      ? await prisma.personAxis.findFirst({
          where: { id: body.personAxisId, personProfileId: contact.personProfile.id },
          select: { id: true },
        })
      : null;
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await prisma.personAxis.update({
      where: { id: owned.id },
      data: { mutedAt: body.muted ? new Date() : null },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
});
