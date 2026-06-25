import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

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

  const contacts = await prisma.contact.findMany({
    where: buildSearchWhere(ctx.effectiveUserId, q, excludeListId),
    select: { id: true, fullName: true, currentTitle: true, currentCompany: true, email: true },
    orderBy: { fullName: "asc" },
    take: limit,
  });

  return NextResponse.json({ contacts });
});
