import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The query cache reaches for prisma. Every test in this file must be a pure cache
 * miss with no DB anywhere near it — same stub the pool-news tests use.
 */
const getCachedQuery = vi.fn();
const putCachedQuery = vi.fn();
vi.mock("@/lib/news/query-cache", () => ({
  getCachedQuery: (...a: unknown[]) => getCachedQuery(...a),
  putCachedQuery: (...a: unknown[]) => putCachedQuery(...a),
  CACHE_TTL_HOURS: 24,
  EMPTY_CACHE_TTL_MINUTES: 90,
}));

const { buildPersonResearchQueries, researchPerson } = await import("@/lib/tech-radar/person-research");

beforeEach(() => {
  getCachedQuery.mockReset();
  putCachedQuery.mockReset();
  getCachedQuery.mockResolvedValue(null);
  putCachedQuery.mockResolvedValue(undefined);
});

/** No-op pacing. fetchPoolNews sleeps QUERY_GAP_MS between pooled queries to keep GNews
 *  from 429-ing; four real queries would push a single test past vitest's 5s timeout,
 *  and there is nothing to be polite to when the fetcher is a spy. */
const noSleep = async () => {};

describe("buildPersonResearchQueries", () => {
  it("builds deterministic He+En queries around the person and employer", () => {
    const qs = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" });
    expect(qs).toContain('"Pazit Garfinkel" Bank Hapoalim interview');
    expect(qs.some((q) => q.includes("פזית גרפינקל"))).toBe(true);
    expect(qs.length).toBeLessThanOrEqual(4);
    expect(qs).toEqual(buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" })); // deterministic
  });
  it("omits Hebrew queries when no Hebrew name", () => {
    const qs = buildPersonResearchQueries({ fullName: "John Doe", companyName: "Acme" });
    expect(qs.every((q) => !/[א-ת]/.test(q))).toBe(true);
  });
});

describe("researchPerson", () => {
  it("fetches queries, reads top pages, caps page reads", async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { title: "Interview with Pazit", url: "https://globes.co.il/a1", snippet: "s", source: "serper", publishedAt: null },
    ]);
    const readPage = vi.fn().mockResolvedValue({
      url: "https://globes.co.il/a1",
      title: "Interview with Pazit",
      text: "full interview text",
      finalUrl: "https://globes.co.il/a1",
    });
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { fetcher, readPage, maxPageReads: 1, sleep: noSleep }
    );
    expect(res.findings.length).toBeGreaterThan(0);
    expect(res.findings[0].pageText).toBe("full interview text");
    expect(readPage).toHaveBeenCalledTimes(1); // cap respected even with duplicate urls deduped
  });

  it("returns empty findings on total provider silence, never throws", async () => {
    const res = await researchPerson(
      { fullName: "X", companyName: "Y" },
      { fetcher: vi.fn().mockResolvedValue([]), readPage: vi.fn(), sleep: noSleep }
    );
    expect(res.findings).toEqual([]);
  });

  it("leaves pageText null past the cap rather than dropping the finding", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([{ title: "a", url: "https://globes.co.il/a", snippet: "sa", source: "serper", publishedAt: null }])
      .mockResolvedValue([{ title: "b", url: "https://calcalist.co.il/b", snippet: "sb", source: "serper", publishedAt: null }]);
    const readPage = vi.fn().mockResolvedValue({ url: "u", title: null, text: "read", finalUrl: "u" });
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", companyName: "Bank Hapoalim" },
      { fetcher, readPage, maxPageReads: 1, sleep: noSleep }
    );
    expect(res.findings).toHaveLength(2);
    expect(res.findings[0].pageText).toBe("read");
    expect(res.findings[1].pageText).toBeNull();
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it("survives an unreadable page — a null read is the normal case, not a failure", async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { title: "paywalled", url: "https://themarker.com/x", snippet: "s", source: "serper", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "X", companyName: "Y" },
      { fetcher, readPage: vi.fn().mockResolvedValue(null), sleep: noSleep }
    );
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].pageText).toBeNull();
  });
});
