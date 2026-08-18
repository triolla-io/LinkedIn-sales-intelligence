import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/news/budget", () => ({ reserveNewsCall: async () => true }));

const { fetchSerpapi, parseSerpapiDate } = await import("@/lib/news/serpapi");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPER_API_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPER_API_KEY;
});

function ok(news_results: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ news_results }) };
}
const ARTICLE = {
  position: 1,
  title: "Sionic Launches Instant Bank Pay in U.S.",
  source: { name: "Business Wire" },
  link: "https://businesswire.com/news/1",
  date: "08/12/2026, 12:30 PM, +0000 UTC",
  iso_date: "2026-08-12T12:30:00Z",
};

describe("parseSerpapiDate", () => {
  it("prefers the iso_date field", () => {
    expect(parseSerpapiDate({ iso_date: "2026-08-12T12:30:00Z", date: "whatever" })).toBe(
      "2026-08-12T12:30:00Z"
    );
  });
  it("falls back to the display date when iso_date is absent", () => {
    expect(parseSerpapiDate({ date: "08/12/2026, 12:30 PM, +0000 UTC" })).toContain("2026-08-12");
  });
  it("returns null for an unparseable or missing date", () => {
    expect(parseSerpapiDate({})).toBeNull();
    expect(parseSerpapiDate({ date: "not a date" })).toBeNull();
  });
});

describe("fetchSerpapi", () => {
  it("returns nothing and makes no call without a key", async () => {
    await expect(fetchSerpapi("q")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Production stores a SerpApi key under the older SERPER_API_KEY name.
  it("accepts the key under either env var", async () => {
    process.env.SERPER_API_KEY = "legacy-name";
    fetchMock.mockResolvedValue(ok([ARTICLE]));
    expect(await fetchSerpapi("q")).toHaveLength(1);

    fetchMock.mockClear();
    delete process.env.SERPER_API_KEY;
    process.env.SERPAPI_API_KEY = "proper-name";
    expect(await fetchSerpapi("q")).toHaveLength(1);
  });

  it("queries the google_news engine and scopes to the recency window", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue(ok([]));
    await fetchSerpapi("payment fraud detection", { days: 30 });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("engine")).toBe("google_news");
    // `when:Nd` is how Google News takes a date window through this engine.
    expect(url.searchParams.get("q")).toBe("payment fraud detection when:30d");
  });

  it("maps an article onto the shared NewsResult shape", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue(ok([ARTICLE]));
    const [item] = await fetchSerpapi("q");
    expect(item).toEqual({
      title: "Sionic Launches Instant Bank Pay in U.S.",
      url: "https://businesswire.com/news/1",
      // google_news returns no snippet, so the title carries the signal.
      snippet: "Sionic Launches Instant Bank Pay in U.S.",
      source: "serpapi:Business Wire",
      publishedAt: "2026-08-12T12:30:00Z",
    });
  });

  it("flattens grouped story results", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue(
      ok([{ stories: [ARTICLE, { ...ARTICLE, title: "Second", link: "https://x.com/2" }] }])
    );
    const out = await fetchSerpapi("q");
    expect(out.map((r) => r.url)).toEqual(["https://businesswire.com/news/1", "https://x.com/2"]);
  });

  it("drops entries with no link", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue(ok([{ title: "no link" }, ARTICLE]));
    expect(await fetchSerpapi("q")).toHaveLength(1);
  });

  it("respects the max option", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue(
      ok(Array.from({ length: 20 }, (_, i) => ({ ...ARTICLE, link: `https://x.com/${i}` })))
    );
    expect(await fetchSerpapi("q", { max: 5 })).toHaveLength(5);
  });

  it("returns [] on a non-2xx response rather than throwing", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(fetchSerpapi("q")).resolves.toEqual([]);
  });

  it("returns [] when SerpApi reports an error in a 200 body", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: "ran out of searches" }) });
    await expect(fetchSerpapi("q")).resolves.toEqual([]);
  });

  it("returns [] instead of throwing when fetch rejects", async () => {
    process.env.SERPAPI_API_KEY = "k";
    fetchMock.mockRejectedValue(new Error("network"));
    await expect(fetchSerpapi("q")).resolves.toEqual([]);
  });
});
