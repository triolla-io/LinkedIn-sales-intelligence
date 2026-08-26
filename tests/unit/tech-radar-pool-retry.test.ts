import { describe, expect, it, vi } from "vitest";
import type { NewsResult } from "@/lib/news/types";

// This file is about the broaden-retry's provider-call accounting, not the query
// cache — force every entry to a cache miss so two tests that happen to reuse the same
// literal query string (a normal thing to do across `it` blocks) never see each other's
// results through a shared row in the real cache table.
vi.mock("@/lib/news/query-cache", () => ({
  getCachedQuery: async () => null,
  putCachedQuery: async () => {},
}));

const { fetchPoolNews } = await import("@/lib/tech-radar/fetch-pool-news");

/**
 * The broaden-retry fires a SECOND provider call whenever a query comes back empty, and
 * each one is another serper request. With 28 pooled queries and 31 calls left in the
 * month there is room for three retries, and the 30-day freshness filter makes an empty
 * result MORE likely — a live probe returned 2 rows where an untimed query returned 10.
 *
 * So it is switchable, by environment and not by deleting the code: the retry earns its
 * keep in a normal month, when a narrow query finding nothing is a recall problem rather
 * than a budget one.
 */
const item = (url: string): NewsResult => ({
  title: "t", url, snippet: "s", source: "serper", publishedAt: "1 day ago",
});

const noSleep = { sleep: async () => {} };

describe("POOL_RETRY", () => {
  it("retries an empty query with a broader form by default", async () => {
    const fetcher = vi.fn<(q: string) => Promise<NewsResult[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item("https://a.com/1")]);
    const r = await fetchPoolNews(
      [{ query: "reservoir simulation modeling platform new features 2024", companyIds: ["c1"] }],
      fetcher,
      noSleep
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.items).toHaveLength(1);
  });

  it("spends nothing on a retry when POOL_RETRY is off", async () => {
    const prev = process.env.POOL_RETRY;
    process.env.POOL_RETRY = "off";
    try {
      const fetcher = vi.fn<(q: string) => Promise<NewsResult[]>>().mockResolvedValue([]);
      const r = await fetchPoolNews(
        [{ query: "reservoir simulation modeling platform new features 2024", companyIds: ["c1"] }],
        fetcher,
        noSleep
      );
      // One call for the query, and no second one. This is the whole point: a fixed,
      // predictable number of provider calls per pooled query.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(r.items).toEqual([]);
      // Still counted as an empty query, so quotaLikely keeps meaning what it meant.
      expect(r.quotaLikely).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.POOL_RETRY;
      else process.env.POOL_RETRY = prev;
    }
  });
});
