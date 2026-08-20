import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

/**
 * Hand-marking contacts for a person-first radar run.
 *
 * `Contact.radarInclude` is tri-state: null follows the automatic cohort rule, true
 * always includes (and bypasses the seniority gate — see lib/tech-radar/create-drafts.ts),
 * false never contacts. This route is the only writer.
 *
 * Deliberately NOT gated behind techRadarEnabled, for the same reason as the cohort
 * route: choosing who to test on is what a rep does BEFORE turning the module on.
 */

const SELECT = {
  id: true,
  fullName: true,
  currentTitle: true,
  currentCompany: true,
  radarInclude: true,
} as const;

/** Search results are bounded: the pilot owner has 16,250 contacts. */
const SEARCH_LIMIT = 15;

/**
 * `?q=` searches candidates by name; without it, returns everyone carrying an explicit
 * mark. Both are scoped to the effective user — never the raw session — so the list
 * respects impersonation like every other query in this feature.
 */
export const GET = withTenant(async (req: NextRequest, ctx) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  if (q) {
    const candidates = await prisma.contact.findMany({
      where: {
        ownerId: ctx.effectiveUserId,
        removedAt: null,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { currentCompany: { contains: q, mode: "insensitive" } },
        ],
      },
      select: SELECT,
      orderBy: { fullName: "asc" },
      take: SEARCH_LIMIT,
    });
    return NextResponse.json({ candidates });
  }

  const marked = await prisma.contact.findMany({
    where: { ownerId: ctx.effectiveUserId, removedAt: null, NOT: { radarInclude: null } },
    select: SELECT,
    orderBy: { fullName: "asc" },
  });
  return NextResponse.json({ marked });
});

type Body = { contactId?: unknown; radarInclude?: unknown };

/**
 * Set or clear one contact's mark. `radarInclude` accepts true, false, or null; anything
 * else is rejected rather than coerced, because silently turning a bad value into `false`
 * would mean "never contact this person" — the most damaging of the three states.
 */
export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const body = (await req.json()) as Body;
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const value = body.radarInclude;

  if (!contactId) return NextResponse.json({ error: "contactId_required" }, { status: 400 });
  if (value !== true && value !== false && value !== null) {
    return NextResponse.json({ error: "radarInclude_must_be_true_false_or_null" }, { status: 400 });
  }

  // updateMany with the owner in the WHERE is the tenancy guard: a contact belonging to
  // someone else matches nothing and reports 0, rather than being updated.
  const res = await prisma.contact.updateMany({
    where: { id: contactId, ownerId: ctx.effectiveUserId, removedAt: null },
    data: { radarInclude: value },
  });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, radarInclude: value });
});
