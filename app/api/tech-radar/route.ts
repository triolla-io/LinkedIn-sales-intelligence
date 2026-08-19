import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { isUsableProfile, type TechRadarProfile } from "@/lib/tech-radar/types";

const OPEN_DRAFT_STATUSES = ["PENDING_REVIEW", "PREPARING", "PREPARED"] as const;

/**
 * The whole screen in one call: the org's tracked companies, each carrying its own
 * profile and its own opportunities.
 *
 * Opportunities are nested under the company rather than served as a flat feed — a
 * technology only means anything next to the business it is meant for, and a mixed feed
 * forces the reader to re-establish that context on every card.
 *
 * Opportunities with no drafts are still returned: they carry the "no one to contact"
 * signal, which tells the rep where they need to acquire a contact.
 */
export const GET = withTenant(async (_req, ctx) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.effectiveUserId },
    select: { orgId: true },
  });

  const rows = await prisma.trackedCompany.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, aliases: true, website: true, linkedinUrl: true,
      status: true, profileError: true, researchedAt: true, lastScanAt: true,
      scanIntervalDays: true, profile: true,
      opportunities: {
        where: { status: { in: ["DISCOVERED", "DRAFTED"] } },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, fitRationale: true, businessLine: true, contactSuggestion: true, blockReason: true,
          score: true, status: true, createdAt: true,
          item: {
            select: {
              id: true, vendor: true, technology: true, title: true, summary: true,
              categories: true, sources: true, publishedAt: true, thin: true,
            },
          },
          drafts: {
            where: { ownerId: ctx.effectiveUserId, status: { in: [...OPEN_DRAFT_STATUSES] } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true, draftMessage: true, status: true, channel: true,
              contact: {
                select: { fullName: true, currentTitle: true, email: true, phone: true, linkedinUrl: true },
              },
            },
          },
        },
      },
    },
  });

  // The profile is exposed read-only so a strange opportunity can be traced back to the
  // query that produced it — the diagnostic surface that replaces an approval gate.
  const companies = rows.map((r) => {
    const profile = isUsableProfile(r.profile) ? (r.profile as TechRadarProfile) : null;
    return {
      ...r,
      profile: profile
        ? {
            businessLines: profile.businessLines,
            products: profile.products,
            techStack: profile.techStack,
            focusAreas: profile.focusAreas,
            searchQueries: profile.searchQueries,
            sources: profile.sources,
          }
        : null,
    };
  });

  return NextResponse.json({ companies });
});
