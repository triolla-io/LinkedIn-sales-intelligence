import { COMPANY_SIZE_BUCKETS } from "./filter-options";
import { expandRoleQuery } from "@/lib/roles/families";

// Prisma where-clause builder shared by /api/contacts (listing) and
// /api/contacts/facets (option counts). Facet counts for a group are computed
// with that group's own selections excluded (standard faceted-search UX), so
// the builder supports excluding filter groups.

export type ContactFilterParams = {
  seniority?: string[];
  function?: string[];
  companySizeBuckets?: string[];
  company?: string[];
  location?: string[];
  titleSearch?: string[];
  industry?: string[];
  hasEmail?: "true" | "false";
  hasPhone?: "true" | "false";
  q?: string;
  listId?: string;
};

export type FacetGroup = "role" | "industry" | "size" | "contactInfo";

export function titleCondition(t: string) {
  // Role pills expand to their whole family (CPO also matches
  // "Chief Product Officer", סמנכ"ל מוצר…). Unknown titles keep
  // plain substring behavior; the literal term is always included.
  const terms = [...new Set([t.toLowerCase(), ...(expandRoleQuery(t) ?? []).map((p) => p.toLowerCase())])];
  return {
    OR: terms.flatMap((term) => [
      { currentTitle: { contains: term, mode: "insensitive" as const } },
      { headline: { contains: term, mode: "insensitive" as const } },
    ]),
  };
}

export function industryCondition(i: string) {
  return { industry: { contains: i, mode: "insensitive" as const } };
}

export function sizeCondition(bucket: string) {
  const def = COMPANY_SIZE_BUCKETS.find((b) => b.value === bucket);
  if (!def) return null;
  const range = def.max !== null ? { gte: def.min, lte: def.max } : { gte: def.min };
  // Match either Apollo's companySize or LinkedIn's staffCount
  return {
    OR: [
      { companySize: range },
      { company: { staffCount: range } },
    ],
  };
}

/** Append an extra condition to a where clause's AND list. */
export function withCondition(where: any, condition: any) {
  return { ...where, AND: [...(where.AND ?? []), condition] };
}

export function buildContactWhere(
  ownerId: string,
  params: ContactFilterParams,
  exclude: FacetGroup[] = []
) {
  const skip = new Set(exclude);
  const andClauses: any[] = [];

  if (params.q) {
    // Role-like queries widen to the whole family, but the literal clauses
    // stay first so searching "product" still finds e.g. company "Product Inc".
    const rolePatterns = expandRoleQuery(params.q) ?? [];
    andClauses.push({
      OR: [
        { fullName: { contains: params.q, mode: "insensitive" } },
        { headline: { contains: params.q, mode: "insensitive" } },
        { currentCompany: { contains: params.q, mode: "insensitive" } },
        { currentTitle: { contains: params.q, mode: "insensitive" } },
        ...rolePatterns.flatMap((p) => [
          { currentTitle: { contains: p, mode: "insensitive" as const } },
          { headline: { contains: p, mode: "insensitive" as const } },
        ]),
      ],
    });
  }

  // Role/function pills (title-search pills like "CEO" and the function pills
  // "HR"/"Sales") share ONE OR group, so selecting several roles widens the
  // result set instead of intersecting. Without this, picking a title pill AND
  // a function pill would AND two different fields and collapse to ~empty —
  // which read as the other filters being "cancelled".
  if (!skip.has("role")) {
    const roleOr: any[] = [];
    if (params.function?.length) {
      roleOr.push({ function: { in: params.function as any } });
    }
    for (const t of params.titleSearch ?? []) {
      roleOr.push(titleCondition(t));
    }
    if (roleOr.length) {
      andClauses.push({ OR: roleOr });
    }
  }

  if (!skip.has("industry") && params.industry?.length) {
    andClauses.push({ OR: params.industry.map(industryCondition) });
  }

  if (!skip.has("size")) {
    const sizeConditions = (params.companySizeBuckets ?? []).flatMap((b) => {
      const c = sizeCondition(b);
      return c ? [c] : [];
    });
    if (sizeConditions.length) {
      andClauses.push({ OR: sizeConditions });
    }
  }

  const contactInfo = skip.has("contactInfo")
    ? {}
    : {
        ...(params.hasEmail === "true" ? { email: { not: null } } : {}),
        ...(params.hasEmail === "false" ? { email: null } : {}),
        ...(params.hasPhone === "true" ? { phone: { not: null } } : {}),
        ...(params.hasPhone === "false" ? { phone: null } : {}),
      };

  const where: any = {
    ownerId,
    removedAt: null,
    ...(params.seniority?.length ? { seniority: { in: params.seniority as any } } : {}),
    ...(params.company?.length ? { currentCompany: { in: params.company } } : {}),
    ...(params.location?.length ? { location: { in: params.location } } : {}),
    ...contactInfo,
    ...(andClauses.length ? { AND: andClauses } : {}),
    ...(params.listId
      ? {
          lists: {
            some: { listId: params.listId },
          },
        }
      : {}),
  };

  return where;
}

export function parseArrayParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter(Boolean);
}
