import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchGdelt, gdeltDateToIso } from "@/lib/news/gdelt";

/**
 * GDELT DOC 2.0 is free and keyless — no reserveNewsCall gate, unlike the other four
 * providers. Tests here stub global fetch directly, the same pattern news-locale-
 * providers.test.ts uses for the paid providers.
 */

const fetchMock = vi.fn();

function ok(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function calledUrl(): URL {
  return new URL(String(fetchMock.mock.calls[0][0]));
}

describe("gdeltDateToIso", () => {
  it("normalizes GDELT's compact stamp to ISO", () => {
    expect(gdeltDateToIso("20260826T120000Z")).toBe("2026-08-26T12:00:00.000Z");
  });

  it("passes a plain parseable date through as ISO", () => {
    expect(gdeltDateToIso("2026-08-20T00:00:00Z")).toBe("2026-08-20T00:00:00.000Z");
  });

  it("returns null for garbage — never a guess", () => {
    expect(gdeltDateToIso("not a date")).toBeNull();
    expect(gdeltDateToIso("")).toBeNull();
    expect(gdeltDateToIso(undefined)).toBeNull();
    expect(gdeltDateToIso(42)).toBeNull();
  });
});

describe("fetchGdelt locale operators", () => {
  it("sends the query as written, with no operators, for English", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGdelt("core banking modernization");
    const q = calledUrl().searchParams.get("query");
    expect(q).toBe("core banking modernization");
  });

  it("appends sourcelang:heb and sourcecountry:IS for a Hebrew query", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGdelt("רגולציית בנק ישראל קריפטו");
    const q = calledUrl().searchParams.get("query") ?? "";
    expect(q).toContain("sourcelang:heb");
    expect(q).toContain("sourcecountry:IS");
  });
});

describe("fetchGdelt params", () => {
  it("sets mode=ArtList, format=json, maxrecords and timespan", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGdelt("fraud detection", { days: 30, max: 10 });
    const u = calledUrl();
    expect(u.searchParams.get("mode")).toBe("ArtList");
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.get("maxrecords")).toBe("10");
    expect(u.searchParams.get("timespan")).toBe("30d");
  });

  it("defaults maxrecords to 25 and sends no timespan without days", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGdelt("fraud detection");
    const u = calledUrl();
    expect(u.searchParams.get("maxrecords")).toBe("25");
    expect(u.searchParams.has("timespan")).toBe(false);
  });

  it("hard-caps maxrecords at 250", async () => {
    fetchMock.mockResolvedValue(ok({ articles: [] }));
    await fetchGdelt("fraud detection", { max: 9000 });
    expect(calledUrl().searchParams.get("maxrecords")).toBe("250");
  });
});

describe("fetchGdelt failure posture", () => {
  it("returns [] and warns on non-2xx", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const out = await fetchGdelt("q");
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("returns [] when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await fetchGdelt("q")).toEqual([]);
  });

  it("drops a row with no url", async () => {
    fetchMock.mockResolvedValue(
      ok({
        articles: [
          { title: "no url", seendate: "20260826T120000Z" },
          { title: "has url", url: "https://a.com/1", seendate: "20260826T120000Z" },
        ],
      })
    );
    const out = await fetchGdelt("q");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://a.com/1");
  });
});

describe("fetchGdelt result shape", () => {
  it("maps fields, empty snippet, source gdelt, normalized date", async () => {
    fetchMock.mockResolvedValue(
      ok({
        articles: [
          {
            title: "t",
            url: "https://a.com/1",
            seendate: "20260826T120000Z",
            domain: "a.com",
            language: "English",
            sourcecountry: "United States",
          },
        ],
      })
    );
    const out = await fetchGdelt("q");
    expect(out).toEqual([
      {
        title: "t",
        url: "https://a.com/1",
        snippet: "",
        source: "gdelt",
        publishedAt: "2026-08-26T12:00:00.000Z",
      },
    ]);
  });

  it("still returns the row with publishedAt null when seendate is unreadable", async () => {
    fetchMock.mockResolvedValue(
      ok({ articles: [{ title: "t", url: "https://a.com/1", seendate: "garbage" }] })
    );
    const out = await fetchGdelt("q");
    expect(out[0].publishedAt).toBeNull();
  });
});
