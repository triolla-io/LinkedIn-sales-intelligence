/**
 * The locale a caller ASKED for must be the locale that is sent.
 *
 * Measured on 2026-09-01, on the first live v3 scan: five of the ten Israeli sources in the
 * banking pack returned zero items, and the cause was not a wrong feed URL. A bare ASCII
 * `site:calcalist.co.il` carries no Hebrew letters, so `localeForQuery` inferred no locale
 * and the request went out on `hl=en-US` — which answers with items dated 2017-2024, every
 * one of them then discarded by the 30-day freshness gate. The SAME query on `hl=he-IL`
 * returns items dated within the week. ynet, mako and haaretz delivered only because their
 * `newsQuery` happened to contain Hebrew.
 *
 * `googleNewsSiteFeedUrl` already spelled the right locale out from `source.lang` — but it
 * only ever produced a REPORTING string, while the actual call re-derived the locale from
 * the query text and threw that away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ISRAEL_LOCALE } from "@/lib/news/locale";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const EMPTY_FEED = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;

function feedResponse(): Response {
  return { ok: true, status: 200, text: async () => EMPTY_FEED } as unknown as Response;
}

async function urlFor(query: string, opts?: { locale?: typeof ISRAEL_LOCALE | null }): Promise<URL> {
  const { fetchGoogleNewsRss } = await import("@/lib/news/google-news-rss");
  fetchMock.mockResolvedValue(feedResponse());
  await fetchGoogleNewsRss(query, { max: 5, ...(opts ?? {}) });
  expect(fetchMock).toHaveBeenCalled();
  return new URL(fetchMock.mock.calls[0][0] as string);
}

describe("fetchGoogleNewsRss locale", () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("sends the Israeli locale when the caller passes it, even for an all-ASCII query", async () => {
    const url = await urlFor("site:calcalist.co.il", { locale: ISRAEL_LOCALE });
    expect(url.searchParams.get("hl")).toBe(ISRAEL_LOCALE.rssHl);
    expect(url.searchParams.get("gl")).toBe(ISRAEL_LOCALE.rssGl);
    expect(url.searchParams.get("ceid")).toBe(ISRAEL_LOCALE.rssCeid);
  });

  it("without an explicit locale, an all-ASCII query still falls back to US — the behaviour that caused the zeros", async () => {
    const url = await urlFor("site:calcalist.co.il");
    expect(url.searchParams.get("hl")).toBe("en-US");
  });

  it("an explicit null locale forces US even when the query is Hebrew", async () => {
    // The override has to work in BOTH directions, or it is a heuristic with an extra step.
    const url = await urlFor("בנק הפועלים", { locale: null });
    expect(url.searchParams.get("hl")).toBe("en-US");
    expect(url.searchParams.get("ceid")).toBe("US:en");
  });

  it("still infers from the query text when the caller says nothing", async () => {
    const url = await urlFor("בנק הפועלים");
    expect(url.searchParams.get("hl")).toBe(ISRAEL_LOCALE.rssHl);
  });
});
