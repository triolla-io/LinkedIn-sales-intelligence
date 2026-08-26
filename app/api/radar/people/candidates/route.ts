import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

/**
 * Contacts that could join the radar, searched in the DATABASE.
 *
 * The first version shipped the first 500 contacts to the browser and filtered there.
 * The pilot owner has 22,919 contacts, so that was 2% of the list in alphabetical
 * order: anyone late in the alphabet was unfindable no matter what you typed, and
 * nothing on screen said the list had been cut. Both halves of that were the bug.
 *
 * Separate from /api/radar/people on purpose: the people list polls while a person is
 * being prepared, and keystrokes must not drag that payload along behind them.
 */

/** One screenful. More than this is not browsable — it is a prompt to search better. */
export const CANDIDATE_PAGE = 50;

export const GET = withTenant(async (req: NextRequest, ctx) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  // With 23k contacts an alphabetical top-50 is noise. Ask for a name instead of
  // pretending the first page means anything.
  if (!q) {
    return NextResponse.json({ candidates: [], total: 0, truncated: false, needsQuery: true });
  }

  const where = {
    ownerId: ctx.effectiveUserId,
    removedAt: null,
    // Not already tracked. `radarInclude` is nullable: null means "follow the automatic
    // rule", which is still not on the radar.
    OR: [{ radarInclude: false }, { radarInclude: null }],
    AND: [
      {
        OR: [
          { fullName: { contains: q, mode: "insensitive" as const } },
          { currentTitle: { contains: q, mode: "insensitive" as const } },
          { currentCompany: { contains: q, mode: "insensitive" as const } },
        ],
      },
    ],
  };

  const [candidates, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { fullName: "asc" },
      take: CANDIDATE_PAGE,
      select: { id: true, fullName: true, currentTitle: true, currentCompany: true },
    }),
    prisma.contact.count({ where }),
  ]);

  return NextResponse.json({
    candidates,
    total,
    // Said out loud, so a missing name reads as "narrow the search", not "not in the system".
    truncated: total > candidates.length,
    needsQuery: false,
  });
});
