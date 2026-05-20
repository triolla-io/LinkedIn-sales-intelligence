import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { classify } from "@/lib/classifier/seniority";
import { getIndustry } from "@/lib/classifier/industry";
import { slugifyCompany } from "@/lib/utils/slug-utils";
import { inngest } from "@/inngest/client";
import * as XLSX from "xlsx";
import { diffContacts, type IncomingContact } from "@/lib/csv/diff";

/**
 * POST /api/import/csv
 * Accepts a LinkedIn connections export as CSV or XLSX (multipart/form-data, field "file").
 *
 * LinkedIn columns (may vary by locale):
 *   First Name, Last Name, URL, Email Address, Company, Position, Connected On
 */

/** Convert file to array of row objects regardless of format */
async function parseFile(file: File): Promise<{ header: string[]; rows: string[][] }> {
  const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls") ||
    file.type.includes("spreadsheet") || file.type.includes("excel");

  if (isXlsx) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];
    const [header, ...rows] = data.filter((r) => r.some((c) => c !== ""));
    return { header: (header ?? []).map(String), rows: rows.map((r) => r.map(String)) };
  }

  // CSV path
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).map(parseCsvLine);
  return { header, rows };
}

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const { header, rows } = await parseFile(file);
  if (!header.length || !rows.length) {
    return NextResponse.json({ error: "File appears empty" }, { status: 400 });
  }

  const headerLower = header.map((h) => h.toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const i = headerLower.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iFirstName    = col(["first name", "firstname"]);
  const iLastName     = col(["last name", "lastname"]);
  const iUrl          = col(["url", "profile url", "linkedin url"]);
  const iEmail        = col(["email address", "email"]);
  const iCompany      = col(["company", "company name"]);
  const iPosition     = col(["position", "title", "job title"]);
  const iConnected    = col(["connected on", "connected at", "date connected"]);
  const iCompanySize  = col(["company size"]);

  if (iFirstName === -1 && iLastName === -1) {
    return NextResponse.json({ error: "Could not find name columns. Make sure this is a LinkedIn connections CSV." }, { status: 400 });
  }

  // Parse rows
  const contacts: {
    fullName: string;
    linkedinUrl: string;
    linkedinUrn: string;
    email: string | null;
    currentCompany: string | null;
    currentTitle: string | null;
    connectedAt: Date | null;
    companySize: number | null;
  }[] = [];

  for (const cells of rows) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").replace(/^"|"$/g, "").trim() : "");

    const firstName = get(iFirstName);
    const lastName  = get(iLastName);
    const fullName  = `${firstName} ${lastName}`.trim();
    if (!fullName) continue;

    const rawUrl   = get(iUrl);
    const cleanUrl = rawUrl.split("?")[0].replace(/\/$/, "");
    const publicId = cleanUrl.split("/in/")[1] ?? "";
    // Use publicId as a stable URN key; prefix so it doesn't clash with Voyager URNs
    const linkedinUrn = publicId
      ? `urn:li:csv_import:${publicId}`
      : `urn:li:csv_import:${Buffer.from(fullName).toString("base64")}`;

    const email        = get(iEmail) || null;
    const company      = get(iCompany) || null;
    const position     = get(iPosition) || null;
    const connectedRaw = get(iConnected);
    const connectedAt  = connectedRaw ? new Date(connectedRaw) : null;
    const sizeRaw      = get(iCompanySize);
    const companySize  = sizeRaw ? (parseInt(sizeRaw, 10) || null) : null;

    contacts.push({
      fullName,
      linkedinUrl: cleanUrl || `https://www.linkedin.com/in/${publicId}`,
      linkedinUrn,
      email,
      currentCompany: company,
      currentTitle: position,
      connectedAt: connectedAt && !isNaN(connectedAt.getTime()) ? connectedAt : null,
      companySize,
    });
  }

  if (contacts.length === 0) {
    return NextResponse.json({ error: "No valid contacts found in CSV" }, { status: 400 });
  }

  // Upsert contacts via diff-first strategy
  const userId = ctx.effectiveUserId;

  // Load existing contacts for this user — only the fields we compare
  const existingRows = await prisma.contact.findMany({
    where: { ownerId: userId, removedAt: null },
    select: { linkedinUrn: true, fullName: true, currentTitle: true, currentCompany: true, companySize: true },
  });
  const existingMap = new Map(
    existingRows.map((r: { linkedinUrn: string; fullName: string; currentTitle: string | null; currentCompany: string | null; companySize: number | null }) =>
      [r.linkedinUrn, { fullName: r.fullName, currentTitle: r.currentTitle, currentCompany: r.currentCompany, companySize: r.companySize }] as const,
    ),
  );

  const incoming: IncomingContact[] = contacts.map((c) => ({
    linkedinUrn: c.linkedinUrn,
    fullName: c.fullName,
    currentTitle: c.currentTitle,
    currentCompany: c.currentCompany,
    companySize: c.companySize,
  }));

  const diff = diffContacts(existingMap, incoming);

  // Apply ADD + UPDATE in one pass (UNCHANGED rows are skipped entirely)
  const unchangedSet = new Set(diff.unchanged);
  const toUpsert = contacts.filter((c) => !unchangedSet.has(c.linkedinUrn));
  for (const c of toUpsert) {
    const { seniority, function: fn } = classify(c.currentTitle ?? "");
    const industry = getIndustry(c.currentCompany ?? "") || undefined;
    await prisma.contact.upsert({
      where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: c.linkedinUrn } },
      create: {
        ownerId: userId,
        linkedinUrn: c.linkedinUrn,
        linkedinUrl: c.linkedinUrl,
        fullName: c.fullName,
        email: c.email,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        companySize: c.companySize,
        seniority,
        function: fn,
        industry,
        lastSyncedAt: new Date(),
      },
      update: {
        fullName: c.fullName,
        email: c.email || undefined,
        currentTitle: c.currentTitle || undefined,
        currentCompany: c.currentCompany || undefined,
        companySize: c.companySize ?? undefined,
        seniority,
        function: fn,
        industry: industry || undefined,
        lastSyncedAt: new Date(),
        removedAt: null,  // un-soft-remove if they came back
      },
    });
  }

  // Soft-remove contacts that vanished from this CSV
  if (diff.removed.length > 0) {
    await prisma.contact.updateMany({
      where: { ownerId: userId, linkedinUrn: { in: diff.removed } },
      data: { removedAt: new Date() },
    });
  }

  const created = diff.added.length;
  const updated = diff.updated.length;
  const removed = diff.removed.length;
  const unchanged = diff.unchanged.length;

  // Stub Company rows and link contacts
  // Build a map from slug → { name, staffCount, industry } using first occurrence per company
  const bySlug = new Map<string, { name: string; staffCount: number | null; industry: string | null }>();
  for (const c of contacts) {
    if (!c.currentCompany) continue;
    const slug = slugifyCompany(c.currentCompany);
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, {
      name: c.currentCompany,
      staffCount: c.companySize,
      industry: getIndustry(c.currentCompany) || null,
    });
  }

  let newCompanies = 0;

  if (bySlug.size > 0) {
    // Count how many of these slugs are brand new (not in DB yet)
    const existingCompanies = await prisma.company.findMany({
      where: { universalName: { in: [...bySlug.keys()] } },
      select: { universalName: true },
    });
    const existingSlugs = new Set(existingCompanies.map((r: { universalName: string }) => r.universalName));
    newCompanies = [...bySlug.keys()].filter((s) => !existingSlugs.has(s)).length;

    // Upsert stub company rows — write staffCount + industry if we have them
    const CHUNK = 50;
    const entries = [...bySlug.entries()];
    for (let i = 0; i < entries.length; i += CHUNK) {
      await prisma.$transaction(
        entries.slice(i, i + CHUNK).map(([slug, info]) =>
          prisma.company.upsert({
            where: { universalName: slug },
            update: {
              ...(info.staffCount != null ? { staffCount: info.staffCount } : {}),
              ...(info.industry ? { industry: info.industry } : {}),
            },
            create: {
              universalName: slug,
              name: info.name,
              ...(info.staffCount != null ? { staffCount: info.staffCount } : {}),
              ...(info.industry ? { industry: info.industry } : {}),
            },
          }),
        ),
      );
    }

    // Link contacts to their company
    const companyRows = await prisma.company.findMany({
      where: { universalName: { in: [...bySlug.keys()] } },
      select: { id: true, universalName: true },
    });
    const idBySlug = new Map(companyRows.map((r) => [r.universalName, r.id]));

    for (const c of contacts) {
      if (!c.currentCompany) continue;
      const slug = slugifyCompany(c.currentCompany);
      const companyId = slug ? (idBySlug.get(slug) ?? null) : null;
      if (!companyId) continue;
      await prisma.contact.updateMany({
        where: { ownerId: userId, linkedinUrn: c.linkedinUrn },
        data: { companyId },
      });
    }

    // Auto-trigger Apollo enrichment for any companies that still need data
    // (the function itself filters staffCount=null, so re-runs cost zero credits)
    const meForOrg = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    if (meForOrg) {
      inngest.send({
        name: "companies.enrich-web" as const,
        data: { orgId: meForOrg.orgId },
      }).catch(() => {});
    }
  }

  // Persist import history
  await prisma.import.create({
    data: {
      ownerId: userId,
      fileName: file.name,
      totalRows: contacts.length,
      added: created,
      updated,
      removed,
      companies: bySlug.size,
      newCompanies,
    },
  });

  return NextResponse.json({
    ok: true,
    imported: contacts.length,
    added: created,
    updated,
    removed,
    unchanged,
    companies: bySlug.size,
    newCompanies,
  });
});

/** Parse a single CSV line respecting quoted fields. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cells.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
