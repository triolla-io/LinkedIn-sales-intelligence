import { describe, expect, it, vi } from "vitest";
import { fetchPoolNews, SCAN_WINDOW_DAYS } from "@/lib/tech-radar/fetch-pool-news";
import type { NewsResult } from "@/lib/news/types";

/**
 * The 2026-08-26 scan wrote eleven items, the freshest 56 days old, and forwarded a
 * 66-day-old story to a bank executive introduced with "זה קרה בפועל".
 *
 * SCAN_WINDOW_DAYS = 30 existed the whole time — it was passed only to serpapi and
 * tavily, both at zero quota, while serper (which served the entire run) took no date
 * parameter at all. Asking each provider nicely is not a window; rejecting what comes
 * back is. This gate is the one that catches the NEXT provider failing silently.
 */
function item(url: string, publishedAt: string | null): NewsResult {
  return { title: `t ${url}`, url, snippet: "s", source: "serper", publishedAt };
}

const NOW = new Date("2026-08-26T12:00:00Z");
const noSleep = { sleep: async () => {} };

describe("post-fetch freshness gate", () => {
  it("drops what the window excludes and keeps what it does not", async () => {
    const fetcher = vi.fn(async () => [
      item("https://a.com/fresh", "3 days ago"),
      item("https://a.com/stale", "2 months ago"),
    ]);
    const r = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { ...noSleep, now: NOW });
    expect(r.items.map((i) => i.url)).toEqual(["https://a.com/fresh"]);
    expect(r.staleDropped).toBe(1);
  });

  it("drops an item whose date cannot be read — unreadable is not evidence of freshness", async () => {
    // This is the shape of the next silent provider failure, and the reason the gate
    // cannot default to keeping.
    const fetcher = vi.fn(async () => [item("https://a.com/x", "sometime"), item("https://a.com/y", null)]);
    const r = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { ...noSleep, now: NOW });
    expect(r.items).toEqual([]);
    expect(r.undatedDropped).toBe(2);
  });

  it("keeps an item exactly at the window edge", async () => {
    const fetcher = vi.fn(async () => [item("https://a.com/edge", `${SCAN_WINDOW_DAYS} days ago`)]);
    const r = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { ...noSleep, now: NOW });
    expect(r.items).toHaveLength(1);
  });

  it("reports the age spread of what survived, so a stale pool announces itself", async () => {
    const fetcher = vi.fn(async () => [
      item("https://a.com/1", "1 day ago"),
      item("https://a.com/2", "10 days ago"),
      item("https://a.com/3", "20 days ago"),
    ]);
    const r = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { ...noSleep, now: NOW });
    expect(r.freshness).toMatchObject({ freshest: 1, median: 10, oldest: 20, counted: 3 });
  });

  /**
   * A whole query lost to staleness must not read as "the subject has no news" — that is
   * the signature the broaden-retry and quotaLikely both key off.
   */
  it("does not count a query as empty when its results were dropped as stale", async () => {
    const fetcher = vi.fn(async () => [item("https://a.com/old", "1 year ago")]);
    const r = await fetchPoolNews([{ query: "q", companyIds: ["c1"] }], fetcher, { ...noSleep, now: NOW });
    expect(r.items).toEqual([]);
    expect(r.quotaLikely).toBe(false);
  });
});
