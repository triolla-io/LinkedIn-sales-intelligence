import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The google-news-rss loud-failure signal (see lib/news/google-news-rss.ts's
 * fetchGoogleNewsRssWithStats and the 2026-08-27 incident it was built for), as wired
 * through fetch-pool-news.ts's DEFAULT fetcher (fetchOne) into PoolResult.providerStats.
 *
 * Every other fetch-pool-news test injects a custom fetcher and never exercises fetchOne
 * itself, so this file is the one place that mocks all six provider modules and calls
 * fetchPoolNews(pool) with NO fetcher argument — the real production wiring.
 */

const getCachedQuery = vi.fn();
const putCachedQuery = vi.fn();
vi.mock("@/lib/news/query-cache", () => ({
  getCachedQuery: (...a: unknown[]) => getCachedQuery(...a),
  putCachedQuery: (...a: unknown[]) => putCachedQuery(...a),
  CACHE_TTL_HOURS: 24,
  EMPTY_CACHE_TTL_MINUTES: 90,
}));

vi.mock("@/lib/news/serpapi", () => ({ fetchSerpapi: vi.fn(async () => []) }));
vi.mock("@/lib/news/tavily", () => ({ fetchTavily: vi.fn(async () => []) }));
vi.mock("@/lib/news/gnews", () => ({ fetchGnews: vi.fn(async () => []) }));
vi.mock("@/lib/news/serper", () => ({ fetchSerper: vi.fn(async () => []) }));
vi.mock("@/lib/news/gdelt", () => ({ fetchGdelt: vi.fn(async () => []) }));

const fetchGoogleNewsRssWithStats = vi.fn();
vi.mock("@/lib/news/google-news-rss", () => ({
  fetchGoogleNewsRssWithStats: (...a: unknown[]) => fetchGoogleNewsRssWithStats(...a),
}));

const { fetchPoolNews } = await import("@/lib/tech-radar/fetch-pool-news");

beforeEach(() => {
  getCachedQuery.mockReset();
  putCachedQuery.mockReset();
  getCachedQuery.mockResolvedValue(null);
  putCachedQuery.mockResolvedValue(undefined);
  fetchGoogleNewsRssWithStats.mockReset();
});

describe("fetchPoolNews — google-news-rss diagnostic wiring (default fetcher only)", () => {
  it("adds a google-news-rss providerStats row with itemsSeen/itemsResolved even when it produced zero articles", async () => {
    // The exact 2026-08-27 failure mode: the feed had real items, but nothing resolved.
    fetchGoogleNewsRssWithStats.mockResolvedValue({
      items: [],
      itemsSeen: 12,
      itemsAttempted: 12,
      itemsResolved: 0,
      massDrop: true,
    });

    const out = await fetchPoolNews([{ query: "q1", companyIds: ["c1"] }], undefined, {
      sleep: async () => {},
    });

    const row = out.providerStats.find((s) => s.provider === "google-news-rss");
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      provider: "google-news-rss",
      results: 0,
      israeliSources: 0,
      itemsSeen: 12,
      itemsResolved: 0,
      massDropQueries: 1,
    });
  });

  it("sums itemsSeen/itemsResolved across multiple executed queries", async () => {
    fetchGoogleNewsRssWithStats
      .mockResolvedValueOnce({ items: [], itemsSeen: 5, itemsAttempted: 5, itemsResolved: 5, massDrop: false })
      .mockResolvedValueOnce({ items: [], itemsSeen: 8, itemsAttempted: 8, itemsResolved: 1, massDrop: true });

    const out = await fetchPoolNews(
      [
        { query: "q1", companyIds: ["c1"] },
        { query: "q2", companyIds: ["c2"] },
      ],
      undefined,
      { sleep: async () => {} }
    );

    const row = out.providerStats.find((s) => s.provider === "google-news-rss");
    expect(row).toMatchObject({ itemsSeen: 13, itemsResolved: 6, massDropQueries: 1 });
  });

  it("does not add a google-news-rss row when the query cache serves every entry (no provider call made)", async () => {
    getCachedQuery.mockResolvedValue([]);
    const out = await fetchPoolNews([{ query: "cached", companyIds: ["c1"] }], undefined, {
      sleep: async () => {},
    });
    expect(out.providerStats.find((s) => s.provider === "google-news-rss")).toBeUndefined();
    expect(fetchGoogleNewsRssWithStats).not.toHaveBeenCalled();
  });

  it("a custom (test) fetcher bypasses fetchOne entirely — no google-news-rss diagnostic row appears", async () => {
    const customFetcher = vi.fn(async () => []);
    const out = await fetchPoolNews([{ query: "q1", companyIds: ["c1"] }], customFetcher, {
      sleep: async () => {},
    });
    expect(out.providerStats.find((s) => s.provider === "google-news-rss")).toBeUndefined();
    expect(fetchGoogleNewsRssWithStats).not.toHaveBeenCalled();
    expect(customFetcher).toHaveBeenCalledWith("q1");
  });
});
