import * as XLSX from "xlsx";
import { z } from "zod";
import { parseCsvLine } from "@/lib/csv/parse";

/** A company row normalized for insertion as a ProspectingCompanyTarget. */
export type ParsedCompany = {
  name: string;
  nameHebrew: string | null;
  linkedinUrl: string | null;
  linkedinSlug: string | null;
  website: string | null;
  vertical: string | null;
  dedupKey: string;
};

export const CompanyInputSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    linkedinUrl: z.string().trim().max(500).optional(),
    nameHebrew: z.string().trim().max(200).optional(),
    website: z.string().trim().max(500).optional(),
    vertical: z.string().trim().max(200).optional(),
  })
  .refine((c) => Boolean(c.name?.trim()) || Boolean(c.linkedinUrl?.trim()), {
    message: "company needs a name or a linkedin url",
  });
export type CompanyInput = z.infer<typeof CompanyInputSchema>;

/** Normalize a LinkedIn company URL to canonical https://www.linkedin.com/company/<slug>. */
export function normalizeCompanyLinkedinUrl(
  raw: string,
): { url: string; slug: string } | null {
  const t = raw.trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/company\/([^/?#]+)/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  return { url: `https://www.linkedin.com/company/${slug}`, slug };
}

/** Stored dedup key: slug when a LinkedIn URL exists, else lowercased/whitespace-collapsed name. */
export function companyDedupKey(i: {
  linkedinSlug: string | null;
  name: string;
}): string {
  return i.linkedinSlug ?? i.name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Normalize a manual/JSON company input to a ParsedCompany (null = invalid row). */
export function companyInputToParsed(
  input: CompanyInput,
): ParsedCompany | null {
  const linked = input.linkedinUrl
    ? normalizeCompanyLinkedinUrl(input.linkedinUrl)
    : null;
  const english = input.name?.trim() || "";
  const hebrew = input.nameHebrew?.trim() || "";
  // A line that LOOKS like a URL but isn't a company URL is invalid, not a name.
  if (!linked && input.linkedinUrl?.trim() && !english && !hebrew) return null;
  const name = english || hebrew || linked?.slug || "";
  if (!name) return null;
  const linkedinSlug = linked?.slug ?? null;
  return {
    name,
    nameHebrew: hebrew || null,
    linkedinUrl: linked?.url ?? null,
    linkedinSlug,
    website: input.website?.trim() || null,
    vertical: input.vertical?.trim() || null,
    dedupKey: companyDedupKey({ linkedinSlug, name }),
  };
}

// Header aliases (case-insensitive, He/En) — see spec §7.
const LINKEDIN_ALIASES = [
  "לינקדאין",
  "linkedin",
  "linkedin url",
  "company linkedin",
];
const NAME_ALIASES = ["שם באנגלית", "name", "company name", "english name"];
const NAME_HE_ALIASES = ["חברה", "שם חברה"];
const WEBSITE_ALIASES = ["אתר", "website", "site", "url"];
const VERTICAL_ALIASES = ["וורטיקל", "vertical"];

export function parseCompanyRows(
  header: string[],
  rows: string[][],
): { companies: ParsedCompany[]; skippedInvalid: number } {
  const headerLower = header.map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const i = headerLower.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iLinkedin = col(LINKEDIN_ALIASES);
  const iName = col(NAME_ALIASES);
  const iNameHe = col(NAME_HE_ALIASES);
  const iWebsite = col(WEBSITE_ALIASES);
  const iVertical = col(VERTICAL_ALIASES);

  const cell = (row: string[], i: number) =>
    i >= 0 ? (row[i] ?? "").trim() : "";

  const companies: ParsedCompany[] = [];
  let skippedInvalid = 0;
  for (const row of rows) {
    let linkedinRaw = cell(row, iLinkedin);
    let website: string | null = cell(row, iWebsite) || null;
    // Rescue: a LinkedIn company URL that landed in the website/url column.
    if (!linkedinRaw && website && normalizeCompanyLinkedinUrl(website)) {
      linkedinRaw = website;
      website = null;
    }
    const parsed = companyInputToParsed({
      name: cell(row, iName) || undefined,
      nameHebrew: cell(row, iNameHe) || undefined,
      linkedinUrl: linkedinRaw || undefined,
      website: website ?? undefined,
      vertical: cell(row, iVertical) || undefined,
    });
    if (parsed) companies.push(parsed);
    else skippedInvalid++;
  }
  return { companies, skippedInvalid };
}

/** Parse an uploaded Google-Sheet export (CSV or XLSX). Same detection as lib/csv/parse.ts. */
export async function parseCompaniesFile(
  file: File,
): Promise<{
  companies: ParsedCompany[];
  skippedInvalid: number;
  error?: string;
}> {
  try {
    const isXlsx =
      file.name.endsWith(".xlsx") ||
      file.name.endsWith(".xls") ||
      file.type.includes("spreadsheet") ||
      file.type.includes("excel");
    let header: string[];
    let rows: string[][];
    if (isXlsx) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<string[]>(ws, {
        header: 1,
        defval: "",
      }) as string[][];
      const nonEmpty = data.filter((r) =>
        r.some((c) => String(c).trim() !== ""),
      );
      const [h, ...rest] = nonEmpty;
      header = (h ?? []).map(String);
      rows = rest.map((r) => r.map(String));
    } else {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length === 0)
        return { companies: [], skippedInvalid: 0, error: "empty_file" };
      header = parseCsvLine(lines[0]);
      rows = lines.slice(1).map(parseCsvLine);
    }
    if (header.length === 0)
      return { companies: [], skippedInvalid: 0, error: "no_header" };
    return parseCompanyRows(header, rows);
  } catch {
    return { companies: [], skippedInvalid: 0, error: "parse_failed" };
  }
}
