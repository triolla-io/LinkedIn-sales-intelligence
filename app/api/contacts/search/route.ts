import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { rankSearchResults } from "@/lib/contacts/search-ranking";

// Rank a generous pool of matches (not just the first `limit` by name) so that
// relevance ordering can promote the contact the user actually typed. A single
// user's name-token search realistically matches far fewer than this.
const CANDIDATE_POOL = 200;

const SEARCH_FIELDS = [
  "fullName",
  "email",
  "currentCompany",
  "currentTitle",
  "hebrewFirstName",
] as const;

export function buildSearchWhere(ownerId: string, q: string, excludeListId?: string) {
  // Split into tokens so "אריאל טריולה" matches name + company in any order,
  // and each token matches across all searchable fields.
  const tokens = q.trim().split(/\s+/).filter(Boolean);

  const andClause = tokens.length
    ? tokens.map((token) => ({
        OR: SEARCH_FIELDS.map((field) => ({
          [field]: { contains: token, mode: "insensitive" as const },
        })),
      }))
    : undefined;

  return {
    ownerId,
    ...(andClause ? { AND: andClause } : {}),
    ...(excludeListId
      ? { lists: { none: { listId: excludeListId } } }
      : {}),
  };
}

export function parseSearchParams(params: URLSearchParams): {
  q: string;
  excludeListId: string | undefined;
  limit: number;
} {
  const q = params.get("q") ?? "";
  const excludeListId = params.get("excludeListId") ?? undefined;
  const rawLimit = Number(params.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
  return { q, excludeListId, limit };
}

export const GET = withTenant(async (req: NextRequest, ctx) => {
  const { q, excludeListId, limit } = parseSearchParams(req.nextUrl.searchParams);

  const pool = await prisma.contact.findMany({
    where: buildSearchWhere(ctx.effectiveUserId, q, excludeListId),
    select: {
      id: true,
      fullName: true,
      hebrewFirstName: true,
      currentTitle: true,
      currentCompany: true,
      email: true,
    },
    orderBy: { fullName: "asc" },
    take: CANDIDATE_POOL,
  });

  const contacts = rankSearchResults(pool, q).slice(0, limit);
  // The pool is capped, so more matches may exist beyond what we return; tell
  // the UI so it can prompt the user to narrow instead of silently hiding them.
  const hasMore = pool.length > contacts.length;

  return NextResponse.json({ contacts, hasMore });
});
