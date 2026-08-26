import { describe, expect, it } from "vitest";
import { FRESHNESS_WINDOW_DAYS, isFresh, publishedMs, splitFresh } from "@/lib/tech-radar/freshness";
import { SCAN_WINDOW_DAYS } from "@/lib/tech-radar/fetch-pool-news";

const NOW = new Date("2026-08-26T12:00:00Z");

describe("FRESHNESS_WINDOW_DAYS", () => {
  it("is 30 days, hard, and matches the provider fetch hint", () => {
    expect(FRESHNESS_WINDOW_DAYS).toBe(30);
    expect(FRESHNESS_WINDOW_DAYS).toBe(SCAN_WINDOW_DAYS);
  });
});

describe("isFresh", () => {
  it("accepts an item from 10 days ago", () => {
    expect(isFresh("2026-08-16T00:00:00Z", NOW)).toBe(true);
  });
  it("accepts exactly on the 30-day boundary", () => {
    expect(isFresh("2026-07-27T12:00:00Z", NOW)).toBe(true);
  });
  it("rejects an item from 31 days ago — research gets no grace", () => {
    expect(isFresh("2026-07-25T00:00:00Z", NOW)).toBe(false);
  });
  it("rejects a missing date — no date, no pass", () => {
    expect(isFresh(null, NOW)).toBe(false);
    expect(isFresh(undefined, NOW)).toBe(false);
    expect(isFresh("", NOW)).toBe(false);
  });
  it("rejects an unparseable date string", () => {
    expect(isFresh("2 days ago", NOW)).toBe(false);
  });
  it("rejects garbage future dates beyond clock-skew tolerance", () => {
    expect(isFresh("2099-01-01T00:00:00Z", NOW)).toBe(false);
  });
  it("tolerates same-day clock skew", () => {
    expect(isFresh("2026-08-26T20:00:00Z", NOW)).toBe(true);
  });
});

describe("splitFresh", () => {
  it("routes each item to exactly one bucket", () => {
    const items = [
      { url: "a", publishedAt: "2026-08-20T00:00:00Z" },
      { url: "b", publishedAt: "2026-06-01T00:00:00Z" },
      { url: "c", publishedAt: null },
      { url: "d", publishedAt: "3 weeks ago" },
    ];
    const { fresh, stale, undated } = splitFresh(items, NOW);
    expect(fresh.map((i) => i.url)).toEqual(["a"]);
    expect(stale.map((i) => i.url)).toEqual(["b"]);
    expect(undated.map((i) => i.url)).toEqual(["c", "d"]);
  });
});
