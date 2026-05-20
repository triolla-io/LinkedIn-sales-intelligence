import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { slugifyCompany } from "@/lib/utils/slug-utils";
import { getIndustry } from "@/lib/classifier/industry";

/**
 * POST /api/import/companies
 * Accepts a CSV with Company + Company_Size columns (e.g. unique_companies.csv).
 * 1. Upserts company rows with staffCount + industry.
 * 2. Backfills the calling user's contacts: links companyId, fills companySize + industry.
 */

function parseCsv(text: string): Array<Record<string, string>> {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return NextResponse.json({ error: "File appears empty" }, { status: 400 });

  // Validate columns
  const sample = rows[0];
  const hasCompany = "Company" in sample || "company" in sample;
  if (!hasCompany) {
    return NextResponse.json(
      { error: "Could not find Company column. Make sure this is a unique_companies.csv file." },
      { status: 400 },
    );
  }

  // --- Step 1: Upsert company rows ---
  const CHUNK = 100;
  let upserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const entries: Array<{ slug: string; name: string; staffCount: number | null; industry: string | null }> = [];

    for (const row of chunk) {
      const name = (row["Company"] ?? row["company"] ?? "").trim();
      if (!name) { skipped++; continue; }
      const slug = slugifyCompany(name);
      if (!slug) { skipped++; continue; }
      const sizeRaw = (row["Company_Size"] ?? row["company_size"] ?? "").trim();
      const staffCount = sizeRaw ? (parseInt(sizeRaw, 10) || null) : null;
      const industry = getIndustry(name) || null;
      entries.push({ slug, name, staffCount, industry });
    }

    await prisma.$transaction(
      entries.map(({ slug, name, staffCount, industry }) =>
        prisma.company.upsert({
          where: { universalName: slug },
          update: {
            ...(staffCount != null ? { staffCount } : {}),
            ...(industry ? { industry } : {}),
          },
          create: {
            universalName: slug,
            name,
            ...(staffCount != null ? { staffCount } : {}),
            ...(industry ? { industry } : {}),
          },
        }),
      ),
    );

    upserted += entries.length;
  }

  // --- Step 2: Backfill this user's contacts ---
  const userId = ctx.effectiveUserId;

  const contacts = await prisma.contact.findMany({
    where: { ownerId: userId, removedAt: null, currentCompany: { not: null } },
    select: { id: true, currentCompany: true, companyId: true, industry: true, companySize: true },
  });

  const slugSet = new Set<string>();
  for (const c of contacts) {
    const slug = c.currentCompany ? slugifyCompany(c.currentCompany) : "";
    if (slug) slugSet.add(slug);
  }

  const companyRows = await prisma.company.findMany({
    where: { universalName: { in: [...slugSet] } },
    select: { id: true, universalName: true, staffCount: true, industry: true },
  });
  const companyBySlug = new Map(companyRows.map((r) => [r.universalName, r]));

  const toUpdate: Array<{ id: string; companyId?: string; industry?: string; companySize?: number }> = [];

  for (const c of contacts) {
    const slug = c.currentCompany ? slugifyCompany(c.currentCompany) : "";
    const company = slug ? companyBySlug.get(slug) : undefined;

    const patch: Record<string, unknown> = {};
    if (company && !c.companyId) patch.companyId = company.id;
    if (company?.staffCount != null && c.companySize == null) patch.companySize = company.staffCount;
    if (company?.industry && !c.industry) patch.industry = company.industry;

    if (Object.keys(patch).length > 0) {
      toUpdate.push({ id: c.id, ...(patch as { companyId?: string; industry?: string; companySize?: number }) });
    }
  }

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map(({ id, ...data }) => prisma.contact.update({ where: { id }, data })),
    );
  }

  return NextResponse.json({
    ok: true,
    companiesUpserted: upserted,
    companiesSkipped: skipped,
    contactsBackfilled: toUpdate.length,
    totalContacts: contacts.length,
  });
});
