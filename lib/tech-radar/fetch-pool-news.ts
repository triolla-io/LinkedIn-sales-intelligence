/**
 * Stage 1 execution: run the canonical query pool against the news providers.
 *
 * The pool (lib/tech-radar/queries.ts) has already collapsed overlapping
 * queries across companies, so each distinct query is fetched EXACTLY ONCE per
 * run and its results are handed to every company that asked for it. That
 * sharing is the feature's main cost lever — see the design doc.
 *
 * Every provider call is already gated by reserveNewsCall() inside the provider
 * modules, so a run can be silently cut short when a free-tier quota is
 * exhausted. `quotaLikely` reports that upward so the UI can say "quota ran
 * out" instead of the indistinguishable-looking "no opportunities found".
 */
import type { NewsResult } from "@/lib/news/types";
import { fetchTavily } from "@/lib/news/tavily";
import { fetchGnews } from "@/lib/news/gnews";
import { fetchSerper } from "@/lib/news/serper";
import { fetchSerpapi } from "@/lib/news/serpapi";
import { normalizeUrl } from "@/lib/fintech-radar/fetch-topic-news";

/** Recency window for "new technology" — the user's decision: the last month. */
export const SCAN_WINDOW_DAYS = 30;

/**
 * Gap between pooled queries. GNews rate-limits a burst — firing 10 queries back to
 * back returned HTTP 429 "too many requests in a short period" during bring-up, and the
 * provider swallows that into an empty result. A pool is at most a few dozen queries
 * once a week, so pacing costs nothing that matters.
 */
export const QUERY_GAP_MS = 1500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Terms that make a query narrower without making it more meaningful. */
const QUALIFIERS = new Set([
  "launch", "launches", "launched", "launching", "release", "releases", "released",
  "new", "latest", "introduces", "introducing", "unveils", "announced", "announces",
  "announcement", "available", "features", "feature", "update", "updates", "version",
  "platform", "software", "tool", "tools", "solution", "solutions", "system", "systems",
  "service", "services", "technology", "technologies", "for", "in", "the", "and", "of",
]);
/** Queries at or below this length are already broad; broadening would gut them. */
const BROAD_ENOUGH = 3;
const BROADENED_TERMS = 3;

/**
 * A shorter, more general form of an over-specific query, or null when there is nothing
 * useful to broaden.
 *
 * Outside software the profile writes queries that match nothing at all: the live Delek
 * Group run lost its entire oil-and-gas line because "reservoir simulation modeling
 * platform new features 2024" and its two siblings each returned zero results. The
 * business-line floor cannot allocate what was never found, so recall has to be fixed
 * here rather than in the cap.
 *
 * Boolean queries are left alone — they are written deliberately.
 */
export function broadenQuery(query: string): string | null {
  if (/\b(OR|AND|NOT)\b|[()"]/.test(query)) return null;

  const words = query.split(/\s+/).filter(Boolean);
  if (words.length <= BROAD_ENOUGH) return null;

  const kept = words.filter((w) => !QUALIFIERS.has(w.toLowerCase()) && !/^\d{4}$/.test(w));
  const source = kept.length > 0 ? kept : words;
  const broadened = source.slice(0, BROADENED_TERMS).join(" ");

  // No point spending a second call on the query we just ran.
  return broadened && broadened.toLowerCase() !== query.toLowerCase() ? broadened : null;
}

export type PoolQuery = { query: string; companyIds: string[] };

export type PoolResult = {
  /** Deduped results, each tagged with the companies whose query produced it. */
  items: (NewsResult & { companyIds: string[] })[];
  /** Distinct queries actually executed. */
  queriesRun: number;
  /** True when every provider returned nothing for at least one query — the
   *  signature of an exhausted quota rather than a genuinely empty result. */
  quotaLikely: boolean;
};

/**
 * Fetch one query across all three providers. Providers never throw (they
 * return [] on error or exhausted budget), so neither does this.
 */
async function fetchOne(query: string): Promise<NewsResult[]> {
  // SerpApi leads: it is the only provider that takes these long, profile-derived
  // queries as written. Tavily needs plan quota, GNews has to have the query cut
  // down to a few words, and both are kept as breadth rather than the backbone.
  const [a, b, c, d] = await Promise.all([
    fetchSerpapi(query, { days: SCAN_WINDOW_DAYS, max: 10 }),
    fetchTavily(query, { days: SCAN_WINDOW_DAYS, maxResults: 10 }),
    fetchGnews(query, { max: 10 }),
    fetchSerper(query),
  ]);
  return [...a, ...b, ...c, ...d];
}

/**
 * Execute the pool. Results are merged and deduped by normalized URL; when the
 * same URL comes back for two different queries, the company subscriptions are
 * unioned rather than the later hit overwriting the earlier one.
 */
export async function fetchPoolNews(
  pool: PoolQuery[],
  fetcher: (query: string) => Promise<NewsResult[]> = fetchOne,
  opts: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<PoolResult> {
  const sleep = opts.sleep ?? wait;
  const byUrl = new Map<string, NewsResult & { companyIds: string[] }>();
  let emptyQueries = 0;
  let queriesRun = 0;

  for (const entry of pool) {
    if (!entry.query.trim()) continue;
    // Pace BETWEEN queries, never before the first one.
    if (queriesRun > 0) await sleep(QUERY_GAP_MS);
    queriesRun += 1;
    let results = await fetcher(entry.query);

    // Nothing at all usually means the query was too specific rather than that the
    // subject has no news — retry once, broader, before writing the topic off.
    if (results.length === 0) {
      const broader = broadenQuery(entry.query);
      if (broader) {
        await sleep(QUERY_GAP_MS);
        results = await fetcher(broader);
      }
    }
    if (results.length === 0) emptyQueries += 1;

    for (const r of results) {
      if (!r.url) continue;
      const key = normalizeUrl(r.url);
      const existing = byUrl.get(key);
      if (existing) {
        for (const id of entry.companyIds) {
          if (!existing.companyIds.includes(id)) existing.companyIds.push(id);
        }
        continue;
      }
      byUrl.set(key, { ...r, companyIds: [...entry.companyIds] });
    }
  }

  return {
    items: [...byUrl.values()],
    queriesRun,
    // Every single query coming back empty is not a plausible real-world
    // outcome for 30-day fintech technology queries; it means budgets are gone.
    quotaLikely: queriesRun > 0 && emptyQueries === queriesRun,
  };
}
