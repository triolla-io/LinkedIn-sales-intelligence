import { describe, it, expect, vi, beforeEach } from "vitest";

const getCachedQuery = vi.fn();
const putCachedQuery = vi.fn();
vi.mock("@/lib/news/query-cache", () => ({
  getCachedQuery: (...a: unknown[]) => getCachedQuery(...a),
  putCachedQuery: (...a: unknown[]) => putCachedQuery(...a),
  CACHE_TTL_HOURS: 24,
  EMPTY_CACHE_TTL_MINUTES: 90,
}));

const { fetchPoolNews, broadenQuery, SCAN_WINDOW_DAYS } = await import("@/lib/tech-radar/fetch-pool-news");
import type { NewsResult } from "@/lib/news/types";

// Every existing test in this file predates the query cache, so it must behave as a
// pure miss unless a test stubs it — that keeps the file's original assertions valid
// without touching them.
beforeEach(() => {
  getCachedQuery.mockReset();
  putCachedQuery.mockReset();
  getCachedQuery.mockResolvedValue(null);
  putCachedQuery.mockResolvedValue(undefined);
});

/**
 * Dated inside the window by default. The freshness gate rejects an item whose date it
 * cannot read — an unreadable date is not evidence of freshness, and it is the shape a
 * silent provider failure takes — so a fixture that means "a normal result" has to say
 * when it was published. See tech-radar-freshness-gate.test.ts for the gate itself.
 */
function result(url: string, title = "t", publishedAt: string | null = "1 day ago"): NewsResult {
  return { title, url, snippet: "s", source: "tavily", publishedAt };
}

describe("SCAN_WINDOW_DAYS", () => {
  it("is the last month, per the product decision", () => {
    expect(SCAN_WINDOW_DAYS).toBe(30);
  });
});

/**
 * The live Delek Group run lost its entire energy line this way: three queries —
 * "reservoir simulation modeling platform new features 2024", "subsurface data
 * management software oil gas exploration releases", "IoT predictive maintenance
 * offshore oil gas infrastructure launches" — each came back with Google News saying
 * it had no results at all. Outside software, the profile's queries are too narrow to
 * match anything, and the business-line floor cannot allocate what was never found.
 */
describe("broadenQuery", () => {
  it("drops the trailing qualifiers from an over-specific query", () => {
    expect(broadenQuery("reservoir simulation modeling platform new features 2024")).toBe(
      "reservoir simulation modeling"
    );
  });

  it("keeps the leading, most distinctive terms", () => {
    expect(broadenQuery("subsurface data management software oil gas exploration releases")).toBe(
      "subsurface data management"
    );
  });

  it("returns null when the query is already short enough to be broad", () => {
    expect(broadenQuery("fraud detection")).toBeNull();
    expect(broadenQuery("open banking api")).toBeNull();
  });

  it("does not broaden a boolean query — those are written deliberately", () => {
    expect(broadenQuery('fintech (funding OR raises OR "Series A")')).toBeNull();
  });

  it("returns null when broadening would not actually change anything", () => {
    expect(broadenQuery("alpha beta gamma")).toBeNull();
  });
});

describe("fetchPoolNews", () => {
  it("runs each distinct pooled query exactly once", async () => {
    const fetcher = vi.fn(async () => [result("https://a.com/1")]);
    const out = await fetchPoolNews(
      [
        { query: "open banking launch", companyIds: ["c1", "c2"] },
        { query: "fraud detection AI", companyIds: ["c3"] },
      ],
      fetcher
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(out.queriesRun).toBe(2);
  });

  it("unions company subscriptions when two queries return the same url", async () => {
    const fetcher = vi.fn(async () => [result("https://a.com/same")]);
    const out = await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c2", "c1"] },
      ],
      fetcher
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].companyIds.sort()).toEqual(["c1", "c2"]);
  });

  it("dedupes on the normalized url, not the raw string", async () => {
    const fetcher = vi.fn(async (q: string) =>
      q === "q1" ? [result("https://www.a.com/x/?utm_source=z")] : [result("http://a.com/x")]
    );
    const out = await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c2"] },
      ],
      fetcher
    );
    expect(out.items).toHaveLength(1);
  });

  it("skips blank queries without counting them as run", async () => {
    const fetcher = vi.fn(async () => [result("https://a.com/1")]);
    const out = await fetchPoolNews([{ query: "   ", companyIds: ["c1"] }], fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(out.queriesRun).toBe(0);
    expect(out.quotaLikely).toBe(false);
  });

  it("drops results with no url", async () => {
    const fetcher = vi.fn(async () => [result(""), result("https://a.com/1")]);
    const out = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher);
    expect(out.items).toHaveLength(1);
  });

  // Providers swallow an exhausted budget and return [] — indistinguishable from a
  // genuinely empty result unless we surface it. Every query empty means quota.
  it("flags quotaLikely when every query came back empty", async () => {
    const out = await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c2"] },
      ],
      async () => []
    );
    expect(out.quotaLikely).toBe(true);
    expect(out.items).toHaveLength(0);
  });

  it("does not flag quotaLikely when at least one query returned something", async () => {
    const out = await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c2"] },
      ],
      async (q) => (q === "q1" ? [result("https://a.com/1")] : [])
    );
    expect(out.quotaLikely).toBe(false);
  });

  it("returns empty and unflagged for an empty pool", async () => {
    const out = await fetchPoolNews([], async () => []);
    // The freshness fields are all-null rather than zero: zeros would read as "nothing
    // was stale and everything was fresh", which is a claim an empty run cannot make.
    expect(out).toEqual({ items: [], queriesRun: 0, cachedQueries: 0, quotaLikely: false, providerStats: [] });
  });

  // GNews rate-limits a burst: firing 10 pooled queries back to back returned
  // HTTP 429 "too many requests in a short period" during the Tech Radar bring-up.
  it("paces the queries instead of firing them back to back", async () => {
    const startedAt: number[] = [];
    const fetcher = vi.fn(async () => {
      startedAt.push(Date.now());
      return [] as never[];
    });
    const sleeps: number[] = [];
    await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c1"] },
        { query: "q3", companyIds: ["c1"] },
      ],
      fetcher,
      { sleep: async (ms: number) => { sleeps.push(ms); } }
    );
    // Two gaps for three queries — paced between, never before the first.
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms > 0)).toBe(true);
    expect(startedAt).toHaveLength(3);
  });

  it("retries a zero-result query with a broadened form", async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (q: string) => {
      seen.push(q);
      return q === "reservoir simulation modeling"
        ? [result("https://a.com/reservoir")]
        : ([] as never[]);
    });
    const out = await fetchPoolNews(
      [{ query: "reservoir simulation modeling platform new features 2024", companyIds: ["c1"] }],
      fetcher,
      { sleep: async () => {} }
    );
    expect(seen).toEqual([
      "reservoir simulation modeling platform new features 2024",
      "reservoir simulation modeling",
    ]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].companyIds).toEqual(["c1"]);
    expect(out.quotaLikely).toBe(false);
  });

  it("does not retry a query that already returned something", async () => {
    const fetcher = vi.fn(async () => [result("https://a.com/1")]);
    await fetchPoolNews(
      [{ query: "reservoir simulation modeling platform new features 2024", companyIds: ["c1"] }],
      fetcher,
      { sleep: async () => {} }
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry a query that cannot be broadened", async () => {
    const fetcher = vi.fn(async () => [] as never[]);
    await fetchPoolNews([{ query: "fraud detection", companyIds: ["c1"] }], fetcher, {
      sleep: async () => {},
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("still flags quota when even the broadened retries come back empty", async () => {
    const out = await fetchPoolNews(
      [
        { query: "reservoir simulation modeling platform new features 2024", companyIds: ["c1"] },
        { query: "subsurface data management software oil gas exploration releases", companyIds: ["c1"] },
      ],
      async () => [],
      { sleep: async () => {} }
    );
    expect(out.quotaLikely).toBe(true);
  });

  it("does not pace a single-query pool", async () => {
    const sleeps: number[] = [];
    await fetchPoolNews([{ query: "q1", companyIds: ["c1"] }], async () => [], {
      sleep: async (ms: number) => { sleeps.push(ms); },
    });
    expect(sleeps).toEqual([]);
  });
});

/**
 * 2026-08-24: a draft went out with google.com/goto?url=… as its link. The wrapped URL
 * entered here, at ingestion, and every stage downstream stored and forwarded it.
 * Canonicalization happens once, at the door.
 */
describe("fetchPoolNews canonicalizes result urls", () => {
  it("unwraps a search-engine redirect before storing", async () => {
    const fetcher = vi.fn(async () => [result("https://www.google.com/url?q=https://real.com/x&ved=abc")]);
    const out = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { sleep: async () => {} });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].url).toBe("https://real.com/x");
  });

  it("dedupes the wrapped and unwrapped forms of the same story", async () => {
    const fetcher = vi.fn(async () => [
      result("https://www.google.com/url?q=https://real.com/x"),
      result("https://real.com/x"),
    ]);
    const out = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { sleep: async () => {} });
    expect(out.items).toHaveLength(1);
  });
});

/**
 * Task A / A4: the morning report needs to know which provider found what, and whether
 * what it found was Israeli. Counted BEFORE the url dedupe below, so a provider gets
 * credit for what it found even when another provider (or an earlier pooled query)
 * turned up the same story first — the dedupe map is a display concern, not a
 * provider-performance one.
 */
describe("fetchPoolNews providerStats", () => {
  it("tallies results and Israeli sources per NewsResult.source, before dedupe", async () => {
    const fetcher = vi.fn(async (q: string) =>
      q === "q1"
        ? [
            { title: "a", url: "https://www.globes.co.il/1", snippet: "", source: "serper", publishedAt: "1 day ago" },
            { title: "b", url: "https://a.com/2", snippet: "", source: "serper", publishedAt: "1 day ago" },
          ]
        : [{ title: "c", url: "https://www.globes.co.il/1", snippet: "", source: "gdelt", publishedAt: "1 day ago" }]
    );
    const out = await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c2"] },
      ],
      fetcher,
      { sleep: async () => {} }
    );
    const byProvider = Object.fromEntries(out.providerStats.map((s) => [s.provider, s]));
    expect(byProvider.serper).toEqual({ provider: "serper", results: 2, israeliSources: 1 });
    expect(byProvider.gdelt).toEqual({ provider: "gdelt", results: 1, israeliSources: 1 });
    // Same URL from two different providers still dedupes to one item in `items`.
    expect(out.items).toHaveLength(2);
  });

  it("is empty when every fetcher call returns nothing", async () => {
    const out = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], async () => [], {
      sleep: async () => {},
    });
    expect(out.providerStats).toEqual([]);
  });
});

/**
 * The 2026-08-26 incident: an Inngest retry re-ran a whole scan from the top and
 * re-bought every one of its 39 queries — 156 provider calls for one approved run. A
 * pool entry the query cache already answered must cost nothing here: no provider call,
 * no QUERY_GAP_MS pace (there is nothing to be polite to), no broaden-retry.
 */
describe("fetchPoolNews consults the query cache", () => {
  it("calls the fetcher once for a pool of 3 where 2 are cached", async () => {
    getCachedQuery.mockImplementation(async (q: string) =>
      q === "cached-a" ? [result("https://a.com/cached-a")] : q === "cached-b" ? [] : null
    );
    const fetcher = vi.fn(async () => [result("https://a.com/missed")]);
    const out = await fetchPoolNews(
      [
        { query: "cached-a", companyIds: ["c1"] },
        { query: "cached-b", companyIds: ["c2"] },
        { query: "missed", companyIds: ["c3"] },
      ],
      fetcher,
      { sleep: async () => {} }
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("missed");
    expect(out.cachedQueries).toBe(2);
    expect(out.queriesRun).toBe(1);
  });

  it("does not sleep for cache hits, only between actual fetcher calls", async () => {
    getCachedQuery.mockImplementation(async (q: string) => (q === "cached" ? [] : null));
    const sleeps: number[] = [];
    const fetcher = vi.fn(async () => [result("https://a.com/1")]);
    await fetchPoolNews(
      [
        { query: "cached", companyIds: ["c1"] },
        { query: "miss-a", companyIds: ["c2"] },
        { query: "miss-b", companyIds: ["c3"] },
      ],
      fetcher,
      { sleep: async (ms: number) => { sleeps.push(ms); } }
    );
    // Two actual fetcher calls -> one gap between them; the cache hit contributes none.
    expect(sleeps).toHaveLength(1);
  });

  it("does not trigger the broaden-retry for a cached empty result", async () => {
    getCachedQuery.mockImplementation(async (q: string) => (q === "long enough query here" ? [] : null));
    const fetcher = vi.fn(async () => [] as never[]);
    await fetchPoolNews(
      [{ query: "long enough query here", companyIds: ["c1"] }],
      fetcher,
      { sleep: async () => {} }
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("quotaLikely is false when the only empty entries came from cache", async () => {
    getCachedQuery.mockImplementation(async (q: string) => (q === "cached-empty" ? [] : null));
    const fetcher = vi.fn(async () => [result("https://a.com/1")]);
    const out = await fetchPoolNews(
      [
        { query: "cached-empty", companyIds: ["c1"] },
        { query: "fetched", companyIds: ["c2"] },
      ],
      fetcher,
      { sleep: async () => {} }
    );
    expect(out.quotaLikely).toBe(false);
  });

  it("writes a fetched (miss) query into the cache under its original key", async () => {
    getCachedQuery.mockResolvedValue(null);
    const fetcher = vi.fn(async () => [result("https://a.com/1")]);
    await fetchPoolNews([{ query: "brand new query", companyIds: ["c1"] }], fetcher, { sleep: async () => {} });
    expect(putCachedQuery).toHaveBeenCalledWith("brand new query", [result("https://a.com/1")]);
  });

  it("does not write a cache hit back to the cache", async () => {
    getCachedQuery.mockResolvedValue([result("https://a.com/1")]);
    const fetcher = vi.fn(async () => [] as never[]);
    await fetchPoolNews([{ query: "already cached", companyIds: ["c1"] }], fetcher, { sleep: async () => {} });
    expect(putCachedQuery).not.toHaveBeenCalled();
  });

  it("attributes cache-hit results to a synthetic provider:'cache' row", async () => {
    getCachedQuery.mockResolvedValue([
      { title: "a", url: "https://www.globes.co.il/1", snippet: "", source: "serper", publishedAt: "1 day ago" },
      { title: "b", url: "https://a.com/2", snippet: "", source: "serper", publishedAt: "1 day ago" },
    ]);
    const fetcher = vi.fn(async () => [] as never[]);
    const out = await fetchPoolNews([{ query: "cached query", companyIds: ["c1"] }], fetcher, { sleep: async () => {} });
    const byProvider = Object.fromEntries(out.providerStats.map((s) => [s.provider, s]));
    expect(byProvider.cache).toEqual({ provider: "cache", results: 2, israeliSources: 1 });
    expect(byProvider.serper).toBeUndefined();
  });

  it("still dedupes and unions companyIds for a cache-hit item sharing a url with a fresh one", async () => {
    getCachedQuery.mockImplementation(async (q: string) => (q === "cached" ? [result("https://a.com/shared")] : null));
    const fetcher = vi.fn(async () => [result("https://a.com/shared")]);
    const out = await fetchPoolNews(
      [
        { query: "cached", companyIds: ["c1"] },
        { query: "fresh", companyIds: ["c2"] },
      ],
      fetcher,
      { sleep: async () => {} }
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].companyIds.sort()).toEqual(["c1", "c2"]);
  });
});
