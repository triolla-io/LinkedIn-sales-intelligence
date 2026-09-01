import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import type { PackSource, SourceLang, SourceScope, TaxonomyTag } from "@/lib/tech-radar/sources";
import { INDUSTRY_FAMILIES, SEED_PACKS, normalizeIndustryKey } from "@/lib/tech-radar/source-packs";

/**
 * The source packs, as an editable thing.
 *
 * The v3 inversion made a list of 20 publishers the radar's entire input. A list that can
 * only change by deploy is a list that does not change — spec part 2 is explicit that
 * "מחיקה/הוספה/החלפה של מקור = פעולת UI, לא דיפלוי". This route is that UI's back end.
 *
 * Three rulings live here, and each one is a decision rather than plumbing:
 *
 * 1. **10 global + 10 Israeli is a TARGET, never validation.** A brand-new industry
 *    (the "H&M CEO" scenario in the spec) starts with whatever the research proposed.
 *    Refusing a short pack would leave that industry with NO sources, which is strictly
 *    worse than a short one — so a short pack saves and is flagged, with the gap spelled
 *    out in Hebrew so nobody mistakes "saved" for "finished".
 * 2. **A shared pack is copy-on-write.** `orgId = null` is the built-in every org falls
 *    back to (the schema says so in as many words). Editing that row in place from inside
 *    one org's screen would rewrite every other org's sources — the multi-tenant version
 *    of the merge leak that once put Phoenix's insurance rivals into Bank Leumi's
 *    searches. The first edit forks the pack into this org.
 * 3. **Off, not deleted.** A source's `enabled: false` keeps the row: turning an outlet
 *    back on is one click and the history of the choice survives. `sources` accepts a
 *    whole new list for genuine add/remove, and that is a separate, deliberate action.
 *
 * Tenancy: a pack is an ORG-level object, not a per-owner one — its scope key is
 * `ctx.org.id`. `effectiveUserId` deliberately does not appear: no Contact or SentMessage
 * row is read here, and scoping a shared publisher list per user would give two SDRs in
 * one org two different radars.
 */

const TARGET_PER_HALF = 10;

type PackRow = {
  id: string;
  orgId: string | null;
  industryKey: string;
  sources: unknown;
  taxonomy: unknown;
  updatedAt: Date;
};

type PackView = {
  id: string;
  industryKey: string;
  /** No `label` column exists (the migration stayed additive-minimal), and the stored
   *  `industryKey` is a normalised slug — "banking finance", not "בנקאות ופיננסים". Shown
   *  raw it would head the screen in English, so the Hebrew name is recovered. */
  label: string;
  /** "org" = this org's own edited copy; "global" = the shared built-in, still unforked. */
  scope: "org" | "global";
  sources: PackSource[];
  taxonomy: TaxonomyTag[];
  counts: { global: number; il: number; enabled: number; taxonomy: number };
  /** True when either half is short of the target. Informational — nothing rejects on it. */
  incomplete: boolean;
  /** What exactly is missing, in Hebrew. `incomplete: true` on its own gives a human
   *  nothing to act on; "חסרים 7 מקורות גלובליים" does. */
  gaps: string[];
  updatedAt: string;
};

const LANGS: SourceLang[] = ["he", "en"];
const SCOPES: SourceScope[] = ["global", "il"];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * A stored `sources` JSON blob read back as sources. Tolerant on read and strict on
 * write: a row written by an older shape must still render (the screen is the only place
 * a human can repair it), so a member missing its host is dropped here rather than
 * throwing the whole pack off the screen.
 */
function readSources(raw: unknown): PackSource[] {
  if (!Array.isArray(raw)) return [];
  const out: PackSource[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const s = entry as Record<string, unknown>;
    const host = str(s.host).toLowerCase().replace(/^www\./, "");
    if (!host) continue;
    const lang = LANGS.includes(s.lang as SourceLang) ? (s.lang as SourceLang) : "en";
    const scope = SCOPES.includes(s.scope as SourceScope) ? (s.scope as SourceScope) : "global";
    out.push({
      host,
      name: str(s.name) || host,
      ...(str(s.rss) ? { rss: str(s.rss) } : {}),
      ...(str(s.newsQuery) ? { newsQuery: str(s.newsQuery) } : {}),
      lang,
      scope,
      // Absent means on: a pack seeded before the flag existed must not read as 20 outlets
      // silently switched off.
      enabled: s.enabled !== false,
    });
  }
  return out;
}

function readTaxonomy(raw: unknown): TaxonomyTag[] {
  if (!Array.isArray(raw)) return [];
  return normalizeTaxonomy(raw);
}

/**
 * The closed vocabulary, cleaned. A blank tag or one with no label is DROPPED, not
 * repaired: `tag` is the exact string triage must echo back, and inventing one produces a
 * vocabulary entry that can never match anything and that nobody knows is dead. Dedupe by
 * tag for the same reason — two rows with one key stop it being a closed list.
 */
function normalizeTaxonomy(raw: unknown[]): TaxonomyTag[] {
  const seen = new Set<string>();
  const out: TaxonomyTag[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const t = entry as Record<string, unknown>;
    const tag = str(t.tag);
    const label = str(t.label);
    if (!tag || !label) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, label });
  }
  return out;
}

/** The write path's validator. Returns null when the payload is unusable — the caller
 *  turns that into a 400. Only SHAPE is enforced; count never is. */
function validateSourcesPayload(raw: unknown): PackSource[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PackSource[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const s = entry as Record<string, unknown>;
    const host = str(s.host).toLowerCase().replace(/^www\./, "");
    // No host, no source: the host is the dedupe key, the gift gate's key
    // (source-quality.ts) and the UI's row identity all at once.
    if (!host) return null;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({
      host,
      name: str(s.name) || host,
      ...(str(s.rss) ? { rss: str(s.rss) } : {}),
      ...(str(s.newsQuery) ? { newsQuery: str(s.newsQuery) } : {}),
      lang: LANGS.includes(s.lang as SourceLang) ? (s.lang as SourceLang) : "en",
      scope: SCOPES.includes(s.scope as SourceScope) ? (s.scope as SourceScope) : "global",
      enabled: s.enabled !== false,
    });
  }
  return out;
}

/**
 * The flag, and the only place the 10+10 target is read. Deliberately returns text and a
 * boolean — never an error — so no caller can accidentally turn the target into a gate.
 */
function describeGaps(sources: PackSource[], taxonomy: TaxonomyTag[]): { incomplete: boolean; gaps: string[] } {
  const global = sources.filter((s) => s.scope === "global").length;
  const il = sources.filter((s) => s.scope === "il").length;
  const gaps: string[] = [];
  if (global < TARGET_PER_HALF) gaps.push(`חסרים ${TARGET_PER_HALF - global} מקורות גלובליים מתוך ${TARGET_PER_HALF}`);
  if (il < TARGET_PER_HALF) gaps.push(`חסרים ${TARGET_PER_HALF - il} מקורות ישראליים מתוך ${TARGET_PER_HALF}`);
  // Not part of `incomplete` — the taxonomy's 40-60 is a range in the spec, and a pack
  // with sources and few tags still works (an untagged item keeps its scores and matches
  // on entities). Reported so it is visible, not counted so it looks broken.
  if (taxonomy.length === 0) gaps.push("אין אוצר מילים לסיווג — אף ידיעה לא תקבל תגית תעשייה");
  return { incomplete: global < TARGET_PER_HALF || il < TARGET_PER_HALF, gaps };
}

/**
 * The Hebrew name for a stored key. Recovered rather than stored: `industryKey` is
 * `normalizeIndustryKey`'s output (a token-sorted slug), which is the right key and the
 * wrong headline. The seed's own label wins, then the industry family's; a key belonging
 * to neither is an industry researched after this code was written, and its slug is the
 * most honest thing we have to show for it.
 */
function labelFor(industryKey: string): string {
  const fromSeed = SEED_PACKS.find((p) => normalizeIndustryKey(p.industryKey) === industryKey)?.label;
  if (fromSeed) return fromSeed;
  const family = INDUSTRY_FAMILIES.find((f) => f.key === industryKey)?.label;
  return family ?? industryKey;
}

function toView(row: PackRow): PackView {
  const sources = readSources(row.sources);
  const taxonomy = readTaxonomy(row.taxonomy);
  const { incomplete, gaps } = describeGaps(sources, taxonomy);
  return {
    id: row.id,
    industryKey: row.industryKey,
    label: labelFor(row.industryKey),
    scope: row.orgId ? "org" : "global",
    sources,
    taxonomy,
    counts: {
      global: sources.filter((s) => s.scope === "global").length,
      il: sources.filter((s) => s.scope === "il").length,
      enabled: sources.filter((s) => s.enabled).length,
      taxonomy: taxonomy.length,
    },
    incomplete,
    gaps,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

/** This org's rows plus the shared built-ins. The read is the write's guard too — a pack
 *  id outside this OR is invisible, so it cannot be edited. */
function reachOf(orgId: string) {
  return { OR: [{ orgId }, { orgId: null }] };
}

/**
 * One pack per industry: the org's own copy wins, and among shared rows the newest wins.
 * Postgres treats NULLs as distinct in a unique index, so `(orgId, industryKey)` does NOT
 * prevent two `orgId = null` rows for one industry — the schema comment flags exactly
 * this, and showing both would be two contradictory packs on one screen.
 */
function preferOrgCopy(rows: PackRow[]): PackRow[] {
  const byIndustry = new Map<string, PackRow>();
  for (const row of rows) {
    const held = byIndustry.get(row.industryKey);
    if (!held) {
      byIndustry.set(row.industryKey, row);
      continue;
    }
    if (held.orgId && !row.orgId) continue;
    if (!held.orgId && row.orgId) {
      byIndustry.set(row.industryKey, row);
      continue;
    }
    if (row.updatedAt > held.updatedAt) byIndustry.set(row.industryKey, row);
  }
  return [...byIndustry.values()];
}

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const rows = (await prisma.radarSourcePack.findMany({
    where: reachOf(ctx.org.id),
    orderBy: { industryKey: "asc" },
  })) as unknown as PackRow[];

  return NextResponse.json({
    packs: preferOrgCopy(rows).map(toView),
    // The target travels with the payload so the screen never hard-codes a second copy of
    // it — one place to change if an industry ever wants a different shape.
    targets: { global: TARGET_PER_HALF, il: TARGET_PER_HALF },
  });
});

type PatchBody = {
  packId?: unknown;
  action?: unknown;
  host?: unknown;
  enabled?: unknown;
  sources?: unknown;
  taxonomy?: unknown;
};

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const packId = str(body.packId);
  const action = str(body.action);
  if (!packId) return NextResponse.json({ error: "packId_required" }, { status: 400 });

  const row = (await prisma.radarSourcePack.findFirst({
    where: { id: packId, ...reachOf(ctx.org.id) },
  })) as unknown as PackRow | null;
  // Another org's pack is not "forbidden", it is not there: the reach above is the only
  // definition of what this org can see, and the write path must not have a wider one.
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let sources = readSources(row.sources);
  let taxonomy = readTaxonomy(row.taxonomy);

  if (action === "toggleSource") {
    const host = str(body.host).toLowerCase().replace(/^www\./, "");
    const target = sources.find((s) => s.host === host);
    // A host the pack does not carry means the screen and the row disagree. Writing the
    // list back unchanged would report success for an edit that did not happen.
    if (!target) return NextResponse.json({ error: "source_not_found" }, { status: 404 });
    const enabled = body.enabled !== false;
    sources = sources.map((s) => (s.host === host ? { ...s, enabled } : s));
  } else if (action === "sources") {
    const next = validateSourcesPayload(body.sources);
    if (!next) return NextResponse.json({ error: "invalid_sources" }, { status: 400 });
    sources = next;
  } else if (action === "taxonomy") {
    if (!Array.isArray(body.taxonomy)) {
      return NextResponse.json({ error: "invalid_taxonomy" }, { status: 400 });
    }
    taxonomy = normalizeTaxonomy(body.taxonomy);
  } else {
    // Never guess: an unrecognised action that fell through to "save everything" would
    // let a typo replace a pack.
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  // Copy-on-write. A shared row belongs to every org, so the first edit forks it; upsert
  // rather than create because two edits racing on the same shared pack would otherwise
  // have one of them die on the (orgId, industryKey) unique.
  const saved = row.orgId
    ? ((await prisma.radarSourcePack.update({
        where: { id: row.id },
        data: { sources: sources as unknown as object[], taxonomy: taxonomy as unknown as object[] },
      })) as unknown as PackRow)
    : ((await prisma.radarSourcePack.upsert({
        where: { orgId_industryKey: { orgId: ctx.org.id, industryKey: row.industryKey } },
        create: {
          orgId: ctx.org.id,
          industryKey: row.industryKey,
          sources: sources as unknown as object[],
          taxonomy: taxonomy as unknown as object[],
        },
        update: { sources: sources as unknown as object[], taxonomy: taxonomy as unknown as object[] },
      })) as unknown as PackRow);

  // The saved view comes back with its flag recomputed, so a save that leaves the pack
  // short tells the screen so in the same round trip.
  return NextResponse.json({ ok: true, pack: toView({ ...saved, orgId: saved.orgId ?? ctx.org.id }) });
});
