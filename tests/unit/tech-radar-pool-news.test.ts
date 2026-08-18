import { describe, it, expect, vi } from "vitest";
import { fetchPoolNews, SCAN_WINDOW_DAYS } from "@/lib/tech-radar/fetch-pool-news";
import type { NewsResult } from "@/lib/news/types";

function result(url: string, title = "t"): NewsResult {
  return { title, url, snippet: "s", source: "tavily", publishedAt: null };
}

describe("SCAN_WINDOW_DAYS", () => {
  it("is the last month, per the product decision", () => {
    expect(SCAN_WINDOW_DAYS).toBe(30);
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
    expect(out).toEqual({ items: [], queriesRun: 0, quotaLikely: false });
  });
});
