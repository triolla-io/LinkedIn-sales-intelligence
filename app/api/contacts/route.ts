import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { lookupContact } from "@/lib/hubspot/client";
import { buildContactWhere, parseArrayParam } from "@/lib/contacts/contact-where";
import { z } from "zod";

const querySchema = z.object({
  seniority: z.array(z.string()).optional(),
  function: z.array(z.string()).optional(),
  companySizeBuckets: z.array(z.string()).optional(),
  company: z.array(z.string()).optional(),
  location: z.array(z.string()).optional(),
  titleSearch: z.array(z.string()).optional(),
  industry: z.array(z.string()).optional(),
  hasEmail: z.enum(["true", "false"]).optional(),
  hasPhone: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  page: z.coerce.number().min(1).optional(),
  pageSize: z.coerce.number().min(1).max(500).optional(),
  listId: z.string().optional(),
  idsOnly: z.enum(["true", "false"]).optional(),
});

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
    hasEmail: (url.searchParams.get("hasEmail") as "true" | "false") ?? undefined,
    hasPhone: (url.searchParams.get("hasPhone") as "true" | "false") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? 50,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    listId: url.searchParams.get("listId") ?? undefined,
    idsOnly: (url.searchParams.get("idsOnly") as "true" | "false") ?? undefined,
  };

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 });
  }

  const params = parsed.data;

  const where = buildContactWhere(ctx.effectiveUserId, params);

  // IDs-only mode: return every matching contact id (across all pages) so the
  // table's "select all" can operate on the full filtered result set.
  if (params.idsOnly === "true") {
    const rows = await prisma.contact.findMany({
      where,
      orderBy: [{ lastSyncedAt: "desc" as const }, { id: "desc" as const }],
      select: { id: true },
    });
    return NextResponse.json({ ids: rows.map((r) => r.id) });
  }

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
    manualFields: true,
    hebrewFirstName: true,
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

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const fullName = typeof b.fullName === "string" ? b.fullName.trim() : "";
  if (!fullName) {
    return NextResponse.json({ error: "fullName is required" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const VALID_SENIORITY = ["C_LEVEL", "VP", "DIRECTOR", "MANAGER", "IC", "OTHER"];
  const seniority = typeof b.seniority === "string" && VALID_SENIORITY.includes(b.seniority)
    ? b.seniority
    : null;

  const manualFields: string[] = [];
  const fields: Record<string, string | null> = {
    hebrewFirstName: str(b.hebrewFirstName),
    linkedinUrl: str(b.linkedinUrl),
    email: str(b.email),
    phone: str(b.phone),
    currentTitle: str(b.currentTitle),
    currentCompany: str(b.currentCompany),
    location: str(b.location),
    headline: str(b.headline),
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) manualFields.push(k);
  }
  manualFields.push("fullName");

  const placeholderId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const linkedinUrl = fields.linkedinUrl ?? `https://linkedin.com/manual/${placeholderId}`;

  const hubspot = (!fields.email && !fields.phone)
    ? await lookupContact({ linkedinUrl, fullName, company: fields.currentCompany ?? undefined })
    : null;
  const email = fields.email ?? hubspot?.email ?? null;
  const phone = fields.phone ?? hubspot?.phone ?? null;
  const enrichmentFields = (hubspot?.email || hubspot?.phone)
    ? { enrichmentSource: "hubspot", enrichmentRanAt: new Date(), enrichedAt: new Date(), enrichmentError: null }
    : {};

  const contact = await prisma.contact.create({
    data: {
      ownerId: ctx.effectiveUserId,
      fullName,
      linkedinUrl,
      linkedinUrn: placeholderId,
      hebrewFirstName: fields.hebrewFirstName,
      email,
      phone,
      currentTitle: fields.currentTitle,
      currentCompany: fields.currentCompany,
      location: fields.location,
      headline: fields.headline,
      ...(seniority ? { seniority: seniority as any } : {}),
      lastSyncedAt: new Date(),
      manualFields,
      ...enrichmentFields,
    },
  });

  return NextResponse.json({ contact }, { status: 201 });
});
