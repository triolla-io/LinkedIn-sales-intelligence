import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchGoogleNewsRss,
  fetchGoogleNewsRssWithStats,
  parseGoogleNewsRss,
} from "@/lib/news/google-news-rss";

/**
 * Google News RSS is free and keyless — no reserveNewsCall gate, like GDELT.
 *
 * 2026-08-27 incident: the wrapper link Google hands back
 * (news.google.com/rss/articles/<token>?oc=5) used to base64url-decode to a payload with
 * a plain embedded https:// URL. That format is gone — see the real fixture below, a live
 * capture whose tokens decode to opaque binary. parseGoogleNewsRss's OLD behavior was to
 * drop anything it couldn't recover that way, silently discarding 100% of results.
 *
 * parseGoogleNewsRss (this file, first describe block) still exists as the free,
 * network-free FAST PATH — it is tried first because it costs nothing when it works, but
 * as of 2026-08 it hits almost never (see "returns nothing for a real 2026-format feed"
 * below, which reproduces the incident against the real fixture). The real recovery is
 * fetchGoogleNewsRssWithStats / fetchGoogleNewsRss, which additionally resolve each token
 * against Google's batchexecute endpoint — see lib/news/google-news-rss.ts's module doc
 * comment for exactly how that mechanism was found and confirmed live.
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

/**
 * A real Google News RSS capture (fetched 2026-08-27 for "בנק לאומי") — 5 real <item>
 * blocks whose <link> tokens are the CURRENT (2026) opaque wrapper format: base64url
 * decoding them yields ~110-150 bytes of binary with no embedded URL, unlike the
 * synthetic b64url(...) fixtures above. See tests/fixtures/google-news-rss-sample.xml.
 */
const REAL_FEED_XML = readFileSync(join(process.cwd(), "tests/fixtures/google-news-rss-sample.xml"), "utf8");
/** The 5 real wrapper tokens pulled out of the fixture, in feed order (each token appears
 *  twice in the raw XML — once in <link>, once in <guid> — so this dedupes). */
const REAL_TOKENS = [
  ...new Set([...REAL_FEED_XML.matchAll(/\/rss\/articles\/([^?&\s<]+)/g)].map((m) => m[1])),
];

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

  // 2026-08-27 incident, reproduced: the sync-only fast path is what production code
  // relied on before this fix. Against a REAL current-format feed it recovers nothing —
  // this is the bug. fetchGoogleNewsRss (below) is what actually fixes it, by falling
  // back to network resolution when this fast path misses.
  it("BUG REPRODUCTION: recovers nothing from a real 2026-format feed (5 real items, 0 usable)", () => {
    expect(REAL_TOKENS.length).toBe(5);
    const out = parseGoogleNewsRss(REAL_FEED_XML, NOW);
    expect(out).toHaveLength(0);
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

/**
 * The real (2026) resolution mechanism: GET the article page for id/ts/sg + the page's
 * own RPC context, then POST that to Google's batchexecute endpoint. See the module doc
 * comment in lib/news/google-news-rss.ts for how each field was found. These helpers
 * build the same shapes a live response has, so the implementation's own field-extraction
 * regexes are what's under test — not a re-description of them.
 */
function articlePageHtml(fields: { id: string; ts: number; sg: string; bl: string; sid: string }): string {
  const ctxPayload = JSON.stringify([
    ["en-US", "US", ["WEB_TEST_1_0_0"], null, null, 1, 1, "US:en", null, null, null, null, null, null, null, false, 5],
    "en-US",
    "US",
    true,
    [3, 5, 9, 19],
    1,
    true,
    "1",
    false,
    false,
    null,
    false,
  ]);
  // Real pages embed this as a JSON-escaped string inside a JS object literal — the
  // leading "[" is stripped and replaced with the "%.@." marker, exactly like a live page.
  const fwhl2eEscaped = JSON.stringify("%.@." + ctxPayload.slice(1)).slice(1, -1);
  return (
    `<html><body>` +
    `<div data-n-a-id="${fields.id}" data-n-a-ts="${fields.ts}" data-n-a-sg="${fields.sg}"></div>` +
    `<script>window.WIZ_global_data = {"cfb2h":"${fields.bl}","FdrFJe":"${fields.sid}","Fwhl2e":"${fwhl2eEscaped}"};</script>` +
    `</body></html>`
  );
}

/** Google's batchexecute chunked-JSON response shape, carrying one resolved URL. */
function batchexecuteResponse(resolvedUrl: string): string {
  const inner = JSON.stringify(["garturlres", resolvedUrl, 1]);
  const frame = JSON.stringify([["wrb.fr", "Fbv4je", inner, null, null, null, ""]]);
  return `)]}'\n\n${frame.length}\n${frame}\n`;
}

/** Extracts the wrapper token this implementation embeds in the batchexecute request's
 *  `source-path` query param, so a mock can look up which article is being resolved. */
function tokenFromBatchexecuteUrl(url: string): string {
  const sourcePath = new URL(url).searchParams.get("source-path") ?? "";
  return decodeURIComponent(sourcePath).replace(/^\/rss\/articles\//, "");
}

describe("fetchGoogleNewsRssWithStats — real (batchexecute) resolution", () => {
  it("recovers all 5 items from the real captured feed via the network path", async () => {
    const resolvedByToken = new Map(
      REAL_TOKENS.map((t, i) => [t, `https://publisher-${i}.example.com/article-${i}`])
    );

    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(REAL_FEED_XML);
      if (url.includes("/rss/articles/")) {
        const token = url.match(/\/rss\/articles\/([^?&\s]+)/)?.[1] ?? "";
        return textResponse(
          articlePageHtml({ id: token, ts: 1787812383, sg: "sig-" + token.slice(0, 6), bl: "boq_test", sid: "12345" })
        );
      }
      if (url.includes("/_/DotsSplashUi/data/batchexecute")) {
        const token = tokenFromBatchexecuteUrl(url);
        const resolved = resolvedByToken.get(token);
        expect(resolved).toBeDefined();
        void init; // POST body isn't asserted here — the URL round-trip is what's tested
        return textResponse(batchexecuteResponse(resolved!));
      }
      throw new Error("unexpected fetch: " + url);
    });

    const out = await fetchGoogleNewsRssWithStats("בנק לאומי", { days: 30 });
    expect(out.itemsSeen).toBe(5);
    expect(out.itemsAttempted).toBe(5);
    expect(out.itemsResolved).toBe(5);
    expect(out.massDrop).toBe(false);
    expect(out.items).toHaveLength(5);
    expect(new Set(out.items.map((r) => r.url)).size).toBe(5);
    for (const r of out.items) expect(r.source).toBe("google-news-rss");
  });

  it("fetchGoogleNewsRss (the plain wrapper) returns the same recovered articles", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(REAL_FEED_XML);
      if (url.includes("/rss/articles/")) {
        const token = url.match(/\/rss\/articles\/([^?&\s]+)/)?.[1] ?? "";
        return textResponse(
          articlePageHtml({ id: token, ts: 1787812383, sg: "sig", bl: "boq_test", sid: "12345" })
        );
      }
      if (url.includes("/_/DotsSplashUi/data/batchexecute")) {
        return textResponse(batchexecuteResponse("https://publisher.example.com/resolved"));
      }
      throw new Error("unexpected fetch: " + url);
    });

    const out = await fetchGoogleNewsRss("בנק לאומי", { days: 30 });
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.url === "https://publisher.example.com/resolved")).toBe(true);
  });

  it("degrades to [] when the article page is missing the fields batchexecute needs", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(REAL_FEED_XML);
      if (url.includes("/rss/articles/")) return textResponse("<html><body>no data attributes here</body></html>");
      throw new Error("batchexecute should never be called when the page has no usable fields");
    });

    const out = await fetchGoogleNewsRssWithStats("בנק לאומי", { days: 30 });
    expect(out.items).toEqual([]);
    expect(out.itemsResolved).toBe(0);
  });

  it("degrades to [] (never throws) when the batchexecute call rejects", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(REAL_FEED_XML);
      if (url.includes("/rss/articles/")) {
        const token = url.match(/\/rss\/articles\/([^?&\s]+)/)?.[1] ?? "";
        return textResponse(articlePageHtml({ id: token, ts: 1, sg: "s", bl: "b", sid: "1" }));
      }
      if (url.includes("/_/DotsSplashUi/data/batchexecute")) throw new Error("network down mid-resolution");
      throw new Error("unexpected fetch: " + url);
    });

    await expect(fetchGoogleNewsRss("q")).resolves.toEqual([]);
  });
});

describe("fetchGoogleNewsRssWithStats — mass-drop signal", () => {
  it("flags massDrop and logs a MASS_DROP marker when a real feed resolves to nothing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(REAL_FEED_XML);
      // Simulates Google changing the article-page shape again: none of the fields the
      // batchexecute call needs are present anymore.
      if (url.includes("/rss/articles/")) return textResponse("<html><body>format changed</body></html>");
      throw new Error("batchexecute should never be reached — no fields to build the request from");
    });

    const out = await fetchGoogleNewsRssWithStats("בנק לאומי", { days: 30 });
    expect(out.itemsSeen).toBe(5);
    expect(out.itemsAttempted).toBe(5);
    expect(out.itemsResolved).toBe(0);
    expect(out.massDrop).toBe(true);
    expect(out.items).toEqual([]);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg] = errorSpy.mock.calls[0];
    expect(String(msg)).toContain("[google-news-rss] MASS_DROP");
    expect(String(msg)).toContain("itemsSeen=5");
    expect(String(msg)).toContain("itemsResolved=0");
    errorSpy.mockRestore();
  });

  it("does NOT flag massDrop for a genuinely-small sample (below MASS_DROP_MIN_ATTEMPTED)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const xml = rss(item({ token: b64url("no embedded url here"), pubDate: new Date().toUTCString() }));
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(xml);
      if (url.includes("/rss/articles/")) return textResponse("<html><body>no fields</body></html>");
      throw new Error("unexpected fetch: " + url);
    });

    const out = await fetchGoogleNewsRssWithStats("q", { days: 30 });
    expect(out.itemsAttempted).toBe(1);
    expect(out.itemsResolved).toBe(0);
    expect(out.massDrop).toBe(false); // 1 item is not a meaningful sample
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does NOT flag massDrop when most items resolve fine", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/rss/search")) return textResponse(REAL_FEED_XML);
      if (url.includes("/rss/articles/")) {
        const token = url.match(/\/rss\/articles\/([^?&\s]+)/)?.[1] ?? "";
        return textResponse(articlePageHtml({ id: token, ts: 1, sg: "s", bl: "b", sid: "1" }));
      }
      if (url.includes("/_/DotsSplashUi/data/batchexecute")) {
        return textResponse(batchexecuteResponse("https://publisher.example.com/ok"));
      }
      throw new Error("unexpected fetch: " + url);
    });

    const out = await fetchGoogleNewsRssWithStats("בנק לאומי", { days: 30 });
    expect(out.itemsResolved).toBe(5);
    expect(out.massDrop).toBe(false);
  });
});
