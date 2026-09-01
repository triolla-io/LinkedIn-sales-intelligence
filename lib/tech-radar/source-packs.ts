/**
 * WHICH source pack each of an org's people needs, and the industry key that finds it.
 *
 * Two jobs, and they are the same job twice: turn a free-text industry name into a
 * canonical key, then find the pack filed under that key.
 *
 * ── Why the normalisation is not just normalizeAxisKey ───────────────────────
 *
 * `industryKey()` in axis.ts already token-sorts an industry's canonical string, and that
 * is enough for "בנקאות ישראל / Israeli banking" vs "Israeli banking / בנקאות ישראל" —
 * the same words in another order. It is NOT enough for the same industry NAMED
 * differently, and prod proves it: on 2026-08-31 Gil Tamir carried TWO INDUSTRY axes,
 *
 *     "Financial Services / שירותים פיננסיים"
 *     "Israeli financial services / שירותים פיננסיים בישראל"
 *
 * for one industry, because token-sorting alone sees `{financial, services, שירותים,
 * פיננסיים}` and `{israeli, financial, services, שירותים, פיננסיים, בישראל}` as different
 * sets. Two keys means two pack lookups, and the second pack does not exist — so half of
 * one man's industry net would resolve to nothing and nobody would be told.
 *
 * The fix is three cheap, EXPLICIT layers on top of normalizeAxisKey's own discipline:
 *
 *   1. Drop geography. "Israeli banking" and "banking" are one pack — the pack itself
 *      carries the Israeli half of its sources (10 global + 10 Israeli), so the country
 *      is a property of the SOURCES, never of the industry key.
 *   2. Fold a small HAND-WRITTEN bilingual lexicon (בנקאות→banking, פיננסיים→finance).
 *      Hand-written on purpose: axis.ts records that an attempt to strip Hebrew
 *      inflection algorithmically turned "ליבה בנקאית" into "יבה נקאי", which merges
 *      unrelated subjects — the expensive direction of the error. A lexicon cannot do
 *      that; it only ever collapses pairs a human listed.
 *   3. Collapse a family. A pack is per-INDUSTRY, and "banking" and "financial services"
 *      read the same twenty outlets. Insurance deliberately does NOT join that family:
 *      the 2026-08-26 incident was Phoenix's insurance rivals leaking into Bank Leumi's
 *      searches, and a family that is too wide is how that happens again.
 *
 * ── Why the return type is not SourcePack[] ─────────────────────────────────
 *
 * The plan's signature was `Promise<SourcePack[]>`. A bare array cannot say "and these
 * three industries got nothing", and an industry with no pack is EXACTLY the shape of
 * failure this codebase keeps hitting: a mass drop on 2026-08-27 that nobody saw, and a
 * run reporting "0 נמצאו" that turned out to be 25 people silently title-filtered. So
 * resolution returns a report — packs, the industries behind them, the ones that resolved
 * to nothing and why, and the axes with no live subscriber. Every industry the org has is
 * accounted for in exactly one bucket.
 */
import { prisma } from "@/lib/prisma";
import { normalizeAxisKey } from "@/lib/tech-radar/axis";
import { BANKING_IL_PACK, type PackSource, type SourcePack, type TaxonomyTag } from "@/lib/tech-radar/sources";

/**
 * Tokens that carry no industry meaning. Geography first — see layer 1 above — then the
 * generic nouns an industry name collects ("ענף", "services") which would otherwise make
 * "financial services" and "finance" two industries.
 *
 * "ענף" is here for a structural reason too: `ensureIndustryAxis` labels an INDUSTRY axis
 * `ענף: <canonical>`, and resolution reads those labels. Dropping the token is safer than
 * slicing the prefix off the string — it works whether the caller hands us a label or a
 * bare canonical.
 */
const INDUSTRY_DROP = new Set([
  // Geography
  "israel", "israeli", "il", "isr",
  "ישראל", "בישראל", "ישראלי", "ישראלית", "הישראלי", "הישראלית", "ישראליים",
  "global", "worldwide", "international", "local",
  "גלובלי", "גלובלית", "בינלאומי", "בינלאומית", "מקומי", "מקומית",
  // Generic
  "services", "service", "solutions", "companies", "company", "firms", "providers",
  "שירותים", "שירות", "פתרונות", "חברות", "חברה", "ענף", "תעשייה", "תעשיית", "מגזר",
]);

/**
 * The bilingual lexicon of layer 2. Hebrew forms are listed EXPLICITLY, inflection and
 * conjunctive ו included ("ופיננסים"), because nothing here strips morphology — a wrong
 * fold merges two industries into one net, which is how a story about the wrong sector
 * reaches a real person.
 *
 * Only industries the platform has actually seen are listed. An unlisted industry keeps
 * its own tokens as its key, which is correct: it gets no pack, and resolution REPORTS it
 * rather than quietly matching it to a neighbour's outlets.
 */
const INDUSTRY_SYNONYMS = new Map<string, string>([
  // Banking
  ["בנקאות", "banking"], ["ובנקאות", "banking"], ["בנקאי", "banking"], ["בנקאית", "banking"],
  ["בנקים", "banking"], ["בנק", "banking"], ["הבנקאות", "banking"],
  ["banking", "banking"], ["banks", "banking"], ["bank", "banking"],
  // Finance
  ["פיננסים", "finance"], ["ופיננסים", "finance"], ["פיננסיים", "finance"], ["פיננסי", "finance"],
  ["פיננסית", "finance"], ["הפיננסיים", "finance"], ["כספים", "finance"],
  ["finance", "finance"], ["financial", "finance"], ["financials", "finance"], ["finances", "finance"],
  // Fintech / payments / credit — the same twenty outlets cover these.
  ["פינטק", "fintech"], ["fintech", "fintech"],
  ["תשלומים", "payments"], ["ותשלומים", "payments"], ["payments", "payments"], ["payment", "payments"],
  ["אשראי", "credit"], ["credit", "credit"],
  // Insurance — folded so its spellings agree with each other, and deliberately NOT a
  // member of the banking family below.
  ["ביטוח", "insurance"], ["וביטוח", "insurance"], ["ביטוחי", "insurance"], ["ביטוחים", "insurance"],
  ["insurance", "insurance"], ["insurer", "insurance"], ["insurers", "insurance"],
  // Others seen in the tracked population.
  ["קמעונאות", "retail"], ["retail", "retail"],
  ["בריאות", "healthcare"], ["healthcare", "healthcare"], ["health", "healthcare"],
  ["תקשורת", "telecom"], ["telecom", "telecom"], ["telecommunications", "telecom"],
]);

/**
 * One pack serves a FAMILY of near-identical industries. A member token anywhere in the
 * folded set decides the family, so "banking", "financial services" and "fintech
 * payments" all land on one key — which is what makes Gil Tamir's two axes one lookup.
 *
 * Kept short on purpose. Every token added here widens somebody's news net, and the
 * cost of widening it too far is a real message about the wrong sector.
 */
export const INDUSTRY_FAMILIES: { key: string; label: string; members: string[] }[] = [
  {
    key: "banking finance",
    label: "בנקאות ופיננסים",
    members: ["banking", "finance", "fintech", "payments", "credit"],
  },
];

/**
 * The canonical key an industry's name — in either language, in any word order, with or
 * without the `ענף: ` label prefix — resolves to.
 *
 * Returns "" for a name with no industry content left. Never a placeholder: a degenerate
 * shared key is how unrelated industries would collide onto one pack, the same reason
 * `ensureIndustryAxis` refuses a bare "industry:".
 */
export function normalizeIndustryKey(name: string): string {
  const base = normalizeAxisKey(name);
  if (!base) return "";

  const tokens: string[] = [];
  for (const token of base.split(" ")) {
    if (!token || INDUSTRY_DROP.has(token)) continue;
    const folded = INDUSTRY_SYNONYMS.get(token) ?? token;
    if (!folded || INDUSTRY_DROP.has(folded)) continue;
    tokens.push(folded);
  }
  if (tokens.length === 0) return "";

  const family = INDUSTRY_FAMILIES.find((f) => tokens.some((t) => f.members.includes(t)));
  if (family) return family.key;
  // Token-sorted and deduped, exactly as normalizeAxisKey leaves its own output, so word
  // order can never produce two keys for one industry.
  return [...new Set(tokens)].sort().join(" ");
}

/** The seed packs a brand-new org falls back to, filed under their normalised keys. */
export const SEED_PACKS: SourcePack[] = [BANKING_IL_PACK];

/** One industry actually represented among an org's tracked people. */
export type OrgIndustry = {
  /** normalizeIndustryKey() output. */
  industryKey: string;
  /**
   * Every raw INDUSTRY axis label that collapsed onto this key. PLURAL on purpose: it is
   * what makes a duplicate-axis bug visible in a run report instead of merely fixed, and
   * it is the Hebrew text a report should print — the key itself is machine English.
   */
  labels: string[];
  axisIds: string[];
  /** Distinct people with a non-muted subscription. A muted axis is not scanned. */
  people: number;
};

/** An industry whose people would get NOTHING. Always returned, never merely absent. */
export type UnresolvedIndustry = OrgIndustry & {
  /** `no_pack`: nobody has written one. `pack_empty`: a row exists but has no enabled
   *  source or no taxonomy tag, so it would fetch or classify nothing. */
  reason: "no_pack" | "pack_empty";
};

export type PackResolution = {
  /** One pack per resolved industry, deduped by industryKey. */
  packs: SourcePack[];
  /** Every industry with at least one live subscriber, resolved or not. */
  industries: OrgIndustry[];
  unresolved: UnresolvedIndustry[];
  /** Industry axes whose only subscriptions are muted. They represent nobody this scan,
   *  which is a legitimate reason for an empty result — but a stated one. */
  noSubscribers: OrgIndustry[];
  /** Axis labels that normalise to no industry at all. Should be impossible
   *  (`ensureIndustryAxis` rejects such a canonical), so a non-empty list is a bug
   *  report, not a routine outcome. */
  unkeyed: { axisId: string; label: string }[];
};

/**
 * Rebuild a SourcePack from a RadarSourcePack row's Json columns.
 *
 * Defensive because `sources` and `taxonomy` are `Json` — the pack-editing UI writes
 * them, and a hand-edited row can carry anything. A malformed entry is DROPPED, never
 * coerced into a guess: an invented host would be fetched, and a taxonomy tag the triage
 * model was never shown cannot be matched. Same discipline as `asKind`.
 *
 * Disabled sources are dropped here as well as in `fetchSourcePack`, so a pack whose
 * every source is switched off reads as `pack_empty` up front instead of quietly
 * returning zero items later.
 */
export function packFromRow(row: { industryKey: string; sources: unknown; taxonomy: unknown }): SourcePack {
  const sources: PackSource[] = [];
  if (Array.isArray(row.sources)) {
    for (const entry of row.sources) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const r = entry as Record<string, unknown>;
      if (r.enabled === false) continue;
      const host = typeof r.host === "string" ? r.host.trim().toLowerCase().replace(/^www\./, "") : "";
      if (!host) continue;
      const source: PackSource = {
        host,
        name: typeof r.name === "string" && r.name.trim().length > 0 ? r.name.trim() : host,
        lang: r.lang === "he" ? "he" : "en",
        scope: r.scope === "il" ? "il" : "global",
        enabled: true,
      };
      if (typeof r.rss === "string" && r.rss.trim().length > 0) source.rss = r.rss.trim();
      if (typeof r.newsQuery === "string" && r.newsQuery.trim().length > 0) source.newsQuery = r.newsQuery.trim();
      sources.push(source);
    }
  }

  const taxonomy: TaxonomyTag[] = [];
  const seenTags = new Set<string>();
  if (Array.isArray(row.taxonomy)) {
    for (const entry of row.taxonomy) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const r = entry as Record<string, unknown>;
      const tag = typeof r.tag === "string" ? r.tag.trim() : "";
      if (!tag || seenTags.has(tag)) continue;
      seenTags.add(tag);
      taxonomy.push({ tag, label: typeof r.label === "string" && r.label.trim() ? r.label.trim() : tag });
    }
  }

  // A row carries no label column (the migration stays additive-minimal), so the Hebrew
  // name is recovered from the seed when the key matches and left unset otherwise —
  // sources.ts documents that a caller with no label shows industryKey.
  //
  // `globalPlayers` is recovered the same way and for the same reason: the table has no
  // column for it, and the list is what lets a JPMorgan story out of the geography gate
  // for a banker (see the field's note in sources.ts). Recovered rather than defaulted to
  // a hard-coded list here, so an industry with no seed gets an empty list — the
  // conservative direction — instead of a banker's reference points.
  const seed = SEED_PACKS.find((p) => normalizeIndustryKey(p.industryKey) === row.industryKey);
  return {
    industryKey: row.industryKey,
    ...(seed?.label ? { label: seed.label } : {}),
    sources,
    taxonomy,
    ...(seed?.globalPlayers?.length ? { globalPlayers: seed.globalPlayers } : {}),
  };
}

/**
 * The packs the org's tracked people need, plus what got nothing.
 *
 * Industries are read off the ACTIVE INDUSTRY axes and their non-muted subscribers, which
 * is the same join `ensureIndustryAxis` writes — so "represented among the org's tracked
 * people" means literally "somebody built a profile and was subscribed to this net".
 */
export async function resolvePacksForOrg(orgId: string): Promise<PackResolution> {
  const axes = await prisma.radarAxis.findMany({
    where: { orgId, kind: "INDUSTRY", status: "ACTIVE" },
    select: {
      id: true,
      label: true,
      people: { where: { mutedAt: null }, select: { personProfileId: true } },
    },
  });

  const unkeyed: { axisId: string; label: string }[] = [];
  const grouped = new Map<string, { labels: string[]; axisIds: string[]; people: Set<string> }>();

  for (const axis of axes) {
    const key = normalizeIndustryKey(axis.label ?? "");
    if (!key) {
      unkeyed.push({ axisId: axis.id, label: axis.label ?? "" });
      continue;
    }
    const bucket = grouped.get(key) ?? { labels: [], axisIds: [], people: new Set<string>() };
    if (!bucket.labels.includes(axis.label)) bucket.labels.push(axis.label);
    bucket.axisIds.push(axis.id);
    // A Set, not a sum: Gil Tamir subscribes to BOTH of his duplicate axes, and counting
    // the rows would report two people where there is one.
    for (const link of axis.people ?? []) bucket.people.add(link.personProfileId);
    grouped.set(key, bucket);
  }

  const all: OrgIndustry[] = [...grouped.entries()].map(([industryKey, b]) => ({
    industryKey,
    labels: b.labels,
    axisIds: b.axisIds,
    people: b.people.size,
  }));
  const noSubscribers = all.filter((i) => i.people === 0);
  const industries = all.filter((i) => i.people > 0);

  if (industries.length === 0) {
    return { packs: [], industries, unresolved: [], noSubscribers, unkeyed };
  }

  const rows = await prisma.radarSourcePack.findMany({
    where: {
      industryKey: { in: industries.map((i) => i.industryKey) },
      // Explicit OR rather than a bare `orgId` filter: a global fallback row has
      // orgId = NULL, and Prisma's NOT/equality handling around NULLs has burned this
      // repo before (`NOT: { flag: true }` matched 0 of 16,250 rows).
      OR: [{ orgId }, { orgId: null }],
    },
    select: { id: true, orgId: true, industryKey: true, sources: true, taxonomy: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const packs: SourcePack[] = [];
  const unresolved: UnresolvedIndustry[] = [];

  for (const industry of industries) {
    // Re-sorted in code, not only in the query. The tie-break below is a stated rule, so
    // it is enforced where it is stated rather than resting on the ORDER BY surviving
    // every future edit to the query.
    const forKey = rows
      .filter((r) => r.industryKey === industry.industryKey)
      .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
    // The org's own edited copy wins outright; otherwise the newest global row. Postgres
    // treats NULLs as distinct in a unique index, so (NULL, industryKey) can legitimately
    // exist more than once — the schema comment on RadarSourcePack says so and points
    // here for the tie-break.
    const row = forKey.find((r) => r.orgId === orgId) ?? forKey.find((r) => r.orgId === null) ?? null;
    if (!row) {
      unresolved.push({ ...industry, reason: "no_pack" });
      continue;
    }
    const pack = packFromRow(row);
    // A pack with no enabled source fetches nothing; one with no tag classifies nothing
    // and every tag overlap scores zero for everybody. Both are a quiet zero downstream,
    // so both are named here instead.
    if (pack.sources.length === 0 || pack.taxonomy.length === 0) {
      unresolved.push({ ...industry, reason: "pack_empty" });
      continue;
    }
    packs.push(pack);
  }

  return { packs, industries, unresolved, noSubscribers, unkeyed };
}

/**
 * Give an org the seeded banking/financial-services pack if it has none.
 *
 * `update: {}` on purpose — the same shape as `ensureCompanyMonitorAxis`. The live pack is
 * a human's: they toggle sources off and edit the taxonomy in the UI, and re-running a
 * seed must never silently discard that. "if absent" is the whole contract.
 */
export async function ensureSeedPack(
  orgId: string
): Promise<{ industryKey: string; created: boolean }> {
  const industryKey = normalizeIndustryKey(BANKING_IL_PACK.industryKey);
  // Unreachable with the seed as written, but a degenerate key must never be written:
  // every unrelated industry would collide onto it.
  if (!industryKey) return { industryKey: "", created: false };

  const existing = await prisma.radarSourcePack.findUnique({
    where: { orgId_industryKey: { orgId, industryKey } },
    select: { id: true },
  });

  await prisma.radarSourcePack.upsert({
    where: { orgId_industryKey: { orgId, industryKey } },
    create: {
      orgId,
      industryKey,
      sources: BANKING_IL_PACK.sources,
      taxonomy: BANKING_IL_PACK.taxonomy,
    },
    update: {},
    select: { id: true },
  });

  return { industryKey, created: !existing };
}
