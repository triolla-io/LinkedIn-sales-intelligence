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
      id: true, name: true, aliases: true, website: true, linkedinUrl: true,
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
  aliases?: string[];
  website?: string | null;
  linkedinUrl?: string | null;
};

/** Trim, drop blanks, and de-duplicate case-insensitively. */
function cleanAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.slice(0, 10);
}

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json()) as PostBody;
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

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
      aliases: cleanAliases(body.aliases),
      website: (body.website ?? "").trim() || null,
      linkedinUrl: (body.linkedinUrl ?? "").trim() || null,
      status: "PENDING_RESEARCH",
    },
    select: { id: true },
  });

  await inngest.send({ name: "tech-radar.company.research" as const, data: { trackedCompanyId: company.id } });
  return NextResponse.json({ ok: true, id: company.id });
});
