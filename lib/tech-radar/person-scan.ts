/**
 * The person-outward run, end to end.
 *
 * Direction, in one place so it can be checked at a glance (v3, Phase B):
 *
 *   fixed source packs (RSS, free) + a NARROW named-query channel (paid, code-written)
 *   -> floor 0 in code, per person, BEFORE any model is paid
 *   -> shared triage, which also tags each item into the pack's CLOSED taxonomy
 *   -> one write-up per surviving item
 *   -> floor 1 in code: tag overlap, per person
 *   -> the chooser: ONE Haiku call per person over everything that cleared the floors
 *   -> AxisMatch rows -> judgeAndDraft: the UNCHANGED Opus veto, then the draft
 *
 * v2 ran axes -> free-text searchQueries -> six news providers -> per-AXIS LLM fit. Two
 * measurements killed it on 2026-08-31. First, the money: serper 0/1500 remaining for the
 * month, serpapi 0/1500, tavily 0/950 — Bank Hapoalim's research ran on FIVE news items,
 * so what the radar could SEE had become a function of the budget. Second, the relevance:
 * a feature about a retail bank in the PHILIPPINES was offered to the head of retail
 * banking at Bank Hapoalim, because an LLM-written English query goes wherever the English
 * coverage is and nothing downstream ever asked whether an item was in her market.
 *
 * So the flow inverts. RSS has no quota, and the floors that decide relevance are pure
 * code that runs before anything is billed — which is also the cost argument: yesterday a
 * scan cost ~$1 because every (item, person) pair reached a judge.
 *
 * v1, for completeness, ran org -> tracked companies -> per-COMPANY fit -> pick someone who
 * works there. That path still exists for the company-outward radar (scan.ts) and is
 * untouched by any of this.
 */
import { prisma } from "@/lib/prisma";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import { fetchPoolNews, type PoolQuery, type PoolResult } from "@/lib/tech-radar/fetch-pool-news";
import { triageAll, type PoolItem } from "@/lib/tech-radar/triage";
import { synthesizeItem } from "@/lib/tech-radar/item";
import { readPage } from "@/lib/research/read-page";
import { canonicalizeSourceUrl } from "@/lib/news/canonical-url";
import { upsertTechItem } from "@/lib/tech-radar/persist";
import { capPoolByAxis } from "@/lib/tech-radar/axis-fit";
import { splitFresh, freshnessSpread, type FreshnessSpread } from "@/lib/tech-radar/freshness";
import { judgeAndDraft } from "@/lib/tech-radar/judge-and-draft";
import { SHAREWORTHY_FLOOR, STATURE_FLOOR, type TriageVerdict } from "@/lib/tech-radar/types";
import { judgeAcceptance, isIsraeliSource, type AcceptanceReport } from "@/lib/tech-radar/acceptance";
import { layer3Expired, articlesByLayer as computeArticlesByLayer, type AxisKindName } from "@/lib/tech-radar/layers";
import { resolvePacksForOrg, normalizeIndustryKey } from "@/lib/tech-radar/source-packs";
import { fetchSourcePack, type SourceFetchReport } from "@/lib/tech-radar/fetch-sources";
import type { SourcePack, TaxonomyTag } from "@/lib/tech-radar/sources";
import { personTags, type PersonTagLink, type PersonTagSet } from "@/lib/tech-radar/person-tags";
import {
  prefilter,
  tagOverlap,
  passesFloors,
  floorThresholds,
  homeMarket,
  type EntityTag,
  type FloorItem,
  type TagOverlap,
} from "@/lib/tech-radar/match-floors";
import { chooseForPerson, type ChooserCandidate, type ChooserPerson } from "@/lib/tech-radar/chooser";
import { buildDropoutRows, type DropoutFloorResult, type DropoutVerdict } from "@/lib/tech-radar/dropouts";
import { careerSummary } from "@/lib/tech-radar/career";
import type { PersonAudience, PersonScope } from "@/lib/tech-radar/person-profile";

/**
 * Queries fetched per axis — a BUILD-REPORT number now, not a fetch cap.
 *
 * Phase B took `RadarAxis.searchQueries` out of the scan entirely: the pool comes from
 * source packs, and the only paid queries are the deterministic named ones below. The
 * constant survives because `build-profiles.ts` still reports what a rebuild's axes would
 * have asked for (layerQueries / industryShared), and that report has to use the same cap
 * the number was always quoted under rather than re-deriving one.
 *
 * TEMPORARY, and still env-overridable for the same reason it was: serper is the only
 * provider with quota left until the monthly counters reset.
 *
 * TODO(2026-09-01): drop RADAR_MAX_QUERIES_PER_AXIS from the environment and let this go
 * back to 3.
 */
export const MAX_QUERIES_PER_AXIS = Number(process.env.RADAR_MAX_QUERIES_PER_AXIS) || 3;
/**
 * Triage cost scales with this and nothing else useful. 677 items cost ~$1 for 30
 * survivors on 2026-08-23 — over half the daily budget. 200 keeps a run near $0.35.
 */
const MAX_POOL_ITEMS = 200;
const MAX_SYNTHESIS_PER_RUN = 12;

/**
 * The narrow paid channel's ceiling, per scan.
 *
 * The spec's number ("~10-20 שאילתות לסריקה"). This is the ONLY path in the scan that
 * spends a news-provider call, so the cap is the whole budget conversation: 20 names at
 * one call each, inside the existing `reserveNewsCall` guards.
 */
export const MAX_NAMED_QUERIES = 20;

/**
 * Shortest name allowed to become a query. Two characters buys nothing but noise
 * ("או", "AI" as a company name is somebody else's problem), and a one-character
 * "competitor" would return the whole web.
 */
const MIN_NAMED_QUERY_CHARS = 3;

/**
 * The `AxisMatch.score` a chooser pick is written with, by the floor-1 tier that got it
 * there.
 *
 * Deterministic, and all three sit above `AXIS_FIT_FLOOR` (0.5) because the judgement has
 * already been made by the time a row is written — the chooser picked it, and the Opus veto
 * is still ahead of it. The tiers are ordered rather than equal so the confidence a draft
 * carries (`axisScore * personWeight` in judge-and-draft.ts) still says whether the item
 * reached this person by NAME, by their own subject, or by the shared industry net.
 *
 * This replaces `judgeAxisFit`'s per-pair LLM score, which is the ~$1-a-scan line item
 * Phase B exists to delete.
 */
export const CHOOSER_MATCH_SCORE: Record<"entity" | "focused" | "broad", number> = {
  entity: 0.95,
  focused: 0.85,
  broad: 0.7,
};

/** What one axis asked for this run, and what came back. Rendered as explained silence. */
export type AxisStat = {
  axisId: string;
  label: string;
  queries: number;
  results: number;
  /** A Hebrew query that returned no Israeli source — a warning, not a failure. */
  hebrewNoIsraeliSource: boolean;
};

const HEBREW_RE = /[֐-׿]/;

/**
 * Attribute each query and each returned item back to the axes that asked for it. The
 * pool is deduplicated across axes, so one query can serve several — every subscriber
 * is credited, which is why this cannot be a simple per-query count.
 *
 * Phase B narrows what this can honestly describe: only the NAMED channel is asked for by
 * an axis, so `queries` counts named queries and nothing else. The pack channel carries no
 * axis attribution at all before floor 1 (an outlet is pulled for an industry, not for a
 * subject), and giving `results` a second meaning there would make one number answer two
 * questions. What the packs produced is reported per SOURCE instead — `perSource` — and
 * what reached a person is `floorCandidates` and the AxisMatch rows.
 *
 * `freshItems` and `preGateItems` answer different questions. `results` is read off
 * `freshItems` (post-freshness-gate) because that is what actually reached triage — an
 * honest 0 there is a quiet week, not a bug. `hebrewNoIsraeliSource` is checked against
 * `preGateItems` (defaults to `freshItems` when the caller has no separate pre-gate
 * list): an Israeli source that merely went stale must not read as "this query never
 * finds Israeli coverage" — that would be a false diagnosis of a different failure.
 */
export function tallyAxisStats(
  axes: { id: string; label: string }[],
  pool: { query: string; axisIds: string[] }[],
  freshItems: { url: string; companyIds: string[] }[],
  preGateItems: { url: string; companyIds: string[] }[] = freshItems
): AxisStat[] {
  return axes.map((axis) => {
    const mine = pool.filter((p) => p.axisIds.includes(axis.id));
    const got = freshItems.filter((i) => i.companyIds.includes(axis.id));
    const everGot = preGateItems.filter((i) => i.companyIds.includes(axis.id));
    const askedInHebrew = mine.some((p) => HEBREW_RE.test(p.query));
    return {
      axisId: axis.id,
      label: axis.label,
      queries: mine.length,
      results: got.length,
      hebrewNoIsraeliSource: askedInHebrew && !everGot.some((i) => isIsraeliSource(i.url)),
    };
  });
}

/** One source's pull, plus WHICH pack pulled it — the same host can serve two industries. */
export type PerSourceStat = SourceFetchReport & { industryKey: string };

export type PackStat = {
  industryKey: string;
  label?: string;
  /** Enabled sources in the pack. */
  sources: number;
  taxonomyTags: number;
  /** Items the pull returned, after the pack's own cross-source dedupe. */
  items: number;
};

/** An industry whose people got nothing from the pack layer, and why. Never merely absent. */
export type UnresolvedIndustryStat = {
  industryKey: string;
  labels: string[];
  people: number;
  /** `no_pack` / `pack_empty` from the resolver, plus `no_subscribers` and `unkeyed`. */
  reason: string;
};

export type PersonScanReport = {
  axes: number;
  queriesRun: number;
  /**
   * DISTINCT query strings the pool asked for, before any provider was called.
   *
   * Phase B: these are the NAMED channel's deterministic queries — competitor, product and
   * employer names, built in code. It is still the number a human budgets a nearly-exhausted
   * news quota against, and it is still not `queriesRun` (which counts what the fetcher
   * executed, including the broaden-retry).
   */
  uniqueQueries: number;
  /**
   * Pool entries served from the query cache this run — no provider call made for them.
   * Threaded from PoolResult.cachedQueries (fetch-pool-news.ts) the same way freshness/
   * uniqueQueries are threaded, below. Matters specifically because the query cache
   * caches EMPTY results for EMPTY_CACHE_TTL_MINUTES: a re-fired scan within that window
   * shows `queriesRun: 0` and `quotaLikely: false`, which reads as "genuinely nothing
   * this week" when the truth is "we replayed cached empties" — this is what lets a
   * human reading the report tell the two apart.
   */
  cachedQueries: number;
  poolItems: number;
  worthSharing: number;
  itemsWritten: number;
  candidates: number;
  vetoed: number;
  drafted: number;
  /** How many pool items the cap discarded, so a truncated run says so. */
  poolDropped: number;
  /** Published outside the 30-day window. Research gets no grace. */
  staleDropped: number;
  /** No date could be extracted, so the item could not be proven fresh. */
  undatedDropped: number;
  /** On-topic but weightless. The failure mode `stature` was added to name. */
  relevantButLight: number;
  /** Items whose page could not be read, so their summary is snippet-only. */
  snippetOnly: number;
  /** Did the run clear the pilot's bar, and if not, what was missing. */
  acceptance: AcceptanceReport;
  /** Why candidates were dropped, counted by reason. Never a bare number. */
  dropReasons: Record<string, number>;
  triageByKind: { kind: string; seen: number; passed: number }[];
  quotaExhausted: boolean;
  /**
   * How old the surviving pool actually is, in days. The drop COUNTS are staleDropped and
   * undatedDropped above; this is the age of what got through, which is a different
   * question and the one the 2026-08-26 report could not answer.
   */
  freshness: FreshnessSpread;
  /** Per-provider tally for the morning report — see PoolResult["providerStats"]. Empty
   *  when the named channel had no name to ask about, which costs nothing and says so. */
  providerStats: PoolResult["providerStats"];
  /**
   * Matches this run made, counted by the DEEPEST layer they reached (see
   * lib/tech-radar/layers.ts `articlesByLayer`). An item matched for one person by an
   * INDUSTRY axis and for another by a ROLE_COMPANY axis counts once, at layer 4.
   */
  articlesByLayer: { layer1: number; layer3: number; layer4: number };
  /**
   * Labels of axes that contributed no NAMED query this run because every subscriber's
   * layer-3 "what occupies them now" fact (`PersonAxis.evidence.layerEvidence`) aged past
   * LAYER3_QUERY_TTL_DAYS.
   *
   * In practice this only ever fires on ROLE_COMPANY axes, never on COMPANY_MONITOR
   * ones: `ensureCompanyMonitorAxis` (axis-store.ts) attaches no per-person link at all
   * — a company monitor belongs to the employer, not a subscriber — so a COMPANY_MONITOR
   * axis can never even reach this check, despite COMPANY_MONITOR being the axis KIND
   * `layers.ts` calls "layer 3". This is a genuine naming quirk, not a bug.
   *
   * The axis itself is untouched — a future re-research can refresh the fact and bring it
   * back — and it still classifies items through its tags. This only says it asked no
   * paid question today.
   */
  expiredLayer3: string[];
  /**
   * ── Phase B additions ──────────────────────────────────────────────────────
   */
  /** Per-outlet pull counts. "0 נמצאו" with no per-source breakdown is the report this
   *  codebase has been burned by more than once (2026-08-27: one provider silently
   *  dropped 100% of its results and it read as a quiet week). */
  perSource: PerSourceStat[];
  /** One row per pack actually pulled. */
  sourcePacks: PackStat[];
  /** Industries that got no usable pack. Reported, never silently empty. */
  unresolvedIndustries: UnresolvedIndustryStat[];
  /** Tracked people whose industry has no pack: they can still be reached by the named
   *  channel and by their own tags, but no outlet was pulled for them. Names, so a human
   *  can act on it. */
  peopleWithoutPack: string[];
  /** Deterministic named queries built this run. Zero is a legitimate answer and costs
   *  nothing — it means nobody tracks a name yet. */
  namedQueries: number;
  /** People the floors actually ran for. */
  peopleScanned: number;
  /**
   * People whose `audience.geography` carried no market, so `homeMarket()` returned null
   * and the geography gate was SKIPPED for them.
   *
   * Reported by NAME because a skipped gate that reads as a passed gate is precisely the
   * class of bug this codebase keeps hitting: nothing filtered their items by market, and
   * a run that shows zero `geography` drops for them is not evidence that the gate works.
   */
  geoGateSkipped: string[];
  /** (item, person) pairs that cleared floors 0 and 1 and reached the chooser. The spec's
   *  own success metric: ">=3 candidates per person per scan". */
  floorCandidates: number;
  /** Chooser calls made — one per person WITH candidates — and picks returned. */
  chooserCalls: number;
  chooserPicks: number;
  /** Rejections per gate, keyed by a member of DROPOUT_FLOORS. Counted from every
   *  (item, person) decision, uncapped — unlike the persisted rows, which are capped. */
  floorDrops: Record<string, number>;
  /** RadarDropout rows actually written. Lower than the sum of floorDrops when the
   *  per-run cap trimmed them; 0 with non-empty floorDrops means the write failed. */
  dropoutsWritten: number;
  /**
   * Pool items that were triaged WITH a closed taxonomy behind them — i.e. items the
   * tagging layer was actually asked about. Zero means the layer never ran at all (no pack
   * resolved, or every item came from the named channel, which is triaged with no
   * taxonomy on purpose).
   */
  taxonomyOffered: number;
  /**
   * Written items carrying at least one industry tag.
   *
   * The counter this run exists to have: on 2026-09-01 a live scan wrote 11 items and
   * tagged NONE of them, and the report could not say so — floor 1 could then only ever
   * fire on the entity tier and the whole closed-taxonomy layer was invisible in its own
   * absence. Read against `taxonomyOffered`: 0 tagged with 0 offered is a named channel
   * doing its job, 0 tagged with n offered is a broken tagging layer.
   */
  itemsTagged: number;
};

const EMPTY: PersonScanReport = {
  axes: 0, queriesRun: 0, uniqueQueries: 0, cachedQueries: 0, poolItems: 0, worthSharing: 0, itemsWritten: 0,
  candidates: 0, vetoed: 0, drafted: 0, poolDropped: 0, staleDropped: 0, undatedDropped: 0,
  relevantButLight: 0, snippetOnly: 0,
  acceptance: { weighty: 0, israeliSource: 0, israelRelevant: 0, met: false, shortfall: "לא נסרק" },
  dropReasons: {}, triageByKind: [], quotaExhausted: false,
  freshness: { freshest: null, median: null, oldest: null },
  providerStats: [],
  articlesByLayer: { layer1: 0, layer3: 0, layer4: 0 },
  expiredLayer3: [],
  perSource: [], sourcePacks: [], unresolvedIndustries: [], peopleWithoutPack: [],
  namedQueries: 0, peopleScanned: 0, geoGateSkipped: [], floorCandidates: 0,
  chooserCalls: 0, chooserPicks: 0, floorDrops: {}, dropoutsWritten: 0,
  taxonomyOffered: 0, itemsTagged: 0,
};

function countBy(reasons: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

/**
 * True unless EVERY one of an axis's subscribers has an expired layer-3 fact
 * (`layer3Expired`, layers.ts). Shared by `personScan` and `poolQueryCount` so the two
 * cannot drift.
 */
function isPoolEligible(people: { evidence: unknown }[], now: Date): boolean {
  return !(people.length > 0 && people.every((p) => layer3Expired(p.evidence, now)));
}

// ─── The narrow named-query channel ──────────────────────────────────────────

/** One person's NAMES, as the query builder sees them. Structural so the builder stays
 *  pure and testable with no database. */
export type NamedQuerySource = {
  /** PERSON_ENTITY tags: the competitor, product, project or regulator they watch. */
  entities: { name: string; aliases: string[]; axisId: string }[];
  /** Their employer, and the axes that speak for it (a COMPANY_MONITOR, when there is one). */
  employers: { name: string; axisIds: string[] }[];
};

/**
 * The paid channel's queries, built in CODE.
 *
 * No LLM writes a query here, and that is the point rather than an optimisation: the free
 * LLM-written queries are what produced the Philippines. A name is a name in any language,
 * so each form — the canonical spelling and every alias, both scripts — becomes its own
 * query and the provider layer derives the locale from the script (`localeForQuery`).
 *
 * Deduped on `normalizeQuery` so two people watching One Zero pay for it once, and sorted
 * on that same key so the same population always produces the same queries in the same
 * order. A pool whose contents depend on Map insertion order cannot be reasoned about
 * against a quota, and a re-fired scan would miss the query cache.
 *
 * Attribution is kept (`axisIds`) because `tallyAxisStats` renders an axis that asked for
 * something and got nothing as explained silence.
 */
export function buildNamedQueries(people: NamedQuerySource[]): PoolQuery[] {
  const byKey = new Map<string, { query: string; axisIds: Set<string> }>();

  const add = (raw: string, axisIds: string[]) => {
    const name = (raw ?? "").trim();
    // Length on the letters, not on the string: "ל.ג." is not a searchable name.
    if (name.replace(/[^\p{L}\p{N}]+/gu, "").length < MIN_NAMED_QUERY_CHARS) return;
    const key = normalizeQuery(name);
    if (!key) return;
    const entry = byKey.get(key) ?? { query: name, axisIds: new Set<string>() };
    for (const id of axisIds) if (id) entry.axisIds.add(id);
    byKey.set(key, entry);
  };

  for (const person of people ?? []) {
    for (const entity of person?.entities ?? []) {
      add(entity?.name ?? "", [entity?.axisId ?? ""]);
      for (const alias of entity?.aliases ?? []) add(alias, [entity?.axisId ?? ""]);
    }
    for (const employer of person?.employers ?? []) {
      add(employer?.name ?? "", employer?.axisIds ?? []);
    }
  }

  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MAX_NAMED_QUERIES)
    .map(([, v]) => ({ query: v.query, companyIds: [...v.axisIds].sort() }));
}

// ─── Reading the person rows ─────────────────────────────────────────────────

/** `PersonProfile.audience`, defensively. Untyped Json written by a model — a malformed
 *  value must read as "not researched", never as a claim. */
function readAudience(raw: unknown): PersonAudience | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const type = Array.isArray(o.type) ? o.type.filter((t): t is string => typeof t === "string") : [];
  return {
    type: type as PersonAudience["type"],
    who: typeof o.who === "string" ? o.who : "",
    geography: typeof o.geography === "string" ? o.geography : "",
  };
}

/** `PersonProfile.scope`, defensively. An unreadable scope is an EMPTY scope: notOwns
 *  drops items, and inventing lines from garbage would drop the wrong ones. */
function readScope(raw: unknown): PersonScope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { owns: list(o.owns), notOwns: list(o.notOwns) };
}

/** `PersonAxis.evidence.aliases` — the other-script spellings of an entity name. */
function readAliases(evidence: unknown): string[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const raw = (evidence as { aliases?: unknown }).aliases;
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
}

function readDateIso(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const layer = (evidence as { layerEvidence?: unknown }).layerEvidence;
  if (!layer || typeof layer !== "object") return null;
  const iso = (layer as { dateIso?: unknown }).dateIso;
  return typeof iso === "string" && iso.trim() ? iso.trim() : null;
}

function readPersonDecision(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const v = (evidence as { personDecision?: unknown }).personDecision;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Compares two tags the way a human would: same characters, any casing or padding, and
 *  hyphen-insensitive — the taxonomy writes "אשראי-צרכני" and an axis label writes
 *  "אשראי צרכני", and those are one tag. */
function tagKey(tag: string): string {
  return String(tag ?? "").trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Every spelling of a taxonomy entry that a caller might hand us, mapped to the CANONICAL
 * tag string.
 *
 * Both `tag` and `label` are indexed because a profile builder writes an axis label as
 * classification language ("אשראי צרכני ומשקי בית" — the label) while triage echoes the
 * key ("אשראי-צרכני"). Matching is exact-after-normalisation and nothing else: a near miss
 * is left alone rather than snapped onto a neighbour, exactly as `industryTagsFrom` drops
 * an off-list tag instead of coercing it. A coerced tag reaches a real person on a
 * judgement nobody made.
 */
function taxonomyIndex(taxonomy: readonly TaxonomyTag[] | undefined): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of taxonomy ?? []) {
    const tag = typeof entry?.tag === "string" ? entry.tag.trim() : "";
    if (!tag) continue;
    index.set(tagKey(tag), tag);
    const label = typeof entry?.label === "string" ? entry.label.trim() : "";
    if (label && !index.has(tagKey(label))) index.set(tagKey(label), tag);
  }
  return index;
}

/** `ensureIndustryAxis` labels an INDUSTRY axis `ענף: <canonical>`; the prefix is storage,
 *  not vocabulary. Stripped here rather than inside person-tags.ts, which is pure and must
 *  not know how this repo spells a label. */
function axisTagText(label: string): string {
  return String(label ?? "").replace(/^\s*ענף\s*:\s*/u, "").trim();
}

type ProfileRow = {
  id: string;
  roleLens: string | null;
  personalNotes: string | null;
  audience: unknown;
  scope: unknown;
  employerTrackedCompanyId: string | null;
  contact: {
    id: string;
    ownerId: string;
    fullName: string;
    hebrewFirstName: string | null;
    currentTitle: string | null;
    currentCompany: string | null;
    experience: unknown;
  };
  axes: {
    axisId: string;
    personProfileId: string;
    source: string;
    mutedAt: Date | string | null;
    agenda: boolean;
    weight: number;
    rationale: string;
    evidence: unknown;
    axis: { id: string; label: string; kind: string };
  }[];
};

/** One person, with everything the floors, the chooser and the named channel need. */
type ScanPerson = {
  profileId: string;
  contactId: string;
  fullName: string;
  industryKey: string | null;
  audience: PersonAudience | null;
  scope: PersonScope | null;
  globalPlayers: string[];
  tags: PersonTagSet;
  /**
   * tagKey -> the axis that contributed it, so a pick can be written as an AxisMatch on
   * the axis it actually came through.
   *
   * Two maps, and the split is load-bearing. The industry net contributes the pack's whole
   * vocabulary, so almost every tag is ALSO a net tag; attributing a match to the net when
   * the person has their own axis for that subject would write the row on a shared axis and
   * spill a personal judgement onto every other subscriber of it. Narrow first, net only as
   * the fallback — which is also the order the tiers themselves are checked in.
   */
  axisIdByTag: Map<string, string>;
  axisIdByNetTag: Map<string, string>;
  axisIdByEntity: Map<string, string>;
  chooser: ChooserPerson;
  named: NamedQuerySource;
  /** True when `homeMarket()` had no lexicon for this person's market: the geography gate
   *  did not run for them, and the report has to say so. */
  geoGateSkipped: boolean;
  /** Set at floor 0: the pool urls this person may still be matched against. */
  passedPrefilter: Set<string>;
};

/**
 * Turn the loaded rows into the people the run works on.
 *
 * The INDUSTRY axis decides which pack is theirs — the same label the pack resolver groups
 * on, normalised by the same function, so a person's key and their pack's key cannot
 * disagree. A person with no INDUSTRY axis gets NO pack rather than the org's only one:
 * handing them a neighbouring industry's vocabulary is the 2026-08-26 merge leak with new
 * clothes (Phoenix's insurance rivals in Bank Leumi's searches). They are reported in
 * `peopleWithoutPack` instead.
 */
function buildScanPeople(profiles: ProfileRow[], packByKey: Map<string, SourcePack>): ScanPerson[] {
  const people: ScanPerson[] = [];

  for (const profile of profiles) {
    const links = Array.isArray(profile.axes) ? profile.axes : [];
    const industryKey =
      links
        .filter((l) => l.axis?.kind === "INDUSTRY" || l.axis?.kind === "INDUSTRY_TAG")
        .map((l) => normalizeIndustryKey(l.axis.label ?? ""))
        .find((k) => k && packByKey.has(k)) ??
      links
        .filter((l) => l.axis?.kind === "INDUSTRY" || l.axis?.kind === "INDUSTRY_TAG")
        .map((l) => normalizeIndustryKey(l.axis.label ?? ""))
        .find((k) => !!k) ??
      null;
    const pack = industryKey ? packByKey.get(industryKey) ?? null : null;
    const index = taxonomyIndex(pack?.taxonomy);

    const tagLinks: PersonTagLink[] = [];
    const axisIdByTag = new Map<string, string>();
    const axisIdByNetTag = new Map<string, string>();
    const axisIdByEntity = new Map<string, string>();
    const entities: { name: string; aliases: string[]; axisId: string }[] = [];
    let agenda: ChooserPerson["agenda"] = null;

    for (const link of links) {
      const kind = link.axis?.kind ?? "";
      const text = axisTagText(link.axis?.label ?? "");
      if (!text) continue;

      if (kind === "PERSON_ENTITY") {
        const aliases = readAliases(link.evidence);
        tagLinks.push({
          personProfileId: link.personProfileId,
          kind,
          source: link.source,
          mutedAt: link.mutedAt,
          tag: text,
          evidence: link.evidence,
        });
        if (link.mutedAt == null) {
          axisIdByEntity.set(tagKey(text), link.axisId);
          entities.push({ name: text, aliases, axisId: link.axisId });
        }
        continue;
      }

      // The industry NET, as tags. Phase A has not yet split the single INDUSTRY axis into
      // one INDUSTRY_TAG axis per taxonomy entry, and until it does, a subscription to the
      // net IS a subscription to the industry's whole vocabulary — which is what the net
      // has always meant. It stays the BROAD tier (two tags AND stature >= 0.8, the
      // existing INDUSTRY_ONLY_STATURE_FLOOR restated), so this widens recall without
      // moving any bar.
      //
      // A MANUAL link is exempt: person-tags.ts promotes a hand-attached tag to `focused`,
      // where ONE tag is enough, and expanding a manual industry subscription to fifty
      // focused tags would hand that person every item in the pack.
      const isNet = (kind === "INDUSTRY" || kind === "INDUSTRY_TAG") && link.source !== "MANUAL";
      const tags = isNet && pack ? pack.taxonomy.map((t) => t.tag) : [index.get(tagKey(text)) ?? text];

      for (const tag of tags) {
        tagLinks.push({
          personProfileId: link.personProfileId,
          kind,
          source: link.source,
          mutedAt: link.mutedAt,
          tag,
          evidence: link.evidence,
        });
        if (link.mutedAt != null) continue;
        const target = isNet ? axisIdByNetTag : axisIdByTag;
        if (!target.has(tagKey(tag))) target.set(tagKey(tag), link.axisId);
      }

      if (link.agenda && link.mutedAt == null && !agenda) {
        agenda = {
          label: link.axis.label,
          personDecision: readPersonDecision(link.evidence),
          dateIso: readDateIso(link.evidence),
        };
      }
    }

    const audience = readAudience(profile.audience);
    const scope = readScope(profile.scope);
    const employerAxisIds = links
      .filter((l) => l.axis?.kind === "COMPANY_MONITOR" && l.mutedAt == null)
      .map((l) => l.axisId);

    people.push({
      profileId: profile.id,
      contactId: profile.contact.id,
      fullName: profile.contact.fullName || profile.contact.id,
      industryKey,
      audience,
      scope,
      globalPlayers: pack?.globalPlayers ?? [],
      tags: personTags({ id: profile.id }, tagLinks),
      axisIdByTag,
      axisIdByNetTag,
      axisIdByEntity,
      chooser: {
        fullName: profile.contact.fullName,
        currentTitle: profile.contact.currentTitle,
        employer: profile.contact.currentCompany,
        roleLens: profile.roleLens,
        audience,
        scope,
        agenda,
        career: careerSummary(profile.contact.experience),
        personalNotes: profile.personalNotes,
      },
      named: {
        entities,
        employers: profile.contact.currentCompany
          ? [{ name: profile.contact.currentCompany, axisIds: employerAxisIds }]
          : [],
      },
      geoGateSkipped: homeMarket(audience) === null,
      passedPrefilter: new Set<string>(),
    });
  }

  return people;
}

/**
 * The org's profiles, scoped through their axes.
 *
 * PersonProfile carries no orgId of its own, so the org is reached the way every other
 * radar query reaches it: through an ACTIVE axis of that org. A person with no axis at all
 * subscribes to nothing and would be matched against nothing.
 */
async function loadProfiles(orgId: string): Promise<ProfileRow[]> {
  return (await prisma.personProfile.findMany({
    where: { axes: { some: { axis: { orgId, status: "ACTIVE" } } } },
    select: {
      id: true,
      roleLens: true,
      personalNotes: true,
      audience: true,
      scope: true,
      employerTrackedCompanyId: true,
      contact: {
        select: {
          id: true, ownerId: true, fullName: true, hebrewFirstName: true,
          currentTitle: true, currentCompany: true, experience: true,
        },
      },
      axes: {
        where: { axis: { orgId, status: "ACTIVE" } },
        select: {
          axisId: true, personProfileId: true, source: true, mutedAt: true, agenda: true,
          weight: true, rationale: true, evidence: true,
          axis: { select: { id: true, label: true, kind: true } },
        },
      },
    },
  })) as unknown as ProfileRow[];
}

/**
 * What the NEXT scan would ask the PROVIDERS for, without asking them.
 *
 * Phase B moved the answer: the pack pull is free and unmetered, so the only billable
 * queries are the narrow named channel's. This counts those, through the same builder and
 * the same cap the run itself uses — a second implementation would drift and the number
 * would stop being the one that gets billed, which is the whole reason a human reads it
 * before firing a scan against a nearly-exhausted quota.
 *
 * `axes` still counts every subscribed axis, because that is what the rebuild report is
 * comparing against.
 */
export async function poolQueryCount(orgId: string): Promise<{ axes: number; uniqueQueries: number }> {
  const [axes, profiles] = await Promise.all([
    prisma.radarAxis.findMany({
      // Subscriber-less axes contribute nothing, exactly as in the run below.
      where: { orgId, status: "ACTIVE", people: { some: {} } },
      select: { id: true },
    }),
    loadProfiles(orgId),
  ]);
  const people = buildScanPeople(profiles, new Map());
  return { axes: axes.length, uniqueQueries: buildNamedQueries(people.map((p) => p.named)).length };
}

/**
 * Open (or resume) the RadarScanRun row a scan writes into.
 *
 * 2026-08-26 incident: `personScan` used to open its row inline, so an Inngest retry —
 * the function's step failed or timed out and Inngest re-executed it — created a BRAND
 * NEW row and re-fetched every query from scratch. One approved scan became four full
 * executions (156 provider calls instead of 39) because nothing remembered the row the
 * first attempt was already writing.
 *
 * The caller (inngest/functions/tech-radar-person-scan.ts) now opens this row inside its
 * own memoized `step.run("open-run", ...)`, BEFORE the scan step — Inngest replays a
 * completed step's result on retry rather than re-running it, so "open-run" executes
 * once per scan no matter how many times the scan step itself is retried, and every
 * attempt hands the same run id back in here.
 *
 * `runId` is honored only while that row is still open (`finishedAt === null`): a retry
 * that lands after the row was already closed — or whose id no longer exists — must
 * never write into a finished run's funnel, so it opens a fresh row instead, exactly as
 * a call with no `runId` at all would.
 */
export async function openScanRun(orgId: string, runId?: string): Promise<{ id: string }> {
  if (runId) {
    const existing = await prisma.radarScanRun.findUnique({
      where: { id: runId },
      select: { id: true, finishedAt: true },
    });
    if (existing && existing.finishedAt === null) {
      return { id: existing.id };
    }
  }
  return prisma.radarScanRun.create({ data: { orgId }, select: { id: true } });
}

/** One pool entry, whichever channel produced it. */
type ScanPoolItem = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  /**
   * The industry pack this item was pulled for — the PROVENANCE floor 0 compares against
   * the person's own industry. NULL for the narrow named channel, and `prefilter` treats a
   * null as unknown rather than as a mismatch: a Reuters story about One Zero belongs to
   * whoever tracks One Zero, not to an industry.
   */
  industryKey: string | null;
  /** The pack source that produced it, or null for the named channel. */
  sourceHost: string | null;
  /** Axis ids that ASKED for it. Only the named channel has any. */
  companyIds: string[];
  /** Round-robin bucket for the 200-item cap: the outlet, or the asking axis. */
  bucket: string;
};

export async function personScan(orgId: string, opts?: { runId?: string }): Promise<PersonScanReport> {
  // ── 0. Open (or resume, on a retry) the run row before any work ───────────
  // A crash leaves finishedAt null, which reads as a stuck run instead of silence —
  // and EVERY exit path below must close the row, or the UI shows a scan that never
  // happened.
  const run = await openScanRun(orgId, opts?.runId);
  /**
   * Per-axis query accounting, filled as the run progresses. An axis with zero results
   * is the difference between "the radar is broken" and "there was nothing this week" —
   * the decisions screen renders these as an explained silence, not a bug.
   */
  let axisStats: AxisStat[] = [];
  // Set as the run progresses and folded into EVERY exit path by finish(), rather than
  // added to each of the early returns by hand — which is how a field ends up present on
  // some of them and zero on the rest.
  let freshness = EMPTY.freshness;
  let uniqueQueries = 0;
  let cachedQueries = 0;
  let providerStats: PoolResult["providerStats"] = EMPTY.providerStats;
  let expiredLayer3: string[] = EMPTY.expiredLayer3;
  let articlesByLayer: PersonScanReport["articlesByLayer"] = EMPTY.articlesByLayer;
  // Appended to as each pack is pulled (never reassigned), and folded into every exit path
  // by finish() the same way as the fields above.
  const perSource: PerSourceStat[] = [];
  const sourcePacks: PackStat[] = [];
  let unresolvedIndustries: UnresolvedIndustryStat[] = [];
  let peopleWithoutPack: string[] = [];
  let namedQueries = 0;
  let peopleScanned = 0;
  let geoGateSkipped: string[] = [];
  let floorCandidates = 0;
  let chooserCalls = 0;
  let chooserPicks = 0;
  // Folded into every exit path by finish(), like the fields above: a run that dies before
  // the write-up still has to say whether the tagging layer was ever asked anything.
  let taxonomyOffered = 0;
  let itemsTagged = 0;
  /**
   * Every rejection, at every gate, for every (item, person) pair.
   *
   * Collected rather than written as they happen, and written ONCE at the end by finish():
   * one createMany per run, capped and ordered by `buildDropoutRows` (highest-scoring
   * first, because the rows that decide whether a bar should move are the near-misses).
   * Putting the write in finish() is what guarantees the freshness rejections survive the
   * "nothing fresh this week" exit — the earliest and most common early return there is.
   */
  const floorResults: DropoutFloorResult[] = [];
  const dropoutVerdicts: DropoutVerdict[] = [];

  const floorDropsOf = (): Record<string, number> =>
    countBy(floorResults.filter((r) => !r.pass).map((r) => String(r.floor ?? "unknown")));

  // The folded-in fields are Omit-ed from the argument on purpose: the last exit path
  // built its report without `freshness` and type-checked only because every other call
  // spread EMPTY. A caller must not be able to pass a stale value for a field finish()
  // owns, and must not have to invent one either.
  const finish = async (
    raw: Omit<
      PersonScanReport,
      | "freshness" | "uniqueQueries" | "cachedQueries" | "providerStats" | "expiredLayer3"
      | "articlesByLayer" | "perSource" | "sourcePacks" | "unresolvedIndustries"
      | "peopleWithoutPack" | "namedQueries" | "peopleScanned" | "geoGateSkipped"
      | "floorCandidates" | "chooserCalls" | "chooserPicks" | "floorDrops" | "dropoutsWritten"
      | "taxonomyOffered" | "itemsTagged"
    >
  ): Promise<PersonScanReport> => {
    // The evidence first: a scan that crashed on its own reporting must still have saved
    // why it rejected what it rejected.
    const rows = buildDropoutRows(run.id, dropoutVerdicts, floorResults);
    let dropoutsWritten = 0;
    if (rows.length > 0) {
      try {
        await prisma.radarDropout.createMany({ data: rows });
        dropoutsWritten = rows.length;
      } catch (err) {
        // Never fatal — the drop-outs are calibration evidence, not the run's output — and
        // never silent either: `dropoutsWritten: 0` beside a non-empty floorDrops is the
        // signal that this failed.
        console.error(`[radar] dropouts write failed run=${run.id}: ${(err as Error).message}`);
      }
    }

    const report: PersonScanReport = {
      ...raw,
      freshness, uniqueQueries, cachedQueries, providerStats, expiredLayer3, articlesByLayer,
      perSource, sourcePacks, unresolvedIndustries, peopleWithoutPack, namedQueries,
      peopleScanned, geoGateSkipped, floorCandidates, chooserCalls, chooserPicks,
      floorDrops: floorDropsOf(), dropoutsWritten, taxonomyOffered, itemsTagged,
    };
    // Named, never merely counted: a tagging layer that was asked and answered nothing is
    // the exact silence that let 11 untagged items look like a normal run.
    if (report.taxonomyOffered > 0 && report.itemsWritten > 0 && report.itemsTagged === 0) {
      console.warn(
        `[radar] tagging produced NOTHING org=${orgId} offered=${report.taxonomyOffered}` +
          ` written=${report.itemsWritten} tagged=0 — floor 1 can only fire on the entity tier`
      );
    }
    await prisma.radarScanRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        scanned: report.poolItems,
        topical: report.worthSharing,
        important: report.itemsWritten,
        connected: report.candidates,
        drafts: report.drafted,
        vetoed: report.vetoed,
        report: JSON.parse(JSON.stringify(report)),
        axisStats: axisStats.length ? JSON.parse(JSON.stringify(axisStats)) : undefined,
      },
    });
    return report;
  };

  // ── 1. The axes people actually subscribe to ──────────────────────────────
  // An axis with no subscribers represents nobody. That single condition is what makes
  // this run person-outward rather than company-outward.
  const axes = await prisma.radarAxis.findMany({
    where: { orgId, status: "ACTIVE", people: { some: {} } },
    select: {
      id: true, label: true, kind: true, weight: true,
      people: {
        select: {
          mutedAt: true, evidence: true,
          personProfile: { select: { id: true, contactId: true } },
        },
      },
    },
  });
  if (axes.length === 0) return finish(EMPTY);

  // Layer-3 query TTL (layers.ts LAYER3_QUERY_TTL_DAYS): an axis whose evidence named a
  // dated "what occupies them now" fact was built from something time-bound — once EVERY
  // subscriber's copy of that fact has gone stale, the axis stops asking PAID questions
  // this run. It still classifies items through its tags; only the named channel is gated,
  // because that is the only part of the intake that costs money. In practice this only
  // ever fires on ROLE_COMPANY axes: a COMPANY_MONITOR axis never gets a PersonAxis
  // subscriber at all (`ensureCompanyMonitorAxis` attaches no per-person link —
  // axis-store.ts), so it can never reach this check.
  const scanStart = new Date();
  const expiredAxisIds = new Set<string>();
  const expiredLayer3Labels: string[] = [];
  for (const axis of axes) {
    if (!isPoolEligible(axis.people, scanStart)) {
      expiredAxisIds.add(axis.id);
      expiredLayer3Labels.push(axis.label);
    }
  }
  expiredLayer3 = expiredLayer3Labels;

  // ── 2. The pool: fixed source packs, plus the narrow named channel ────────
  //
  // Packs first because they are FREE: RSS, or the site-restricted Google News feed for an
  // outlet whose own feed path we would be guessing at. No reserveNewsCall, by design —
  // metering the thing that replaces the metered thing would defeat the point.
  const resolution = await resolvePacksForOrg(orgId);
  const packByKey = new Map(resolution.packs.map((p) => [p.industryKey, p]));
  unresolvedIndustries = [
    ...resolution.unresolved.map((i) => ({
      industryKey: i.industryKey, labels: i.labels, people: i.people, reason: i.reason,
    })),
    // Every industry the org has must land in exactly one bucket. An industry whose only
    // subscriptions are muted represents nobody THIS scan — a legitimate reason for an
    // empty result, but a stated one.
    ...resolution.noSubscribers.map((i) => ({
      industryKey: i.industryKey, labels: i.labels, people: i.people, reason: "no_subscribers",
    })),
    ...resolution.unkeyed.map((u) => ({
      industryKey: "", labels: [u.label], people: 0, reason: "unkeyed",
    })),
  ];

  const profiles = await loadProfiles(orgId);
  const people = buildScanPeople(profiles, packByKey);
  peopleScanned = people.length;
  peopleWithoutPack = people.filter((p) => !p.industryKey || !packByKey.has(p.industryKey)).map((p) => p.fullName);
  geoGateSkipped = people.filter((p) => p.geoGateSkipped).map((p) => p.fullName);
  if (people.length === 0) {
    // Axes with subscribers but no readable profile behind them. Not silence: the run says
    // it had nobody to match anything to.
    console.warn(`[radar] no person profiles for org=${orgId} despite ${axes.length} subscribed axes`);
    return finish({ ...EMPTY, axes: axes.length });
  }

  const pool: ScanPoolItem[] = [];
  const poolUrls = new Set<string>();
  const addToPool = (item: ScanPoolItem) => {
    // Canonicalised once, at the door, and deduped across packs and channels: the same
    // story reaching us from Globes' feed and from a named query is one item, and paying
    // to triage it twice is paying twice for one answer.
    const url = canonicalizeSourceUrl(item.url);
    if (!url || poolUrls.has(url)) return;
    poolUrls.add(url);
    pool.push({ ...item, url });
  };

  for (const pack of resolution.packs) {
    let pulled = 0;
    try {
      const { items, perSource: sources } = await fetchSourcePack(pack);
      pulled = items.length;
      perSource.push(...sources.map((s) => ({ ...s, industryKey: pack.industryKey })));
      for (const item of items) {
        addToPool({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          publishedAt: item.publishedAt,
          industryKey: pack.industryKey,
          sourceHost: item.sourceHost,
          companyIds: [],
          // Per-SOURCE round-robin under the pool cap (the spec's capPoolBySource), reusing
          // the tested round-robin: one prolific outlet must not be able to fill the cap.
          bucket: `source:${item.sourceHost}`,
        });
      }
    } catch (err) {
      // One dead pack cannot cost the others, and the failure is named rather than counted
      // as a quiet week.
      console.error(`[radar] pack pull failed org=${orgId} industry=${pack.industryKey}: ${(err as Error).message}`);
      perSource.push({
        host: pack.industryKey, name: pack.label ?? pack.industryKey, items: 0,
        via: "rss", feedUrl: "", error: `pack pull failed: ${(err as Error).message}`,
        industryKey: pack.industryKey,
      });
    }
    sourcePacks.push({
      industryKey: pack.industryKey,
      ...(pack.label ? { label: pack.label } : {}),
      sources: pack.sources.filter((s) => s.enabled).length,
      taxonomyTags: pack.taxonomy.length,
      items: pulled,
    });
  }

  // The narrow named channel — the ONE remaining paid path. Competitor and employer names
  // only, built deterministically in code (buildNamedQueries); no LLM writes a query.
  const namedPool = buildNamedQueries(
    people.map((p) => ({
      entities: p.named.entities.filter((e) => !expiredAxisIds.has(e.axisId)),
      employers: p.named.employers.map((e) => ({
        ...e,
        axisIds: e.axisIds.filter((id) => !expiredAxisIds.has(id)),
      })),
    }))
  );
  namedQueries = namedPool.length;
  uniqueQueries = namedPool.length;
  let news: PoolResult = { items: [], queriesRun: 0, cachedQueries: 0, quotaLikely: false, providerStats: [] };
  if (namedPool.length > 0) {
    news = await fetchPoolNews(namedPool);
    providerStats = news.providerStats;
    cachedQueries = news.cachedQueries;
    for (const item of news.items) {
      addToPool({
        title: item.title,
        url: item.url,
        snippet: item.snippet ?? "",
        publishedAt: item.publishedAt ?? null,
        industryKey: null,
        sourceHost: null,
        companyIds: item.companyIds,
        bucket: `axis:${item.companyIds[0] ?? "named"}`,
      });
    }
  }

  // Hard gate (26.8): only items published in the last 30 days go anywhere —
  // research included, no per-kind grace. An item whose date cannot be extracted
  // is rejected rather than demoted: an undated item shown as if it were this
  // week's is worse than one we never sent.
  const now = new Date();
  const { fresh, stale, undated } = splitFresh(pool, now);
  freshness = freshnessSpread(fresh, now);
  const freshnessDrops: Record<string, number> = {};
  if (undated.length > 0) freshnessDrops.no_extractable_date = undated.length;
  if (stale.length > 0) freshnessDrops.older_than_window = stale.length;
  for (const item of undated) {
    floorResults.push({ url: item.url, pass: false, floor: "freshness", reason: "no_extractable_date", title: item.title });
  }
  for (const item of stale) {
    floorResults.push({ url: item.url, pass: false, floor: "freshness", reason: "older_than_window", title: item.title });
  }

  // Recorded before any filtering below this point — and only over the named channel, the
  // only one an axis asks for (see tallyAxisStats). Recorded AFTER the freshness gate, so
  // a stale-only axis does not look productive.
  axisStats = tallyAxisStats(
    axes.map((a) => ({ id: a.id, label: a.label })),
    namedPool.map((q) => ({ query: q.query, axisIds: q.companyIds })),
    fresh.filter((i) => i.industryKey === null),
    news.items
  );
  if (fresh.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length, dropReasons: freshnessDrops,
    });
  }

  // ── 2b. Floor 0, in code, BEFORE any model is paid ────────────────────────
  //
  // This is the cost argument for the whole redesign. A capital-markets story used to be
  // triaged, tagged, judged and vetoed — four paid stages — to reach the same "no" that one
  // string comparison reaches here, and a Philippine retail-bank feature reached a real
  // person because nothing ever asked whether an item was in her market.
  //
  // An item survives if AT LEAST ONE person can still receive it; the rejection is recorded
  // per (item, person), because the same article legitimately dies for Pazit on `not_owns`
  // and for Erez on something else, and both facts are evidence.
  const prefiltered: ScanPoolItem[] = [];
  for (const item of fresh) {
    const floorItem: FloorItem = {
      title: item.title,
      // The snippet is all the text that exists this early — the write-up comes later. Its
      // absence weakens the check; inventing text would corrupt it.
      summary: item.snippet,
      url: item.url,
      industryKey: item.industryKey,
    };
    let anyPassed = false;
    for (const person of people) {
      const verdict = prefilter(floorItem, {
        industryKey: person.industryKey,
        audience: person.audience,
        scope: person.scope,
        globalPlayers: person.globalPlayers,
      });
      if (verdict.pass) {
        person.passedPrefilter.add(item.url);
        anyPassed = true;
        continue;
      }
      floorResults.push({
        url: item.url,
        pass: false,
        // The stable code the calibration queries read; `reason` keeps the detail (the
        // notOwns line that hit, the foreign market, the pack that did not match).
        floor:
          verdict.reason === "industry_mismatch" ? "industry"
          : verdict.reason === "not_owned" ? "not_owns"
          : "geography",
        reason: [verdict.reason, verdict.detail].filter(Boolean).join(": "),
        contactId: person.contactId,
        title: item.title,
      });
    }
    if (anyPassed) prefiltered.push(item);
  }
  if (prefiltered.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length,
      dropReasons: { ...freshnessDrops, ...floorDropsOf() },
    });
  }

  // ── 3. Shareworthiness triage, once per item, plus the closed-taxonomy tags ─
  // Capped before triage, round-robin across SOURCES, so the cut never starves one outlet
  // and the bill stays predictable.
  const capped = capPoolByAxis(
    prefiltered.map((item) => ({ url: item.url, publishedAt: item.publishedAt, companyIds: [item.bucket], item })),
    MAX_POOL_ITEMS
  );
  if (capped.dropped > 0) {
    console.log(`[radar] pool capped org=${orgId} kept=${capped.kept.length} dropped=${capped.dropped}`);
  }
  const keptItems = capped.kept.map((k) => k.item);
  const itemByUrl = new Map(keptItems.map((i) => [i.url, i]));

  // Grouped by INDUSTRY, and each group triaged with ITS OWN taxonomy. Never a merged
  // union: two industries' vocabularies in one prompt is the 2026-08-26 axis-merge leak in
  // a new costume — that incident put Phoenix's insurance rivals into Bank Leumi's
  // searches, and a shared tag list would put them into each other's classifications.
  // The named channel (industryKey null) is triaged with NO taxonomy, so its verdicts carry
  // no `industryTags` key at all and reach people by NAME, which is what it exists for.
  const groups = new Map<string, ScanPoolItem[]>();
  for (const item of keptItems) {
    const key = item.industryKey ?? "";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const verdicts: TriageVerdict[] = [];
  for (const key of [...groups.keys()].sort()) {
    const items = groups.get(key)!;
    const taxonomy = key ? packByKey.get(key)?.taxonomy : undefined;
    const poolItems: PoolItem[] = items.map((i) => ({
      title: i.title, url: i.url, snippet: i.snippet, publishedAt: i.publishedAt,
    }));
    const offered = taxonomy && taxonomy.length > 0 ? taxonomy : undefined;
    // Counted where the taxonomy is actually handed over, not where a pack is resolved: a
    // pack whose items all died before triage bought no classification either.
    if (offered) taxonomyOffered += poolItems.length;
    verdicts.push(...(await triageAll(poolItems, offered)));
  }

  for (const v of verdicts) {
    dropoutVerdicts.push({
      url: v.url,
      shareworthy: v.shareworthy,
      stature: v.stature,
      title: itemByUrl.get(v.url)?.title ?? null,
      kind: v.kind,
      publisher: v.publisher,
    });
  }

  const byKind = new Map<string, { kind: string; seen: number; passed: number }>();
  for (const v of verdicts) {
    const e = byKind.get(v.kind) ?? { kind: v.kind, seen: 0, passed: 0 };
    e.seen += 1;
    if (v.shareworthy >= SHAREWORTHY_FLOOR && v.stature >= STATURE_FLOOR && !v.staleness) e.passed += 1;
    byKind.set(v.kind, e);
  }
  const triageByKind = [...byKind.values()].sort((a, b) => b.seen - a.seen);
  // Two bars, not one. The run before this returned items that were on-topic and
  // weightless — a paper on an injection polymer, a trade piece on a pipe robot. Correct
  // subject, no gift. Relevance and weight are different questions and both have a floor.
  const worthSharing = verdicts.filter(
    (v) => v.shareworthy >= SHAREWORTHY_FLOOR && v.stature >= STATURE_FLOOR && !v.staleness
  );
  // Each triage rejection named by the bar it missed, in a fixed order so a row's floor is
  // the one no threshold change would move first.
  for (const v of verdicts) {
    if (worthSharing.includes(v)) continue;
    const floor =
      v.shareworthy < SHAREWORTHY_FLOOR ? "shareworthy"
      : v.stature < STATURE_FLOOR ? "stature"
      : "staleness";
    floorResults.push({
      url: v.url,
      pass: false,
      floor,
      reason: `shareworthy=${v.shareworthy} stature=${v.stature}${v.staleness ? " staleness" : ""}`,
      title: itemByUrl.get(v.url)?.title ?? null,
    });
  }
  const relevantButLight = verdicts.filter(
    (v) => v.shareworthy >= SHAREWORTHY_FLOOR && v.stature < STATURE_FLOOR && !v.staleness
  ).length;
  // Judged on what CLEARED the filter, so the report says whether the run found gifts —
  // and when it did not, says that rather than being padded with the best of a weak pool.
  const acceptance = judgeAcceptance(
    worthSharing.map((v) => ({
      kind: v.kind,
      stature: v.stature,
      url: v.url,
      israelRelevant: v.israelRelevant,
    }))
  );
  if (!acceptance.met) console.warn(`[radar] acceptance org=${orgId} ${acceptance.shortfall}`);
  console.log(
    `[radar] triage org=${orgId} ${triageByKind.map((k) => `${k.kind}=${k.passed}/${k.seen}`).join(" ")}` +
      ` relevant_but_light=${relevantButLight} weighty=${acceptance.weighty}` +
      ` israel_relevant=${acceptance.israelRelevant} israeli_source=${acceptance.israeliSource}`
  );
  if (worthSharing.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: keptItems.length, triageByKind,
      quotaExhausted: news.quotaLikely, poolDropped: capped.dropped, relevantButLight,
      staleDropped: stale.length, undatedDropped: undated.length,
      dropReasons: { ...freshnessDrops, ...floorDropsOf() },
    });
  }

  // ── 4. Write each surviving item up once ──────────────────────────────────
  type WrittenItem = {
    itemId: string;
    title: string;
    summary: string;
    technology: string | null;
    /**
     * The POOL url — the key everything joins on: `passedPrefilter`, the triage verdicts
     * and therefore the scores a dropout row inherits. Deliberately not the stored one: a
     * `readPage` that follows a redirect changes the url mid-run, and keying floor 1 on the
     * new one would silently match nobody (every person's prefilter set holds the old one)
     * and would file the drop-out rows under a url no verdict has a score for.
     */
    url: string;
    /** Where the read LANDED — the real publisher. Shown to the chooser, and the host the
     *  domestic-market check reads. */
    storedUrl: string;
    industryKey: string | null;
    /** ABSENT when no taxonomy was offered — see the field's note in types.ts. */
    industryTags?: string[];
    stature: number;
    kind: string;
    publisher: string | null;
    publishedAt: string | null;
  };
  let pageReadFailures = 0;
  let writeUpFailed = 0;
  const written: WrittenItem[] = [];
  // Not every survivor is written up: synthesis is one LLM call plus one page read each,
  // capped at MAX_SYNTHESIS_PER_RUN. Named rather than left as the difference between two
  // other numbers — a drop with no reason code is the thing this file keeps being fixed for.
  const synthesisCapDropped = Math.max(0, worthSharing.length - MAX_SYNTHESIS_PER_RUN);
  for (const verdict of worthSharing.slice(0, MAX_SYNTHESIS_PER_RUN)) {
    const source = itemByUrl.get(verdict.url);
    if (!source) continue;
    try {
      // Read the actual article. Passing `pages: []` meant the model saw a title and a
      // snippet and filled the rest from what it already knew — that is how a Bloomberg
      // Law story about a court ordering OpenAI to hand over 20 million chat logs became
      // a summary of "ChatGPT is a large language model". A summary that does not
      // describe its source is worse than no summary.
      const page = await readPage(source.url);
      if (!page) pageReadFailures += 1;
      // Store where the read LANDED, not where the search pointed — a redirect wrapper
      // the ingest could not unwrap statically resolves here or never.
      const storedUrl = canonicalizeSourceUrl(page?.finalUrl ? page.finalUrl : source.url);
      const draft = await synthesizeItem({
        triage: verdict,
        articles: [{ url: storedUrl, title: source.title, snippet: source.snippet, publishedAt: source.publishedAt }],
        pages: page ? [page] : [],
      });
      const itemId = await upsertTechItem(draft);
      // The closed-taxonomy tags belong ON the row: floor 1 reads them, and a future
      // calibration query reads them long after this run's report is gone.
      //
      // Written only when triage actually returned some. An ABSENT `industryTags` means no
      // taxonomy was offered (the named channel, and every verdict from before Phase B) and
      // must not be written as [], and an offered-but-empty verdict needs no write either —
      // the column already defaults to []. Both matter because upsertTechItem MERGES into an
      // existing row: writing [] here would erase the tags another pack's pull gave the same
      // story.
      if (verdict.industryTags && verdict.industryTags.length > 0) {
        await prisma.techItem.update({ where: { id: itemId }, data: { industryTags: verdict.industryTags } });
        itemsTagged += 1;
      }
      written.push({
        itemId,
        title: draft.title,
        summary: draft.summary,
        technology: draft.technology,
        url: source.url,
        storedUrl,
        industryKey: source.industryKey,
        ...(verdict.industryTags ? { industryTags: verdict.industryTags } : {}),
        stature: verdict.stature,
        kind: verdict.kind,
        publisher: verdict.publisher,
        publishedAt: source.publishedAt,
      });
    } catch (err) {
      writeUpFailed += 1;
      console.warn(`[radar] write-up failed for ${verdict.url}: ${(err as Error).message}`);
    }
  }
  // Both counted into dropReasons rather than into floorDrops: DROPOUT_FLOORS is a CLOSED
  // set read by hand-written calibration queries, and neither of these is a floor — one is
  // a per-run budget, the other a fault. Inventing a member for them would make them
  // arrive as "unknown" in the evidence table.
  const writeUpDrops: Record<string, number> = {};
  if (synthesisCapDropped > 0) writeUpDrops.synthesis_cap = synthesisCapDropped;
  if (writeUpFailed > 0) writeUpDrops.write_up_failed = writeUpFailed;
  if (written.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: keptItems.length, worthSharing: worthSharing.length,
      poolDropped: capped.dropped, relevantButLight, snippetOnly: pageReadFailures, acceptance, triageByKind,
      quotaExhausted: news.quotaLikely, staleDropped: stale.length, undatedDropped: undated.length,
      dropReasons: { ...freshnessDrops, ...floorDropsOf(), ...writeUpDrops },
    });
  }

  // ── 5. Floor 1 (tag overlap, in code) and floor 2 (the chooser) ───────────
  //
  // Floor 1 replaces `judgeAxisFit`: n matching tags instead of a per-pair LLM judgement.
  // It is tuned for RECALL and says so — an entity hit or one focused tag is enough — and
  // the chooser above it is what prevents mediocrity. Floor 1 costs nothing, so the
  // expensive judgement is made once per PERSON rather than once per pair.
  const thresholds = floorThresholds();
  const axisById = new Map(axes.map((a) => [a.id, a]));
  const layerRows: { itemId: string; kind: AxisKindName }[] = [];
  let picksTotal = 0;

  for (const person of people) {
    const candidates: { item: WrittenItem; overlap: TagOverlap }[] = [];

    for (const item of written) {
      // Floor 0 already answered for this pair; re-asking would double-count the drop.
      if (!person.passedPrefilter.has(item.url)) continue;
      const floorItem: FloorItem = {
        title: item.title,
        summary: item.summary,
        // The landed url: the domestic-market marker is the PUBLISHER's host, and a
        // redirect wrapper names the search engine rather than the publisher.
        url: item.storedUrl,
        industryKey: item.industryKey,
        industryTags: item.industryTags ?? [],
      };
      const overlap = tagOverlap(floorItem, {
        focused: person.tags.focused,
        broad: person.tags.broad,
        entities: person.tags.entities as EntityTag[],
      });
      const verdict = passesFloors({ overlap, stature: item.stature }, thresholds);
      if (!verdict.pass) {
        floorResults.push({
          url: item.url,
          pass: false,
          floor: "tag_overlap",
          reason: `${verdict.reason} tier=${verdict.tier}`,
          contactId: person.contactId,
          title: item.title,
        });
        continue;
      }
      candidates.push({ item, overlap });
    }

    if (candidates.length === 0) continue;
    floorCandidates += candidates.length;

    // ONE Haiku call for this person, over everything that cleared the floors. Not one per
    // pair: the person is the same in all of them, and comparing candidates AGAINST EACH
    // OTHER is most of the judgement.
    chooserCalls += 1;
    const chooserCandidates: ChooserCandidate[] = candidates.map(({ item, overlap }) => ({
      itemId: item.itemId,
      title: item.title,
      summary: item.summary,
      url: item.storedUrl,
      publisher: item.publisher,
      kind: item.kind,
      publishedAt: item.publishedAt,
      tier: overlap.tier,
      matched: overlap.matched,
      stature: item.stature,
    }));
    const chosen = await chooseForPerson(person.chooser, chooserCandidates);
    chooserPicks += chosen.picks.length;
    const pickedById = new Map(chosen.picks.map((p) => [p.itemId, p]));

    for (const { item, overlap } of candidates) {
      const pick = pickedById.get(item.itemId);
      if (!pick) {
        // A chooser "no" is a DECISION and is recorded as one, with the reason it gave —
        // including "the answer did not parse", which `ChooserResult.outcome` keeps
        // separate from a judgement so a fault is never displayed as taste.
        floorResults.push({
          url: item.url,
          pass: false,
          floor: "chooser",
          reason: chosen.noneReason ? `${chosen.outcome}: ${chosen.noneReason}` : `${chosen.outcome}: not_picked`,
          contactId: person.contactId,
          title: item.title,
        });
        continue;
      }

      // The match is written on the NARROWEST axis that reached this person — the entity,
      // else their own subject, else the shared industry net. AxisMatch is shared by every
      // subscriber of an axis, so the narrower the axis the less a personal judgement
      // spills onto somebody else; the Opus veto is still per person and per item, which is
      // what makes that spill safe rather than merely small.
      const matchedKey = tagKey(overlap.matched[0] ?? "");
      const axisId =
        (overlap.tier === "entity" ? person.axisIdByEntity.get(matchedKey) : undefined) ??
        person.axisIdByTag.get(matchedKey) ??
        person.axisIdByNetTag.get(matchedKey) ??
        person.axisIdByEntity.get(matchedKey);
      if (!axisId) {
        // Unreachable by construction (every tag came from one of this person's links), and
        // recorded rather than skipped if it ever happens: a pick that quietly never became
        // a row is exactly the shape of silence this file keeps being fixed for.
        floorResults.push({
          url: item.url, pass: false, floor: "unknown",
          reason: `picked but no axis carries the matched tag "${overlap.matched[0] ?? ""}"`,
          contactId: person.contactId, title: item.title,
        });
        continue;
      }

      const tier = overlap.tier === "entity" || overlap.tier === "focused" ? overlap.tier : "broad";
      await prisma.axisMatch.upsert({
        where: { axisId_itemId: { axisId, itemId: item.itemId } },
        // update:{} — an existing row is an earlier judgement about the same pair, and
        // overwriting it would make "did the bar move?" unanswerable.
        create: {
          axisId,
          itemId: item.itemId,
          score: CHOOSER_MATCH_SCORE[tier],
          rationale: overlap.matched.length > 0 ? `${pick.why} — התאמה לפי: ${overlap.matched.join(", ")}` : pick.why,
        },
        update: {},
      });
      picksTotal += 1;
      const axis = axisById.get(axisId);
      if (axis) layerRows.push({ itemId: item.itemId, kind: axis.kind as AxisKindName });
    }
  }
  articlesByLayer = computeArticlesByLayer(layerRows);

  if (picksTotal === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: keptItems.length,
      worthSharing: worthSharing.length, itemsWritten: written.length, poolDropped: capped.dropped,
      relevantButLight, snippetOnly: pageReadFailures, acceptance, triageByKind,
      quotaExhausted: news.quotaLikely, staleDropped: stale.length, undatedDropped: undated.length,
      dropReasons: { ...freshnessDrops, ...floorDropsOf(), ...writeUpDrops },
    });
  }

  // ── 6-7. Rank, veto, draft — the ONE implementation, shared with radar.judge ──
  // Floor 3, unchanged: Opus, temperature 0, default to reject, one person per company per
  // item. It reads the AxisMatch rows written above, which is why the chooser's picks land
  // there and nowhere new — every screen, deriveJourney and the radar.judge function read
  // the same table.
  const judged = await judgeAndDraft(orgId);

  return finish({
    axes: axes.length,
    queriesRun: news.queriesRun,
    poolItems: keptItems.length,
    worthSharing: worthSharing.length,
    itemsWritten: written.length,
    candidates: judged.candidates,
    vetoed: judged.vetoed,
    drafted: judged.drafted,
    poolDropped: capped.dropped,
    staleDropped: stale.length,
    undatedDropped: undated.length,
    relevantButLight,
    snippetOnly: pageReadFailures,
    acceptance,
    // Merged, not overwritten: freshness and floor reasons are counted before the veto,
    // the veto's after — losing either half would misreport the funnel.
    dropReasons: { ...freshnessDrops, ...floorDropsOf(), ...writeUpDrops, ...judged.dropReasons },
    triageByKind,
    quotaExhausted: news.quotaLikely,
  });
}
