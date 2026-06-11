import * as XLSX from "xlsx";

export type ParsedContact = {
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
  connectedAt: string | null; // ISO string, JSON-safe
  companySize: number | null;
};

/** Returns empty string if the URL has no real profile slug. */
export function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!/^\/in\/.+/.test(path)) return "";
    return `https://www.linkedin.com${path}`;
  } catch {
    return "";
  }
}

/** Parse a single CSV line respecting quoted fields. */
export function parseCsvLine(line: string): string[] {
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

/** Convert an uploaded file to { header, rows } regardless of CSV/XLSX format. */
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

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
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

/** Map header + rows into ParsedContact objects. Pure — easy to unit test. */
export function parseConnectionRows(header: string[], rows: string[][]): ParsedContact[] {
  const headerLower = header.map((h) => h.toLowerCase());
  const col = (names: string[]) => {
    for (const n of names) {
      const i = headerLower.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const iName        = col(["name"]);
  const iFirstName   = col(["first name", "firstname"]);
  const iLastName    = col(["last name", "lastname"]);
  const iUrl         = col(["linkedin url", "url", "profile url", "linkedin member url", "member url", "linkedin profile url"]);
  const iEmail       = col(["email address", "email"]);
  const iCompany     = col(["company", "company name"]);
  const iPosition    = col(["title", "position", "job title"]);
  const iConnected   = col(["connected on", "connected at", "date connected"]);
  const iCompanySize = col(["company size"]);
  const iPhone       = col(["phone", "phone number", "mobile"]);
  const iLocation    = col(["location"]);
  const iIndustry    = col(["industry"]);
  const iSeniority   = col(["seniority", "seniority level"]);

  if (iName === -1 && iFirstName === -1 && iLastName === -1) return [];

  const out: ParsedContact[] = [];
  for (const cells of rows) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").replace(/^"|"$/g, "").trim() : "");

    const fullName = iName >= 0 ? get(iName) : `${get(iFirstName)} ${get(iLastName)}`.trim();
    if (!fullName) continue;

    const rawUrl = get(iUrl);
    const cleanUrl = rawUrl.split("?")[0].replace(/\/$/, "");
    const publicId = cleanUrl.split("/in/")[1] ?? "";
    const linkedinUrn = publicId
      ? `urn:li:csv_import:${publicId.toLowerCase()}`
      : `urn:li:csv_import:${Buffer.from(fullName).toString("base64")}`;

    const connectedRaw = get(iConnected);
    const connectedDate = connectedRaw ? new Date(connectedRaw) : null;
    const connectedAt = connectedDate && !isNaN(connectedDate.getTime()) ? connectedDate.toISOString() : null;

    const sizeRaw = get(iCompanySize);

    out.push({
      fullName,
      linkedinUrl: cleanUrl || `https://www.linkedin.com/in/${publicId}`,
      linkedinUrn,
      email: get(iEmail) || null,
      phone: get(iPhone) || null,
      currentCompany: get(iCompany) || null,
      currentTitle: get(iPosition) || null,
      location: get(iLocation) || null,
      industry: get(iIndustry) || null,
      seniorityOverride: get(iSeniority).toUpperCase().replace(/ /g, "_") || null,
      connectedAt,
      companySize: sizeRaw ? (parseInt(sizeRaw, 10) || null) : null,
    });
  }
  return out;
}

/** High-level helper used by the upload route. */
export async function parseConnectionsFile(file: File): Promise<{ contacts: ParsedContact[]; error?: string }> {
  const { header, rows } = await parseFile(file);
  if (!header.length || !rows.length) return { contacts: [], error: "File appears empty" };
  const headerLower = header.map((h) => h.toLowerCase());
  const hasName =
    headerLower.includes("name") || headerLower.includes("first name") ||
    headerLower.includes("firstname") || headerLower.includes("last name") || headerLower.includes("lastname");
  if (!hasName) {
    return { contacts: [], error: "Could not find name columns. Make sure this is a LinkedIn connections CSV." };
  }
  return { contacts: parseConnectionRows(header, rows) };
}
