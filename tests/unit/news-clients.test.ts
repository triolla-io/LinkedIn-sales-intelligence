import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("news clients", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.GNEWS_API_KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("tavily returns [] when key missing", async () => {
    const { fetchTavily } = await import("@/lib/news/tavily");
    expect(await fetchTavily("Acme funding")).toEqual([]);
  });

  it("tavily normalizes results when key present", async () => {
    process.env.TAVILY_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: "Acme raises $10M", url: "https://techcrunch.com/x", content: "…", published_date: "2026-07-01" }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { fetchTavily } = await import("@/lib/news/tavily");
    const r = await fetchTavily("Acme funding");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Acme raises $10M", url: "https://techcrunch.com/x", source: "tavily" });
  });

  it("tavily returns [] on HTTP error (no throw)", async () => {
    process.env.TAVILY_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const { fetchTavily } = await import("@/lib/news/tavily");
    expect(await fetchTavily("q")).toEqual([]);
  });

  it("serper returns [] when key missing", async () => {
    const { fetchSerper } = await import("@/lib/news/serper");
    expect(await fetchSerper("q")).toEqual([]);
  });

  it("gnews returns [] when key missing", async () => {
    const { fetchGnews } = await import("@/lib/news/gnews");
    expect(await fetchGnews("q")).toEqual([]);
  });

  it("fetchCompanyNews merges all three and tolerates empties", async () => {
    process.env.TAVILY_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: "t", url: "https://a.com/1", content: "c", published_date: null }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { fetchCompanyNews } = await import("@/lib/news/fetch-company-news");
    const r = await fetchCompanyNews("Acme");
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});
