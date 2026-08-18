import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { isUsableProfile, type TechRadarProfile } from "@/lib/tech-radar/types";

/** The tracked-company list is org-scoped: everyone in the org works the same accounts. */
async function orgIdFor(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { orgId: true } });
  return user.orgId;
}

export const GET = withTenant(async (_req, ctx) => {
  const orgId = await orgIdFor(ctx.effectiveUserId);
  const rows = await prisma.trackedCompany.findMany({
    where: { orgId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, website: true, linkedinUrl: true, relationship: true,
      status: true, profileError: true, researchedAt: true, lastScanAt: true,
      scanIntervalDays: true, profile: true,
      _count: { select: { opportunities: true } },
    },
  });

  // The profile is shown read-only so a strange opportunity can be traced back to the
  // query that produced it — the diagnostic transparency that replaces an approval gate.
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

type PostBody = {
  name?: string;
  website?: string | null;
  linkedinUrl?: string | null;
  relationship?: "CUSTOMER" | "PROSPECT";
};

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json()) as PostBody;
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (body.relationship && !["CUSTOMER", "PROSPECT"].includes(body.relationship)) {
    return NextResponse.json({ error: "invalid_relationship" }, { status: 400 });
  }

  const orgId = await orgIdFor(ctx.effectiveUserId);
  const existing = await prisma.trackedCompany.findUnique({
    where: { orgId_name: { orgId, name } },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "already_tracked", id: existing.id }, { status: 409 });

  const company = await prisma.trackedCompany.create({
    data: {
      orgId,
      name,
      website: (body.website ?? "").trim() || null,
      linkedinUrl: (body.linkedinUrl ?? "").trim() || null,
      relationship: body.relationship ?? "PROSPECT",
      status: "PENDING_RESEARCH",
    },
    select: { id: true },
  });

  await inngest.send({ name: "tech-radar.company.research" as const, data: { trackedCompanyId: company.id } });
  return NextResponse.json({ ok: true, id: company.id });
});
