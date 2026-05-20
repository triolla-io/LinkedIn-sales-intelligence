import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const COMPANY_SIZE_BUCKETS: Record<string, [number, number]> = {
  "1-10": [1, 10],
  "11-50": [11, 50],
  "51-200": [51, 200],
  "201-1000": [201, 1000],
  "1001-10000": [1001, 10000],
  "10001+": [10001, Number.MAX_SAFE_INTEGER],
};

const querySchema = z.object({
  seniority: z.array(z.string()).optional(),
  function: z.array(z.string()).optional(),
  companySizeBuckets: z.array(z.string()).optional(),
  company: z.array(z.string()).optional(),
  location: z.array(z.string()).optional(),
  titleSearch: z.array(z.string()).optional(),
  industry: z.array(z.string()).optional(),
  connectedFrom: z.string().optional(),
  connectedTo: z.string().optional(),
  hasEmail: z.enum(["true", "false"]).optional(),
  hasPhone: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  page: z.coerce.number().min(1).optional(),
  pageSize: z.coerce.number().min(1).max(500).optional(),
});

function parseArrayParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter(Boolean);
}

export const GET = withTenant(async (req, ctx) => {
  const url = req.nextUrl;

  const raw = {
    seniority: parseArrayParam(url.searchParams.get("seniority")),
    function: parseArrayParam(url.searchParams.get("function")),
    companySizeBuckets: parseArrayParam(url.searchParams.get("companySizeBuckets")),
    company: parseArrayParam(url.searchParams.get("company")),
    location: parseArrayParam(url.searchParams.get("location")),
    titleSearch: parseArrayParam(url.searchParams.get("titleSearch")),
    industry: parseArrayParam(url.searchParams.get("industry")),
    connectedFrom: url.searchParams.get("connectedFrom") ?? undefined,
    connectedTo: url.searchParams.get("connectedTo") ?? undefined,
    hasEmail: (url.searchParams.get("hasEmail") as "true" | "false") ?? undefined,
    hasPhone: (url.searchParams.get("hasPhone") as "true" | "false") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? 50,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  };

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 });
  }

  const params = parsed.data;

  // Build company size OR conditions
  const sizeConditions =
    params.companySizeBuckets
      ?.map((bucket) => COMPANY_SIZE_BUCKETS[bucket])
      .filter(Boolean)
      .map(([min, max]) => ({ companySize: { gte: min, lte: max } })) ?? [];

  const where: any = {
    ownerId: ctx.effectiveUserId,
    removedAt: null,
    ...(params.seniority?.length ? { seniority: { in: params.seniority as any } } : {}),
    ...(params.function?.length ? { function: { in: params.function as any } } : {}),
    ...(params.company?.length ? { currentCompany: { in: params.company } } : {}),
    ...(params.location?.length ? { location: { in: params.location } } : {}),
    ...(params.connectedFrom || params.connectedTo
      ? {
          connectedAt: {
            ...(params.connectedFrom ? { gte: new Date(params.connectedFrom) } : {}),
            ...(params.connectedTo ? { lte: new Date(params.connectedTo) } : {}),
          },
        }
      : {}),
    ...(params.hasEmail === "true" ? { email: { not: null } } : {}),
    ...(params.hasEmail === "false" ? { email: null } : {}),
    ...(params.hasPhone === "true" ? { phone: { not: null } } : {}),
    ...(params.hasPhone === "false" ? { phone: null } : {}),
    ...(params.q
      ? {
          OR: [
            { fullName: { contains: params.q, mode: "insensitive" } },
            { headline: { contains: params.q, mode: "insensitive" } },
            { currentCompany: { contains: params.q, mode: "insensitive" } },
            { currentTitle: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(params.titleSearch?.length
      ? {
          OR: params.titleSearch.map((t) => ({
            OR: [
              { currentTitle: { contains: t, mode: "insensitive" as const } },
              { headline: { contains: t, mode: "insensitive" as const } },
            ],
          })),
        }
      : {}),
    ...(params.industry?.length
      ? {
          OR: params.industry.map((i) => ({
            industry: { contains: i, mode: "insensitive" as const },
          })),
        }
      : {}),
    ...(sizeConditions.length ? { OR: sizeConditions } : {}),
  };

  const usePageBased = params.page !== undefined && params.pageSize !== undefined;
  const pgSize = params.pageSize ?? params.limit;
  const pgSkip = usePageBased ? (params.page! - 1) * pgSize : 0;

  const orderBy = [{ lastSyncedAt: "desc" as const }, { id: "desc" as const }];

  const sharedSelect = {
    id: true,
    linkedinUrl: true,
    fullName: true,
    headline: true,
    currentTitle: true,
    currentCompany: true,
    companySize: true,
    seniority: true,
    function: true,
    location: true,
    industry: true,
    profilePicUrl: true,
    connectedAt: true,
    lastSyncedAt: true,
    email: true,
    phone: true,
    enrichedAt: true,
    company: { select: { staffCount: true, industry: true } },
  } as const;

  const [items, totalApprox] = await Promise.all([
    usePageBased
      ? prisma.contact.findMany({ where, orderBy, skip: pgSkip, take: pgSize, select: sharedSelect })
      : prisma.contact.findMany({
          where,
          orderBy,
          take: params.limit + 1,
          ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
          select: sharedSelect,
        }),
    prisma.contact.count({ where }),
  ]);

  const hasMore = usePageBased
    ? pgSkip + items.length < totalApprox
    : items.length > params.limit;
  const data = (!usePageBased && hasMore) ? items.slice(0, params.limit) : items;
  const nextCursor = (!usePageBased && hasMore) ? data[data.length - 1]?.id : null;

  return NextResponse.json({ items: data, nextCursor, totalApprox });
});
