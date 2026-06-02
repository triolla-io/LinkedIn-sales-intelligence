import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { classify } from "@/lib/classifier/seniority";
import { getIndustry } from "@/lib/classifier/industry";
import { slugifyCompany } from "@/lib/utils/slug-utils";
import { inngest } from "@/inngest/client";
import * as XLSX from "xlsx";
import { diffContacts, type IncomingContact } from "@/lib/csv/diff";
import { lookupContact } from "@/lib/hubspot/client";

/** Returns empty string if the URL has no real profile slug. */
function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!/^\/in\/.+/.test(path)) return "";
    return `https://www.linkedin.com${path}`;
  } catch {
    return "";
  }
}

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

  // CSV path — LinkedIn exports include a "Notes:" preamble before the real header
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  // Find first line that looks like a CSV header row (LinkedIn export or custom export)
  const headerIdx = lines.findIndex((line) => {
    const cells = parseCsvLine(line).map((c) => c.replace(/^"|"$/g, "").trim().toLowerCase());
    return (
      cells.includes("first name") || cells.includes("firstname") ||
      cells.includes("name") ||
      cells.includes("url") || cells.includes("linkedin url")
    );
  });
  if (headerIdx === -1) return { header: [], rows: [] };
  const header = parseCsvLine(lines[headerIdx]).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(headerIdx + 1).map(parseCsvLine);
  return { header, rows };
}

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  // Helper: stream newline-delimited JSON back to the client
  // eslint-disable-next-line prefer-const
  let _streamController: ReadableStreamDefaultController<Uint8Array> | null = null as ReadableStreamDefaultController<Uint8Array> | null;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) { _streamController = ctrl; },
  });
  const emit = (obj: object) => {
    _streamController?.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
  };
  const streamResponse = new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });

  const updateOnly = formData.get("updateOnly") === "true";

  // Run the actual import asynchronously so we can return the stream immediately
  (async () => {

  const { header, rows } = await parseFile(file);
  if (!header.length || !rows.length) {
    emit({ error: "File appears empty" });
    _streamController?.close();
    return;
  }

  const headerLower = header.map((h) => h.toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const i = headerLower.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iName         = col(["name"]);
  const iFirstName    = col(["first name", "firstname"]);
  const iLastName     = col(["last name", "lastname"]);
  const iUrl          = col(["linkedin url", "url", "profile url", "linkedin member url", "member url", "linkedin profile url"]);
  const iEmail        = col(["email address", "email"]);
  const iCompany      = col(["company", "company name"]);
  const iPosition     = col(["title", "position", "job title"]);
  const iConnected    = col(["connected on", "connected at", "date connected"]);
  const iCompanySize  = col(["company size"]);
  const iPhone        = col(["phone", "phone number", "mobile"]);
  const iLocation     = col(["location"]);
  const iIndustry     = col(["industry"]);
  const iSeniority    = col(["seniority", "seniority level"]);

  if (iName === -1 && iFirstName === -1 && iLastName === -1) {
    emit({ error: "Could not find name columns. Make sure this is a LinkedIn connections CSV." });
    _streamController?.close();
    return;
  }

  // Parse rows
  const contacts: {
    fullName: string;
    linkedinUrl: string;
    linkedinUrn: string;
    email: string | null;
    phone: string | null;
    currentCompany: string | null;
    currentTitle: string | null;
    location: string | null;
    industry: string | null;
    seniorityOverride: string | null;
    connectedAt: Date | null;
    companySize: number | null;
  }[] = [];

  for (const cells of rows) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").replace(/^"|"$/g, "").trim() : "");

    const fullName = iName >= 0
      ? get(iName)
      : `${get(iFirstName)} ${get(iLastName)}`.trim();
    if (!fullName) continue;

    const rawUrl   = get(iUrl);
    const cleanUrl = rawUrl.split("?")[0].replace(/\/$/, "");
    const publicId = cleanUrl.split("/in/")[1] ?? "";
    // Use publicId as a stable URN key; prefix so it doesn't clash with Voyager URNs
    const linkedinUrn = publicId
      ? `urn:li:csv_import:${publicId}`
      : `urn:li:csv_import:${Buffer.from(fullName).toString("base64")}`;

    const email        = get(iEmail) || null;
    const phone        = get(iPhone) || null;
    const company      = get(iCompany) || null;
    const position     = get(iPosition) || null;
    const location     = get(iLocation) || null;
    const industry     = get(iIndustry) || null;
    const seniorityRaw = get(iSeniority).toUpperCase().replace(/ /g, "_");
    const seniorityOverride = seniorityRaw || null;
    const connectedRaw = get(iConnected);
    const connectedAt  = connectedRaw ? new Date(connectedRaw) : null;
    const sizeRaw      = get(iCompanySize);
    const companySize  = sizeRaw ? (parseInt(sizeRaw, 10) || null) : null;

    contacts.push({
      fullName,
      linkedinUrl: cleanUrl || `https://www.linkedin.com/in/${publicId}`,
      linkedinUrn,
      email,
      phone,
      currentCompany: company,
      currentTitle: position,
      location,
      industry,
      seniorityOverride,
      connectedAt: connectedAt && !isNaN(connectedAt.getTime()) ? connectedAt : null,
      companySize,
    });
  }

  if (contacts.length === 0) {
    emit({ error: "No valid contacts found in CSV" });
    _streamController?.close();
    return;
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

  // Batch-fetch PersonEnrichment cache for all contacts being upserted
  const orgId = (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId;
  const normalizedUrlList = contacts.map((c) => normalizeLinkedinUrl(c.linkedinUrl));
  const cachedEnrichments = orgId ? await prisma.personEnrichment.findMany({
    where: { orgId, linkedinUrlNormalized: { in: normalizedUrlList } },
    select: { linkedinUrlNormalized: true, email: true, phone: true },
  }) : [];
  const enrichmentCacheMap = new Map(cachedEnrichments.map((e) => [e.linkedinUrlNormalized, e]));

  // Apply ADD + UPDATE in one pass (UNCHANGED rows are skipped entirely)
  const unchangedSet = new Set(diff.unchanged);
  const toUpsert = contacts.filter((c) => !unchangedSet.has(c.linkedinUrn));
  const total = toUpsert.length;
  let processed = 0;
  emit({ progress: 0, total, stage: "contacts" });

  for (const c of toUpsert) {
    // Prefer seniority/industry/function from CSV; fall back to classifier
    const classified = classify(c.currentTitle ?? "");
    const seniority = (c.seniorityOverride as typeof classified.seniority | null) ?? classified.seniority;
    const fn = classified.function;
    const industry = c.industry || getIndustry(c.currentCompany ?? "") || undefined;

    // Cache lookup first — no external API call needed
    const cacheHit = enrichmentCacheMap.get(normalizeLinkedinUrl(c.linkedinUrl));

    // HubSpot lookup — only if no CSV email/phone and no cache hit
    const hubspot = (c.email || c.phone || cacheHit?.email) ? null : await lookupContact({
      linkedinUrl: c.linkedinUrl,
      fullName: c.fullName,
      company: c.currentCompany ?? undefined,
    });
    const email = c.email ?? cacheHit?.email ?? hubspot?.email ?? null;
    const phone = c.phone ?? cacheHit?.phone ?? hubspot?.phone ?? null;
    const enrichmentFields = cacheHit?.email || cacheHit?.phone
      ? { enrichmentSource: "cache", enrichmentRanAt: new Date(), enrichmentError: null }
      : hubspot?.email || hubspot?.phone
      ? { enrichmentSource: "hubspot", enrichmentRanAt: new Date(), enrichmentError: null }
      : {};

    await prisma.contact.upsert({
      where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: c.linkedinUrn } },
      create: {
        ownerId: userId,
        linkedinUrn: c.linkedinUrn,
        linkedinUrl: c.linkedinUrl,
        fullName: c.fullName,
        email,
        phone,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        companySize: c.companySize,
        connectedAt: c.connectedAt,
        location: c.location,
        seniority,
        function: fn,
        industry,
        lastSyncedAt: new Date(),
        ...enrichmentFields,
      },
      update: {
        fullName: c.fullName,
        email: email || undefined,
        phone: phone || undefined,
        currentTitle: c.currentTitle || undefined,
        currentCompany: c.currentCompany || undefined,
        companySize: c.companySize ?? undefined,
        connectedAt: c.connectedAt ?? undefined,
        location: c.location || undefined,
        seniority,
        function: fn,
        industry: industry || undefined,
        lastSyncedAt: new Date(),
        removedAt: null,
        ...enrichmentFields,
      },
    });
    processed++;
    emit({ progress: processed, total, stage: "contacts" });
  }

  // Soft-remove contacts that vanished from this CSV (skipped in update-only mode)
  if (!updateOnly && diff.removed.length > 0) {
    await prisma.contact.updateMany({
      where: { ownerId: userId, linkedinUrn: { in: diff.removed } },
      data: { removedAt: new Date() },
    });
  }

  const created = diff.added.length;
  const updated = diff.updated.length;
  const removed = updateOnly ? 0 : diff.removed.length;
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

    // Backfill companySize from already-enriched companies (no token cost)
    const enrichedCompanies = await prisma.company.findMany({
      where: { id: { in: [...idBySlug.values()] }, staffCount: { not: null } },
      select: { id: true, staffCount: true },
    });
    for (const co of enrichedCompanies) {
      await prisma.contact.updateMany({
        where: { ownerId: userId, companyId: co.id, companySize: null },
        data: { companySize: co.staffCount },
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

  // Trigger Haiku enrichment in background (Hebrew names + company size)
  inngest.send({
    name: "contacts.enrich-haiku" as const,
    data: { ownerId: userId },
  }).catch(() => {});

  emit({
    done: true,
    imported: contacts.length,
    added: created,
    updated,
    removed,
    unchanged,
    companies: bySlug.size,
    newCompanies,
  });
  _streamController?.close();
  })().catch((err) => {
    emit({ error: err?.message ?? "Import failed" });
    _streamController?.close();
  });

  return streamResponse;
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
