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
    expect(qs.length).toBeLessThanOrEqual(6);
    expect(qs).toEqual(buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" })); // deterministic
  });
  it("omits Hebrew queries when no Hebrew name", () => {
    const qs = buildPersonResearchQueries({ fullName: "John Doe", companyName: "Acme" });
    expect(qs.every((q) => !/[א-ת]/.test(q))).toBe(true);
  });

  /**
   * The first two queries must not presuppose a press event. Every query used to be
   * interview/panel/keynote-shaped, which is a far narrower net than "what does this
   * person do" — and the whole of Pazit Garfinkel's public agenda sat outside it.
   */
  it("asks what the person OWNS before it asks about their press appearances", () => {
    const qs = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" });
    expect(qs[0]).toContain("תחומי אחריות");
    expect(qs.slice(0, 2).some((q) => /ראיון|כנס|interview|panel|keynote/.test(q))).toBe(false);
  });

  /**
   * `Contact` stores only `hebrewFirstName`, so the caller hands one token in. Quoted as a
   * phrase that was `"פזית" כנס` — every Pazit in Israel, pinned to nothing. A lone token
   * goes unquoted and always beside the company, which is what makes it a real constraint.
   */
  it("does not quote a lone Hebrew first name as a phrase", () => {
    const qs = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית", companyName: "Bank Hapoalim בנק הפועלים" });
    expect(qs.some((q) => q.includes('"פזית"'))).toBe(false);
    expect(qs.every((q) => !/[א-ת]/.test(q) || q.includes("בנק הפועלים"))).toBe(true);
    // A FULL Hebrew name is still quoted — it is specific enough to be a phrase.
    const full = buildPersonResearchQueries({ fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" });
    expect(full.some((q) => q.includes('"פזית גרפינקל"'))).toBe(true);
  });
});

describe("researchPerson — free first", () => {
  /**
   * The paid pool is a TOP-UP now, not the source. It was the only source until
   * 2026-09-01, and on 2026-08-31 three of the four paid providers were at exactly zero
   * for the month — so the one input that makes a person model personal returned nothing
   * for the four people v3 was built for.
   */
  it("runs on free RSS and never touches the paid pool when free is enough", async () => {
    const rssFetcher = vi.fn(async (q: string) => [
      { title: `t-${q}`, url: `https://calcalist.co.il/${encodeURIComponent(q)}`, snippet: "s", source: "google-news-rss", publishedAt: null },
    ]);
    const fetcher = vi.fn();
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { rssFetcher, fetcher, readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(rssFetcher).toHaveBeenCalledTimes(6);
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.paidQueries).toBe(0);
    expect(res.findings.length).toBeGreaterThanOrEqual(4);
  });

  it("tops up from the paid pool only when free came back thin", async () => {
    const rssFetcher = vi.fn(async () => []);
    const fetcher = vi.fn(async () => [
      { title: "paid", url: "https://globes.co.il/a", snippet: "s", source: "serper", publishedAt: null },
    ]);
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      { rssFetcher, fetcher, readPage: async () => null, maxPageReads: 0, sleep: noSleep }
    );
    expect(fetcher).toHaveBeenCalled();
    expect(res.paidQueries).toBe(6);
    expect(res.findings.length).toBe(1);
  });

  /** The same interview is found by several queries and now by two providers on top. */
  it("dedupes the same story across queries and providers", async () => {
    const one = { title: "ראיון", url: "https://calcalist.co.il/a/?utm_source=x", snippet: "s", source: "google-news-rss", publishedAt: null };
    const res = await researchPerson(
      { fullName: "Pazit Garfinkel", hebrewName: "פזית גרפינקל", companyName: "Bank Hapoalim" },
      {
        rssFetcher: async () => [one, { ...one, url: "https://www.calcalist.co.il/a" }],
        fetcher: async () => [{ ...one, url: "http://calcalist.co.il/a/" }],
        readPage: async () => null, maxPageReads: 0, sleep: noSleep,
      }
    );
    expect(res.findings).toHaveLength(1);
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
