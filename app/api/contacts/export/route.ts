import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

const COMPANY_SIZE_BUCKETS: Record<string, [number, number | null]> = {
  "1-10": [1, 10],
  "11-50": [11, 50],
  "51-200": [51, 200],
  "201-500": [201, 500],
  "501-1000": [501, 1000],
  "1001-5000": [1001, 5000],
  "5001+": [5001, null],
};

function parseArrayParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter(Boolean);
}

function escapeCsv(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export const GET = withTenant(async (req, ctx) => {
  const url = req.nextUrl;

  const q = url.searchParams.get("q") ?? undefined;
  const seniority = parseArrayParam(url.searchParams.get("seniority"));
  const fn = parseArrayParam(url.searchParams.get("function"));
  const titleSearch = parseArrayParam(url.searchParams.get("titleSearch"));
  const industry = parseArrayParam(url.searchParams.get("industry"));
  const companySizeBuckets = parseArrayParam(url.searchParams.get("companySizeBuckets"));
  const hasEmail = url.searchParams.get("hasEmail");
  const hasPhone = url.searchParams.get("hasPhone");
  const listId = url.searchParams.get("listId") ?? undefined;

  const sizeConditions =
    companySizeBuckets
      ?.map((bucket) => COMPANY_SIZE_BUCKETS[bucket])
      .filter(Boolean)
      .map(([min, max]) => {
        const range = max !== null ? { gte: min, lte: max } : { gte: min };
        return {
          OR: [
            { companySize: range },
            { company: { staffCount: range } },
          ],
        };
      }) ?? [];

  const andClauses: any[] = [];
  if (q) {
    andClauses.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { headline: { contains: q, mode: "insensitive" } },
        { currentCompany: { contains: q, mode: "insensitive" } },
        { currentTitle: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (titleSearch?.length) {
    andClauses.push({
      OR: titleSearch.map((t) => ({
        OR: [
          { currentTitle: { contains: t, mode: "insensitive" as const } },
          { headline: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    });
  }
  if (industry?.length) {
    andClauses.push({
      OR: industry.map((i) => ({
        industry: { contains: i, mode: "insensitive" as const },
      })),
    });
  }
  if (sizeConditions.length) {
    andClauses.push({ OR: sizeConditions });
  }

  const where: any = {
    ownerId: ctx.effectiveUserId,
    removedAt: null,
    ...(seniority?.length ? { seniority: { in: seniority as any } } : {}),
    ...(fn?.length ? { function: { in: fn as any } } : {}),
    ...(hasEmail === "true" ? { email: { not: null } } : {}),
    ...(hasPhone === "true" ? { phone: { not: null } } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
    ...(listId ? { lists: { some: { listId } } } : {}),
  };

  const rows = await prisma.contact.findMany({
    where,
    orderBy: [{ lastSyncedAt: "desc" }, { id: "desc" }],
    take: 50_000,
    select: {
      fullName: true,
      currentTitle: true,
      currentCompany: true,
      email: true,
      phone: true,
      location: true,
      industry: true,
      seniority: true,
      linkedinUrl: true,
    },
  });

  const headers = ["Name", "Title", "Company", "Email", "Phone", "Location", "Industry", "Seniority", "LinkedIn URL"];
  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((r) =>
      [
        r.fullName,
        r.currentTitle,
        r.currentCompany,
        r.email,
        r.phone,
        r.location,
        r.industry,
        r.seniority,
        r.linkedinUrl,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${date}.csv"`,
    },
  });
});
