import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import {
  buildContactWhere,
  withCondition,
  titleCondition,
  industryCondition,
  sizeCondition,
  parseArrayParam,
  type ContactFilterParams,
} from "@/lib/contacts/contact-where";
import {
  ROLE_PILLS,
  INDUSTRY_PILLS,
  COMPANY_SIZE_BUCKETS,
} from "@/lib/contacts/filter-options";

// Facet counts for the contacts filter sidebar. Each filter group is counted
// with all the OTHER groups' active filters applied but its own excluded, so
// the numbers answer "how many results would I get if I picked this option".

export const GET = withTenant(async (req, ctx) => {
  const url = req.nextUrl;

  const params: ContactFilterParams = {
    seniority: parseArrayParam(url.searchParams.get("seniority")),
    function: parseArrayParam(url.searchParams.get("function")),
    companySizeBuckets: parseArrayParam(url.searchParams.get("companySizeBuckets")),
    titleSearch: parseArrayParam(url.searchParams.get("titleSearch")),
    industry: parseArrayParam(url.searchParams.get("industry")),
    hasEmail: (url.searchParams.get("hasEmail") as "true" | "false") ?? undefined,
    hasPhone: (url.searchParams.get("hasPhone") as "true" | "false") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    listId: url.searchParams.get("listId") ?? undefined,
  };

  const owner = ctx.effectiveUserId;
  const whereNoRole = buildContactWhere(owner, params, ["role"]);
  const whereNoIndustry = buildContactWhere(owner, params, ["industry"]);
  const whereNoSize = buildContactWhere(owner, params, ["size"]);
  const whereNoContactInfo = buildContactWhere(owner, params, ["contactInfo"]);

  // Count the predefined pills plus any custom titles the user typed in.
  const titleValues = [
    ...new Set([
      ...ROLE_PILLS.filter((p) => p.filterKey === "titleSearch").map((p) => p.value),
      ...(params.titleSearch ?? []),
    ]),
  ];
  const functionValues = [
    ...new Set([
      ...ROLE_PILLS.filter((p) => p.filterKey === "function").map((p) => p.value),
      ...(params.function ?? []),
    ]),
  ];

  const [titleCounts, functionCounts, industryCounts, sizeCounts, hasEmail, hasPhone] =
    await Promise.all([
      Promise.all(
        titleValues.map((v) =>
          prisma.contact.count({ where: withCondition(whereNoRole, titleCondition(v)) })
        )
      ),
      Promise.all(
        functionValues.map((v) =>
          prisma.contact.count({
            where: withCondition(whereNoRole, { function: { in: [v] as any } }),
          })
        )
      ),
      Promise.all(
        INDUSTRY_PILLS.map((v) =>
          prisma.contact.count({
            where: withCondition(whereNoIndustry, industryCondition(v)),
          })
        )
      ),
      Promise.all(
        COMPANY_SIZE_BUCKETS.map((b) =>
          prisma.contact.count({
            where: withCondition(whereNoSize, sizeCondition(b.value)!),
          })
        )
      ),
      prisma.contact.count({
        where: withCondition(whereNoContactInfo, { email: { not: null } }),
      }),
      prisma.contact.count({
        where: withCondition(whereNoContactInfo, { phone: { not: null } }),
      }),
    ]);

  return NextResponse.json({
    titles: Object.fromEntries(titleValues.map((v, i) => [v, titleCounts[i]])),
    functions: Object.fromEntries(functionValues.map((v, i) => [v, functionCounts[i]])),
    industries: Object.fromEntries(INDUSTRY_PILLS.map((v, i) => [v, industryCounts[i]])),
    companySizes: Object.fromEntries(
      COMPANY_SIZE_BUCKETS.map((b, i) => [b.value, sizeCounts[i]])
    ),
    hasEmail,
    hasPhone,
  });
});
