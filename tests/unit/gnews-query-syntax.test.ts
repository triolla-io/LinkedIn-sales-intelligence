import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/news/budget", () => ({ reserveNewsCall: async () => true }));

const { sanitizeGnewsQuery, shortenForGnews, fetchGnews } = await import("@/lib/news/gnews");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.GNEWS_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GNEWS_API_KEY;
});

/**
 * GNews parses `-` as the NOT operator, so a perfectly ordinary phrase like
 * "real-time fraud detection" is rejected with HTTP 400 "query has a syntax error".
 * Confirmed live 2026-08-18: "fraud detection launch 2024 2025" -> 200,
 * "real-time fraud detection" -> 400.
 */
describe("sanitizeGnewsQuery", () => {
  it("removes the hyphen that GNews reads as NOT", () => {
    expect(sanitizeGnewsQuery("real-time fraud detection")).toBe("real time fraud detection");
  });

  it("handles several hyphenated terms in one query", () => {
    expect(sanitizeGnewsQuery("AI-powered real-time KYC")).toBe("AI powered real time KYC");
  });

  it("strips the other bare operator characters", () => {
    expect(sanitizeGnewsQuery("payments + banking")).toBe("payments banking");
    expect(sanitizeGnewsQuery("fintech / regtech")).toBe("fintech regtech");
  });

  it("keeps quoted phrases intact — they are valid GNews syntax", () => {
    expect(sanitizeGnewsQuery('"open banking" launch')).toBe('"open banking" launch');
  });

  it("preserves plain words and numbers untouched", () => {
    expect(sanitizeGnewsQuery("fraud detection launch 2024 2025")).toBe("fraud detection launch 2024 2025");
  });

  it("collapses the whitespace left behind", () => {
    expect(sanitizeGnewsQuery("core - banking   modernization")).toBe("core banking modernization");
  });

  it("returns empty for a query that is nothing but operators", () => {
    expect(sanitizeGnewsQuery(" - + / ")).toBe("");
  });
});

/**
 * GNews ANDs every term across title+description, so a long natural-language query
 * matches nothing at all. Measured live 2026-08-18:
 *   "payment fraud detection launch"          -> 0 results
 *   "payment fraud detection"                 -> 33 results
 *   "fraud detection"                         -> 552 results
 * The Tech Radar's profile-derived queries are written for semantic search (Tavily),
 * so they have to be cut down before GNews can match them.
 */
describe("shortenForGnews", () => {
  it("drops launch/marketing filler and years, keeping the distinctive terms", () => {
    expect(shortenForGnews("real time payment fraud detection AI launch 2024 2025")).toBe(
      "payment fraud detection"
    );
  });

  it("keeps domain words that actually narrow the search", () => {
    expect(shortenForGnews("open banking API platform launch financial institutions")).toBe(
      "open banking api"
    );
  });

  it("caps the term count", () => {
    expect(shortenForGnews("alpha beta gamma delta epsilon zeta").split(" ")).toHaveLength(3);
  });

  it("leaves an already-short query alone", () => {
    expect(shortenForGnews("fraud detection")).toBe("fraud detection");
  });

  // The existing Fintech Radar sends hand-written boolean queries; cutting those apart
  // would silently destroy them.
  it("never touches a query using boolean syntax", () => {
    const boolean = 'fintech (funding OR raises OR "Series A")';
    expect(shortenForGnews(boolean)).toBe(boolean);
    expect(shortenForGnews('stablecoin OR "digital dollar"')).toBe('stablecoin OR "digital dollar"');
  });

  it("leaves a quoted phrase intact", () => {
    expect(shortenForGnews('"embedded finance" launch new platform')).toBe('"embedded finance"');
  });

  it("returns something searchable even when every word is filler", () => {
    expect(shortenForGnews("new platform launch 2024").length).toBeGreaterThan(0);
  });
});

describe("fetchGnews", () => {
  function ok(articles: unknown[]) {
    return { ok: true, status: 200, json: async () => ({ articles }) };
  }

  // Sanitize then shorten: the hyphen goes (it would 400), then "real"/"time" are
  // dropped as filler. Sanitization on its own is asserted in its own block above.
  it("sends the sanitized-and-shortened query, never the raw one", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await fetchGnews("real-time fraud detection");
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("q")).toBe("fraud detection");
    expect(url.searchParams.get("q")).not.toContain("-");
  });

  it("shortens a long natural-language query so GNews can match it", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await fetchGnews("real-time payment fraud detection AI platform launch 2024 2025");
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("q")).toBe("payment fraud detection");
  });

  it("passes a boolean topic query through untouched", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await fetchGnews('stablecoin OR "digital dollar" OR "crypto payments"');
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("q")).toBe('stablecoin OR "digital dollar" OR "crypto payments"');
  });

  it("makes no call at all when sanitizing leaves nothing to search", async () => {
    await fetchGnews(" --- ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still returns results normally", async () => {
    fetchMock.mockResolvedValue(
      ok([{ title: "T", url: "https://x.com/1", description: "d", source: { name: "S" }, publishedAt: "2026-08-01" }])
    );
    const out = await fetchGnews("fraud detection");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://x.com/1");
  });

  it("still returns [] on a non-2xx response rather than throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    await expect(fetchGnews("fraud detection")).resolves.toEqual([]);
  });
});
