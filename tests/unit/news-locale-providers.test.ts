import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/news/budget", () => ({ reserveNewsCall: async () => true }));

const { fetchSerpapi } = await import("@/lib/news/serpapi");
const { fetchSerper } = await import("@/lib/news/serper");
const { fetchGnews } = await import("@/lib/news/gnews");
const { fetchTavily } = await import("@/lib/news/tavily");

const fetchMock = vi.fn();

/** Providers only read the body/params; an empty result set is enough to inspect them. */
function ok(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.SERPAPI_API_KEY = "k";
  process.env.SERPER_API_KEY = "k";
  process.env.GNEWS_API_KEY = "k";
  process.env.TAVILY_API_KEY = "k";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.GNEWS_API_KEY;
  delete process.env.TAVILY_API_KEY;
});

/** The URL a provider was called with, for the GET-based clients. */
function calledUrl(): URL {
  return new URL(String(fetchMock.mock.calls[0][0]));
}

/** The JSON body a provider was called with, for the POST-based clients. */
function calledBody(): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[0][1].body));
}

const HEBREW = "רגולציית בנק ישראל קריפטו";
const ENGLISH = "core banking modernization";

/**
 * serpapi hardcoded gl=us&hl=en, which is how a Hebrew query about Bank of Israel
 * regulation came back with Greek and Indian coverage on 2026-08-26.
 */
describe("fetchSerpapi locale", () => {
  it("asks Google News for Israeli results when the query is Hebrew", async () => {
    fetchMock.mockResolvedValue(ok({ news_results: [] }));
    await fetchSerpapi(HEBREW);
    expect(calledUrl().searchParams.get("gl")).toBe("il");
    expect(calledUrl().searchParams.get("hl")).toBe("he");
  });

  it("keeps an English query on the global default", async () => {
    fetchMock.mockResolvedValue(ok({ news_results: [] }));
    await fetchSerpapi(ENGLISH);
    expect(calledUrl().searchParams.get("gl")).toBe("us");
    expect(calledUrl().searchParams.get("hl")).toBe("en");
  });
});

/**
 * serper sent no locale at all — and it is the provider that actually served the
 * 2026-08-26 run, because serpapi, gnews and tavily were all out of quota.
 */
describe("fetchSerper locale", () => {
  it("asks for Israeli results when the query is Hebrew", async () => {
    fetchMock.mockResolvedValue(ok({ news: [] }));
    await fetchSerper(HEBREW);
    expect(calledBody()).toMatchObject({ gl: "il", hl: "he", location: "Israel" });
  });

  it("sends no locale for an English query, leaving serper's default alone", async () => {
    fetchMock.mockResolvedValue(ok({ news: [] }));
    await fetchSerper(ENGLISH);
    const body = calledBody();
    expect(body.gl).toBeUndefined();
    expect(body.hl).toBeUndefined();
    expect(body.location).toBeUndefined();
  });
});

describe("fetchGnews locale", () => {
  it("asks for Hebrew-language Israeli results when the query is Hebrew", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGnews(HEBREW);
    expect(calledUrl().searchParams.get("lang")).toBe("he");
    expect(calledUrl().searchParams.get("country")).toBe("il");
  });

  it("keeps lang=en and sends no country for an English query", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGnews(ENGLISH);
    expect(calledUrl().searchParams.get("lang")).toBe("en");
    expect(calledUrl().searchParams.get("country")).toBeNull();
  });
});

describe("fetchTavily locale", () => {
  it("asks for Israeli results when the query is Hebrew", async () => {
    fetchMock.mockResolvedValue(ok({ results: [] }));
    await fetchTavily(HEBREW);
    // Tavily takes a country NAME, not the two-letter code the Google family uses.
    expect(calledBody().country).toBe("israel");
  });

  it("sends no country for an English query", async () => {
    fetchMock.mockResolvedValue(ok({ results: [] }));
    await fetchTavily(ENGLISH);
    expect(calledBody().country).toBeUndefined();
  });
});
