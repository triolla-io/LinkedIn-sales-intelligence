import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchGoogleNewsRss, parseGoogleNewsRss } from "@/lib/news/google-news-rss";

/**
 * Google News RSS is free and keyless — no reserveNewsCall gate, like GDELT.
 * The link Google hands back is a wrapper (news.google.com/rss/articles/<token>?oc=5);
 * these fixtures base64url-encode a payload containing (or not containing) a real URL,
 * the same shape the live token takes when it embeds the original link in plain text.
 */

function b64url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const NOW = new Date("2026-08-26T12:00:00Z");

function item(opts: { title?: string; token?: string; pubDate?: string; noSource?: boolean } = {}): string {
  const { title = "t", token = b64url("https://example.com/x"), pubDate = "Wed, 26 Aug 2026 10:00:00 GMT" } = opts;
  return `<item>
    <title>${title}</title>
    <link>https://news.google.com/rss/articles/${token}?oc=5</link>
    <pubDate>${pubDate}</pubDate>
    ${opts.noSource ? "" : `<source url="https://example.com">Example</source>`}
  </item>`;
}

function rss(items: string): string {
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
}

describe("parseGoogleNewsRss", () => {
  it("recovers the real publisher URL from a base64 token", () => {
    const token = b64url("some-binary-prefix https://example.com/real-article trailing-noise");
    const xml = rss(item({ token }));
    const out = parseGoogleNewsRss(xml, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://example.com/real-article");
    expect(out[0].source).toBe("google-news-rss");
  });

  it("drops an item whose token decodes to nothing usable", () => {
    const token = b64url("no recoverable link in this payload at all");
    const xml = rss(item({ token, title: "unrecoverable" }));
    expect(parseGoogleNewsRss(xml, NOW)).toHaveLength(0);
  });

  it("strips CDATA and decodes entities in the title", () => {
    const xml = rss(
      item({ title: `<![CDATA[Tom &amp; Jerry: &lt;a "quoted" &#39;test&#39;&gt;]]>` })
    );
    const out = parseGoogleNewsRss(xml, NOW);
    expect(out[0].title).toBe(`Tom & Jerry: <a "quoted" 'test'>`);
  });

  it("decodes plain (non-CDATA) entities in the title too", () => {
    const xml = rss(item({ title: "Fraud &amp; Compliance" }));
    const out = parseGoogleNewsRss(xml, NOW);
    expect(out[0].title).toBe("Fraud & Compliance");
  });

  it("returns null publishedAt for an unparseable pubDate", () => {
    const xml = rss(item({ pubDate: "not a real date" }));
    const out = parseGoogleNewsRss(xml, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].publishedAt).toBeNull();
  });

  it("parses a valid RFC-822 pubDate to ISO", () => {
    const xml = rss(item({ pubDate: "Wed, 26 Aug 2026 10:00:00 GMT" }));
    const out = parseGoogleNewsRss(xml, NOW);
    expect(out[0].publishedAt).toBe(new Date("Wed, 26 Aug 2026 10:00:00 GMT").toISOString());
  });

  it("returns [] for xml with no items", () => {
    expect(parseGoogleNewsRss(rss(""), NOW)).toEqual([]);
  });
});

const fetchMock = vi.fn();
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

function textResponse(xml: string) {
  return { ok: true, status: 200, text: async () => xml };
}

describe("fetchGoogleNewsRss locale", () => {
  it("uses hl=he&gl=IL&ceid=IL:he for a Hebrew query", async () => {
    fetchMock.mockResolvedValue(textResponse(rss("")));
    await fetchGoogleNewsRss("רגולציית בנק ישראל קריפטו");
    const u = calledUrl();
    expect(u.searchParams.get("hl")).toBe("he");
    expect(u.searchParams.get("gl")).toBe("IL");
    expect(u.searchParams.get("ceid")).toBe("IL:he");
  });

  it("uses the US defaults for an English query", async () => {
    fetchMock.mockResolvedValue(textResponse(rss("")));
    await fetchGoogleNewsRss("core banking modernization");
    const u = calledUrl();
    expect(u.searchParams.get("hl")).toBe("en-US");
    expect(u.searchParams.get("gl")).toBe("US");
    expect(u.searchParams.get("ceid")).toBe("US:en");
  });
});

describe("fetchGoogleNewsRss days + max", () => {
  it("filters out a 40-day-old item and an undated item", async () => {
    const now = new Date();
    const freshDate = new Date(now.getTime() - 2 * 86_400_000).toUTCString();
    const staleDate = new Date(now.getTime() - 40 * 86_400_000).toUTCString();
    const xml = rss(
      item({ title: "fresh", token: b64url("https://a.com/fresh"), pubDate: freshDate }) +
        item({ title: "stale", token: b64url("https://a.com/stale"), pubDate: staleDate }) +
        item({ title: "undated", token: b64url("https://a.com/undated"), pubDate: "not a date" })
    );
    fetchMock.mockResolvedValue(textResponse(xml));
    const out = await fetchGoogleNewsRss("q", { days: 30 });
    expect(out.map((r) => r.url)).toEqual(["https://a.com/fresh"]);
  });

  it("caps the returned rows at max", async () => {
    const now = new Date().toUTCString();
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ title: `t${i}`, token: b64url(`https://a.com/${i}`), pubDate: now })
    ).join("");
    fetchMock.mockResolvedValue(textResponse(rss(items)));
    const out = await fetchGoogleNewsRss("q", { max: 2 });
    expect(out).toHaveLength(2);
  });

  it("defaults max to 25", async () => {
    const now = new Date().toUTCString();
    const items = Array.from({ length: 30 }, (_, i) =>
      item({ title: `t${i}`, token: b64url(`https://a.com/${i}`), pubDate: now })
    ).join("");
    fetchMock.mockResolvedValue(textResponse(rss(items)));
    const out = await fetchGoogleNewsRss("q");
    expect(out).toHaveLength(25);
  });
});

describe("fetchGoogleNewsRss failure posture", () => {
  it("returns [] and warns on non-2xx", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    expect(await fetchGoogleNewsRss("q")).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("returns [] when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await fetchGoogleNewsRss("q")).toEqual([]);
  });
});
