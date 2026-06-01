import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export function buildSearchWhere(ownerId: string, q: string, excludeListId?: string) {
  const orClause = q.trim()
    ? [
        { name: { contains: q.trim(), mode: "insensitive" as const } },
        { email: { contains: q.trim(), mode: "insensitive" as const } },
      ]
    : undefined;

  return {
    ownerId,
    ...(orClause ? { OR: orClause } : {}),
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
