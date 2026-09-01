import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BANKING_IL_PACK, type PackSource, type SourcePack } from "@/lib/tech-radar/sources";
import { fetchSourcePack, googleNewsSiteFeedUrl, parseFeed } from "@/lib/tech-radar/fetch-sources";

/**
 * Every test here injects `fetchText` / `fetchGoogleNews`. Nothing in this file may reach
 * the network: three of the four paid news providers were at 0 remaining for the month on
 * 2026-08-31, and a test that quietly spends a call is how that happened.
 */

function src(over: Partial<PackSource> = {}): PackSource {
  return { host: "example.com", name: "Example", lang: "en", scope: "global", enabled: true, ...over };
}

function pack(sources: PackSource[]): SourcePack {
  return { industryKey: "test", label: "בדיקה", sources, taxonomy: [{ tag: "a", label: "א" }] };
}

function rss(items: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;
}

function item(opts: { title: string; link: string; pubDate?: string; description?: string }): string {
  return (
    "<item>" +
    `<title>${opts.title}</title>` +
    `<link>${opts.link}</link>` +
    (opts.pubDate ? `<pubDate>${opts.pubDate}</pubDate>` : "") +
    (opts.description ? `<description>${opts.description}</description>` : "") +
    "</item>"
  );
}

const NEVER_FETCHED = async () => {
  throw new Error("a test reached the network");
};

describe("BANKING_IL_PACK", () => {
  it("carries exactly 10 global + 10 Israeli sources — the pack size the design fixes", () => {
    expect(BANKING_IL_PACK.sources.filter((s) => s.scope === "global")).toHaveLength(10);
    expect(BANKING_IL_PACK.sources.filter((s) => s.scope === "il")).toHaveLength(10);
  });

  it("has a closed taxonomy of 40-60 tags, with unique tag keys", () => {
    const tags = BANKING_IL_PACK.taxonomy.map((t) => t.tag);
    expect(tags.length).toBeGreaterThanOrEqual(40);
    expect(tags.length).toBeLessThanOrEqual(60);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("names every source with a bare host — the dedupe and the gift gate both key on host", () => {
    for (const s of BANKING_IL_PACK.sources) {
      expect(s.host).not.toMatch(/^https?:\/\//);
      expect(s.host).not.toMatch(/\/|^www\./);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate hosts", () => {
    const hosts = BANKING_IL_PACK.sources.map((s) => s.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

describe("parseFeed", () => {
  it("parses RSS items to ISO dates", () => {
    const parsed = parseFeed(
      rss(item({ title: "Bank launches X", link: "https://example.com/a", pubDate: "Mon, 25 Aug 2026 09:00:00 GMT" }))
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Bank launches X");
    expect(parsed[0].url).toBe("https://example.com/a");
    expect(parsed[0].publishedAt).toBe("2026-08-25T09:00:00.000Z");
  });

  it("leaves publishedAt null when the feed carries no pubDate — the freshness gate must reject it, not receive an invented date", () => {
    const parsed = parseFeed(rss(item({ title: "Undated", link: "https://example.com/b" })));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].publishedAt).toBeNull();
  });

  it("reads Atom entries too — several Israeli outlets serve Atom, and a silent zero would look like a quiet week", () => {
    const atom =
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">' +
      "<entry><title>כלכליסט על תשלומים</title>" +
      '<link rel="alternate" href="https://calcalist.co.il/x"/>' +
      "<updated>2026-08-20T10:00:00Z</updated>" +
      "<summary>סיכום</summary></entry></feed>";
    const parsed = parseFeed(atom);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe("https://calcalist.co.il/x");
    expect(parsed[0].publishedAt).toBe("2026-08-20T10:00:00.000Z");
    expect(parsed[0].snippet).toBe("סיכום");
  });

  it("unwraps CDATA and decodes entities in titles and snippets", () => {
    const parsed = parseFeed(
      rss(
        "<item><title><![CDATA[Bank &amp; Co]]></title><link>https://example.com/c</link>" +
          "<description><![CDATA[<p>Some <b>html</b> body</p>]]></description></item>"
      )
    );
    expect(parsed[0].title).toBe("Bank & Co");
    expect(parsed[0].snippet).toBe("Some html body");
  });
});

describe("googleNewsSiteFeedUrl", () => {
  it("restricts to the host and forces the Israeli locale for a Hebrew source", () => {
    const url = new URL(googleNewsSiteFeedUrl(src({ host: "globes.co.il", lang: "he", scope: "il" })));
    expect(url.origin + url.pathname).toBe("https://news.google.com/rss/search");
    expect(url.searchParams.get("q")).toBe("site:globes.co.il");
    expect(url.searchParams.get("hl")).toBe("he");
    expect(url.searchParams.get("gl")).toBe("IL");
    expect(url.searchParams.get("ceid")).toBe("IL:he");
  });

  it("leaves an English source on the US locale", () => {
    const url = new URL(googleNewsSiteFeedUrl(src({ host: "finextra.com" })));
    expect(url.searchParams.get("ceid")).toBe("US:en");
  });
});

describe("fetchSourcePack", () => {
  it("pulls each source's RSS and tags every item with its source host", async () => {
    const items = await fetchSourcePack(
      pack([
        src({ host: "finextra.com", rss: "https://finextra.com/rss" }),
        src({ host: "globes.co.il", rss: "https://globes.co.il/rss", lang: "he", scope: "il" }),
      ]),
      {
        fetchText: async (url) =>
          url.includes("finextra")
            ? rss(item({ title: "A", link: "https://finextra.com/a", pubDate: "Mon, 25 Aug 2026 09:00:00 GMT" }))
            : rss(item({ title: "ב", link: "https://globes.co.il/b", pubDate: "Tue, 26 Aug 2026 09:00:00 GMT" })),
        fetchGoogleNews: NEVER_FETCHED,
      }
    );
    expect(items.items.map((i) => i.sourceHost)).toEqual(["finextra.com", "globes.co.il"]);
    expect(items.perSource.map((p) => [p.host, p.items, p.via])).toEqual([
      ["finextra.com", 1, "rss"],
      ["globes.co.il", 1, "rss"],
    ]);
  });

  it("keeps the other nine sources when one 404s, and records the failure per source", async () => {
    const sources = Array.from({ length: 10 }, (_, i) =>
      src({ host: `h${i}.com`, rss: `https://h${i}.com/rss` })
    );
    const result = await fetchSourcePack(pack(sources), {
      // h3 is dead on BOTH paths: null from the direct feed and nothing from the fallback.
      fetchText: async (url) =>
        url.includes("h3.com") ? null : rss(item({ title: "t", link: url.replace("/rss", "/a") })),
      fetchGoogleNews: async () => [],
    });
    expect(result.items).toHaveLength(9);
    const dead = result.perSource.find((p) => p.host === "h3.com")!;
    expect(dead.items).toBe(0);
    expect(dead.error).toBeTruthy();
    expect(result.perSource.filter((p) => p.error)).toHaveLength(1);
  });

  it("never throws when a fetcher does — one exploding source cannot end the pull", async () => {
    const result = await fetchSourcePack(
      pack([src({ host: "a.com", rss: "https://a.com/rss" }), src({ host: "b.com", rss: "https://b.com/rss" })]),
      {
        fetchText: async (url) => {
          if (url.includes("a.com")) throw new Error("ECONNRESET");
          return rss(item({ title: "t", link: "https://b.com/a" }));
        },
        fetchGoogleNews: async () => [],
      }
    );
    expect(result.items).toHaveLength(1);
    expect(result.perSource.find((p) => p.host === "a.com")!.error).toContain("ECONNRESET");
  });

  it("dedupes the same story arriving from two sources, crediting the first and counting both", async () => {
    const result = await fetchSourcePack(
      pack([src({ host: "a.com", rss: "https://a.com/rss" }), src({ host: "b.com", rss: "https://b.com/rss" })]),
      {
        // Same story, spelled with www + a tracking param on one side.
        fetchText: async (url) =>
          url.includes("a.com")
            ? rss(item({ title: "Same", link: "https://publisher.com/story" }))
            : rss(item({ title: "Same", link: "https://www.publisher.com/story?utm_source=x" })),
        fetchGoogleNews: NEVER_FETCHED,
      }
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceHost).toBe("a.com");
    // Each source is still credited with what IT found — the fetch-pool-news precedent.
    expect(result.perSource.map((p) => p.items)).toEqual([1, 1]);
  });

  it("canonicalizes at the door — a redirect wrapper once reached a real person", async () => {
    const wrapped =
      "https://www.google.com/url?q=" + encodeURIComponent("https://finextra.com/real-story?utm_source=rss");
    const result = await fetchSourcePack(pack([src({ host: "finextra.com", rss: "https://finextra.com/rss" })]), {
      fetchText: async () => rss(item({ title: "t", link: wrapped })),
      fetchGoogleNews: NEVER_FETCHED,
    });
    expect(result.items[0].url).toBe("https://finextra.com/real-story");
  });

  it("drops an unresolvable search-engine wrapper rather than forwarding it, and says how many it dropped", async () => {
    const result = await fetchSourcePack(pack([src({ host: "spglobal.com", rss: "https://spglobal.com/rss" })]), {
      fetchText: async () =>
        rss(item({ title: "t", link: "https://news.google.com/rss/articles/CBMiOpaqueTokenNoUrlInside?oc=5" })),
      fetchGoogleNews: NEVER_FETCHED,
    });
    expect(result.items).toHaveLength(0);
    expect(result.perSource[0].wrapperDrops).toBe(1);
  });

  it("falls back to the site-restricted Google News feed for a source with no RSS", async () => {
    const asked: string[] = [];
    const result = await fetchSourcePack(pack([src({ host: "bloomberg.com" })]), {
      fetchText: NEVER_FETCHED,
      fetchGoogleNews: async (query) => {
        asked.push(query);
        return [
          {
            title: "Bloomberg on payments",
            url: "https://bloomberg.com/news/x",
            snippet: "",
            source: "google-news-rss",
            publishedAt: "2026-08-25T00:00:00.000Z",
          },
        ];
      },
    });
    expect(asked).toEqual(["site:bloomberg.com"]);
    expect(result.items).toHaveLength(1);
    expect(result.perSource[0].via).toBe("google-news");
    expect(result.perSource[0].feedUrl).toContain("news.google.com/rss/search");
  });

  it("falls back when a source's RSS URL is wrong — a guessed feed path must not cost the source", async () => {
    const result = await fetchSourcePack(pack([src({ host: "fintechnexus.com", rss: "https://fintechnexus.com/feed/" })]), {
      fetchText: async () => null, // 404: the guessed WordPress path is not there
      fetchGoogleNews: async () => [
        { title: "t", url: "https://fintechnexus.com/a", snippet: "", source: "google-news-rss", publishedAt: null },
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.perSource[0].via).toBe("google-news");
    expect(result.perSource[0].error).toBeUndefined();
  });

  it("skips a disabled source without fetching it", async () => {
    const result = await fetchSourcePack(
      pack([src({ host: "a.com", rss: "https://a.com/rss", enabled: false }), src({ host: "b.com", rss: "https://b.com/rss" })]),
      {
        fetchText: async (url) => {
          expect(url).not.toContain("a.com");
          return rss(item({ title: "t", link: "https://b.com/a" }));
        },
        fetchGoogleNews: NEVER_FETCHED,
      }
    );
    expect(result.perSource.map((p) => p.host)).toEqual(["b.com"]);
    expect(result.items).toHaveLength(1);
  });
});

/**
 * A static guard, not a behavioural one. The whole reason this path exists is that the
 * paid providers ran out; wrapping it in reserveNewsCall would throttle the thing that
 * replaces the throttled thing. Cheaper to catch here than in a scan report.
 */
describe("the RSS path stays free and ungated", () => {
  it("does not import a quota gate or a paid provider", () => {
    const source = readFileSync("lib/tech-radar/fetch-sources.ts", "utf8");
    // Usage, not the word: the module's doc comment names reserveNewsCall to explain why
    // it is absent, and a grep for the bare name would fail on the explanation itself.
    expect(source).not.toMatch(/reserveNewsCall\s*\(/);
    for (const metered of ["news/budget", "news/serper", "news/serpapi", "news/tavily", "news/gnews"]) {
      expect(source).not.toContain(`"@/lib/${metered}"`);
    }
  });
});
