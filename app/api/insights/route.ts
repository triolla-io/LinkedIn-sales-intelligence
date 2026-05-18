import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

const COMPANY_SIZE_BUCKETS = [
  { label: "1-10", min: 1, max: 10 },
  { label: "11-50", min: 11, max: 50 },
  { label: "51-200", min: 51, max: 200 },
  { label: "201-1000", min: 201, max: 1000 },
  { label: "1001-10000", min: 1001, max: 10000 },
  { label: "10001+", min: 10001, max: 999_999_999 },
];

function parseArrayParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter(Boolean);
}

export const GET = withTenant(async (req, ctx) => {
  const url = req.nextUrl;
  const ownerId = ctx.effectiveUserId;

  // Mirror the same filter params as /api/contacts
  const seniority = parseArrayParam(url.searchParams.get("seniority"));
  const fn = parseArrayParam(url.searchParams.get("function"));
  const company = parseArrayParam(url.searchParams.get("company"));
  const q = url.searchParams.get("q") ?? undefined;

  const baseWhere: any = {
    ownerId,
    removedAt: null,
    ...(seniority?.length ? { seniority: { in: seniority as any } } : {}),
    ...(fn?.length ? { function: { in: fn as any } } : {}),
    ...(company?.length ? { currentCompany: { in: company } } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { headline: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [
    total,
    bySeniorityRaw,
    byFunctionRaw,
    topCompaniesRaw,
    withEmail,
    withPhone,
  ] = await Promise.all([
    prisma.contact.count({ where: baseWhere }),

    prisma.contact.groupBy({
      by: ["seniority"],
      where: baseWhere,
      _count: { _all: true },
    }),

    prisma.contact.groupBy({
      by: ["function"],
      where: baseWhere,
      _count: { _all: true },
    }),

    prisma.contact.groupBy({
      by: ["currentCompany"],
      where: { ...baseWhere, currentCompany: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { currentCompany: "desc" } },
      take: 5,
    }),

    prisma.contact.count({ where: { ...baseWhere, email: { not: null } } }),
    prisma.contact.count({ where: { ...baseWhere, phone: { not: null } } }),
  ]);

  const bySeniority: Record<string, number> = {};
  for (const row of bySeniorityRaw) {
    if (row.seniority) bySeniority[row.seniority] = row._count._all;
  }

  const byFunction: Record<string, number> = {};
  for (const row of byFunctionRaw) {
    if (row.function) byFunction[row.function] = row._count._all;
  }

  const topCompanies = topCompaniesRaw.map((r) => ({
    name: r.currentCompany!,
    count: r._count._all,
  }));

  // Company size histogram via parallel counts
  const sizeHistogram = await Promise.all(
    COMPANY_SIZE_BUCKETS.map(async ({ label, min, max }) => ({
      bucket: label,
      count: await prisma.contact.count({
        where: { ...baseWhere, companySize: { gte: min, lte: max } },
      }),
    }))
  );

  const coverage = {
    email: total > 0 ? Math.round((withEmail / total) * 100) : 0,
    phone: total > 0 ? Math.round((withPhone / total) * 100) : 0,
  };

  return NextResponse.json({
    total,
    bySeniority,
    byFunction,
    topCompanies,
    companySizeHistogram: sizeHistogram,
    coverage,
  });
});
