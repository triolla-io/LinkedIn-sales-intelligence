import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { classify } from "@/lib/classifier/seniority";
import { slugifyCompany } from "@/lib/linkedin/slug-utils";
import { inngest } from "@/inngest/client";

/**
 * POST /api/import/csv
 * Accepts a LinkedIn connections CSV export (multipart/form-data, field "file").
 *
 * LinkedIn CSV columns (may vary by locale):
 *   First Name, Last Name, URL, Email Address, Company, Position, Connected On
 */
export const POST = withTenant(async (req: NextRequest, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return NextResponse.json({ error: "CSV appears empty" }, { status: 400 });

  // Parse header — LinkedIn uses several header variants, normalise to lowercase
  const header = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iFirstName  = col(["first name", "firstname"]);
  const iLastName   = col(["last name", "lastname"]);
  const iUrl        = col(["url", "profile url", "linkedin url"]);
  const iEmail      = col(["email address", "email"]);
  const iCompany    = col(["company", "company name"]);
  const iPosition   = col(["position", "title", "job title"]);
  const iConnected  = col(["connected on", "connected at", "date connected"]);

  if (iFirstName === -1 && iLastName === -1) {
    return NextResponse.json({ error: "Could not find name columns. Make sure this is a LinkedIn connections CSV." }, { status: 400 });
  }

  // Parse rows
  const dataLines = lines.slice(1);
  const contacts: {
    fullName: string;
    linkedinUrl: string;
    linkedinUrn: string;
    email: string | null;
    currentCompany: string | null;
    currentTitle: string | null;
    connectedAt: Date | null;
  }[] = [];

  for (const line of dataLines) {
    // Handle quoted fields with commas inside
    const cells = parseCsvLine(line);
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

    const email       = get(iEmail) || null;
    const company     = get(iCompany) || null;
    const position    = get(iPosition) || null;
    const connectedRaw = get(iConnected);
    const connectedAt = connectedRaw ? new Date(connectedRaw) : null;

    contacts.push({
      fullName,
      linkedinUrl: cleanUrl || `https://www.linkedin.com/in/${publicId}`,
      linkedinUrn,
      email,
      currentCompany: company,
      currentTitle: position,
      connectedAt: connectedAt && !isNaN(connectedAt.getTime()) ? connectedAt : null,
    });
  }

  if (contacts.length === 0) {
    return NextResponse.json({ error: "No valid contacts found in CSV" }, { status: 400 });
  }

  // Upsert contacts
  const userId = ctx.effectiveUserId;
  let created = 0;
  let updated = 0;

  for (const c of contacts) {
    const { seniority, function: fn } = classify(c.currentTitle ?? "");
    const result = await prisma.contact.upsert({
      where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: c.linkedinUrn } },
      create: {
        ownerId: userId,
        linkedinUrn: c.linkedinUrn,
        linkedinUrl: c.linkedinUrl,
        fullName: c.fullName,
        email: c.email,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        seniority,
        function: fn,
        connectedAt: c.connectedAt,
        lastSyncedAt: new Date(),
      },
      update: {
        fullName: c.fullName,
        email: c.email || undefined,
        currentTitle: c.currentTitle || undefined,
        currentCompany: c.currentCompany || undefined,
        seniority,
        function: fn,
        connectedAt: c.connectedAt || undefined,
        lastSyncedAt: new Date(),
      },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    // createdAt === updatedAt means it was just created
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
    else updated++;
  }

  // Stub Company rows and link contacts
  const companyNames = [
    ...new Set(contacts.map((c) => c.currentCompany).filter(Boolean) as string[]),
  ];

  const bySlug = new Map<string, string>();
  for (const name of companyNames) {
    const slug = slugifyCompany(name);
    if (slug) bySlug.set(slug, name);
  }

  if (bySlug.size > 0) {
    // Upsert stub company rows
    const CHUNK = 50;
    const entries = [...bySlug.entries()];
    for (let i = 0; i < entries.length; i += CHUNK) {
      await prisma.$transaction(
        entries.slice(i, i + CHUNK).map(([slug, name]) =>
          prisma.company.upsert({
            where: { universalName: slug },
            update: {},
            create: { universalName: slug, name },
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

    // Trigger company enrichment
    await inngest.send({
      name: "companies.enrich" as const,
      data: { slugs: [...bySlug.keys()] },
    });
  }

  return NextResponse.json({
    ok: true,
    imported: contacts.length,
    created,
    updated,
    companies: bySlug.size,
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
