/**
 * One-shot HubSpot bulk sync.
 *
 * 1. Streams every HubSpot contact (free, no per-lookup cost).
 * 2. Builds in-memory indexes: by normalized LinkedIn URL, and by lowercased name+company.
 * 3. Iterates DB contacts missing email or phone, ordered C_LEVEL first.
 * 4. Fills email/phone from HubSpot when matched. Marks enrichmentSource = 'hubspot'.
 *
 * Run:  DATABASE_URL=... HUBSPOT_API_KEY=... npx tsx scripts/hubspot-bulk-sync.ts
 */
import { Pool } from "pg";

const HUBSPOT_BASE = "https://api.hubapi.com";
const HUBSPOT_KEY = process.env.HUBSPOT_API_KEY;
if (!HUBSPOT_KEY) {
  console.error("HUBSPOT_API_KEY is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type HubspotRecord = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  linkedinUrl?: string;
};

function normalizeLinkedinUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!/^\/in\/.+/.test(path)) return "";
    return `https://www.linkedin.com${path}`;
  } catch {
    return "";
  }
}

function nameKey(first?: string | null, last?: string | null, company?: string | null): string {
  const f = (first ?? "").trim().toLowerCase();
  const l = (last ?? "").trim().toLowerCase();
  const c = (company ?? "").trim().toLowerCase();
  if (!f || !l) return "";
  return `${f}|${l}|${c}`;
}

async function fetchHubspotPage(after?: string): Promise<{ results: any[]; next?: string }> {
  const url = new URL(`${HUBSPOT_BASE}/crm/v3/objects/contacts`);
  url.searchParams.set("limit", "100");
  url.searchParams.set(
    "properties",
    "email,phone,firstname,lastname,company,hs_linkedin_profile_url"
  );
  if (after) url.searchParams.set("after", after);

  // Retry on 429
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${HUBSPOT_KEY}` },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { results: data.results ?? [], next: data.paging?.next?.after };
  }
  throw new Error("HubSpot 429 after retries");
}

async function loadAllHubspot(): Promise<{
  byLinkedin: Map<string, HubspotRecord>;
  byName: Map<string, HubspotRecord>;
  total: number;
}> {
  const byLinkedin = new Map<string, HubspotRecord>();
  const byName = new Map<string, HubspotRecord>();
  let after: string | undefined;
  let total = 0;

  console.log("Pulling HubSpot contacts...");
  do {
    const { results, next } = await fetchHubspotPage(after);
    for (const r of results) {
      const p = r.properties ?? {};
      if (!p.email && !p.phone) continue;
      const record: HubspotRecord = {
        email: p.email || undefined,
        phone: p.phone || undefined,
        firstName: p.firstname || undefined,
        lastName: p.lastname || undefined,
        company: p.company || undefined,
        linkedinUrl: p.hs_linkedin_profile_url || undefined,
      };
      const linkedinKey = normalizeLinkedinUrl(record.linkedinUrl);
      if (linkedinKey) byLinkedin.set(linkedinKey, record);
      const nKey = nameKey(record.firstName, record.lastName, record.company);
      if (nKey) byName.set(nKey, record);
      total++;
    }
    after = next;
    if (total % 1000 === 0 || !after) {
      console.log(`  pulled ${total} contacts so far...`);
    }
  } while (after);

  console.log(`Done. ${total} HubSpot contacts indexed (${byLinkedin.size} by LinkedIn URL, ${byName.size} by name+company).`);
  return { byLinkedin, byName, total };
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

async function syncTier(
  client: any,
  seniority: string,
  byLinkedin: Map<string, HubspotRecord>,
  byName: Map<string, HubspotRecord>
): Promise<{ scanned: number; matched: number }> {
  const { rows } = await client.query(
    `SELECT id, "fullName", "linkedinUrl", "currentCompany", email, phone, "manualFields"
     FROM "Contact"
     WHERE "seniority" = $1
       AND "removedAt" IS NULL
       AND (email IS NULL OR phone IS NULL)`,
    [seniority]
  );

  let matched = 0;
  for (const c of rows) {
    const linkedinKey = normalizeLinkedinUrl(c.linkedinUrl);
    let hit: HubspotRecord | undefined;
    if (linkedinKey) hit = byLinkedin.get(linkedinKey);
    if (!hit) {
      const { first, last } = splitName(c.fullName ?? "");
      hit = byName.get(nameKey(first, last, c.currentCompany));
    }
    if (!hit || (!hit.email && !hit.phone)) continue;

    const protected_ = new Set<string>(c.manualFields ?? []);
    const newEmail =
      !protected_.has("email") && hit.email && !c.email ? hit.email : c.email;
    const newPhone =
      !protected_.has("phone") && hit.phone && !c.phone ? hit.phone : c.phone;

    if (newEmail === c.email && newPhone === c.phone) continue;

    await client.query(
      `UPDATE "Contact"
       SET email = $1,
           phone = $2,
           "enrichmentSource" = 'hubspot',
           "enrichmentRanAt" = NOW(),
           "enrichedAt" = NOW(),
           "enrichmentError" = NULL
       WHERE id = $3`,
      [newEmail, newPhone, c.id]
    );
    matched++;
  }

  return { scanned: rows.length, matched };
}

async function main() {
  const { byLinkedin, byName } = await loadAllHubspot();

  const client = await pool.connect();
  try {
    const tiers = ["C_LEVEL", "VP", "DIRECTOR", "MANAGER", "IC", "OTHER"];
    for (const tier of tiers) {
      const { scanned, matched } = await syncTier(client, tier, byLinkedin, byName);
      console.log(`[${tier}] scanned ${scanned} contacts, matched ${matched}`);
    }

    // Contacts without a seniority
    const { rows } = await client.query(
      `SELECT id, "fullName", "linkedinUrl", "currentCompany", email, phone, "manualFields"
       FROM "Contact"
       WHERE "seniority" IS NULL
         AND "removedAt" IS NULL
         AND (email IS NULL OR phone IS NULL)`
    );
    let unmatched = 0;
    let unmatchedHits = 0;
    for (const c of rows) {
      const linkedinKey = normalizeLinkedinUrl(c.linkedinUrl);
      let hit: HubspotRecord | undefined;
      if (linkedinKey) hit = byLinkedin.get(linkedinKey);
      if (!hit) {
        const { first, last } = splitName(c.fullName ?? "");
        hit = byName.get(nameKey(first, last, c.currentCompany));
      }
      if (!hit || (!hit.email && !hit.phone)) continue;
      const protected_ = new Set<string>(c.manualFields ?? []);
      const newEmail =
        !protected_.has("email") && hit.email && !c.email ? hit.email : c.email;
      const newPhone =
        !protected_.has("phone") && hit.phone && !c.phone ? hit.phone : c.phone;
      if (newEmail === c.email && newPhone === c.phone) continue;
      await client.query(
        `UPDATE "Contact" SET email = $1, phone = $2,
           "enrichmentSource" = 'hubspot', "enrichmentRanAt" = NOW(),
           "enrichedAt" = NOW(), "enrichmentError" = NULL
         WHERE id = $3`,
        [newEmail, newPhone, c.id]
      );
      unmatchedHits++;
      unmatched++;
    }
    console.log(`[no-seniority] scanned ${rows.length} contacts, matched ${unmatchedHits}`);
  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
