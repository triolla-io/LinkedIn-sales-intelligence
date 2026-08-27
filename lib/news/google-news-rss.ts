import type { NewsResult } from "@/lib/news/types";
import { localeForQuery } from "@/lib/news/locale";

/**
 * Google News RSS — https://news.google.com/rss/search. Free, keyless, no per-account
 * quota — like GDELT (lib/news/gdelt.ts), there is no reserveNewsCall gate here.
 *
 * Google wraps every article link in a redirect (news.google.com/rss/articles/<token>?oc=5).
 *
 * 2026-08-27 incident: the token used to base64url-decode to a string containing a plain
 * embedded `https://` URL (recoverPublisherUrlSync below). That format is GONE — a live
 * token decodes to ~116 bytes of opaque binary with no embedded URL — and because this
 * module dropped anything it couldn't recover a URL for, 100% of Google News RSS results
 * were silently discarded for at least one night before anyone noticed. The result looked
 * exactly like "no news this week", not like a broken parser.
 *
 * The real (2026) mechanism, confirmed against live tokens while fixing this: the token
 * is NOT self-contained. Resolving it means asking Google:
 *   1. GET https://news.google.com/rss/articles/<token>?oc=5 — this is an Angular page,
 *      not a redirect to the article. It embeds three things needed for step 2, as HTML
 *      attributes on a hidden node: `data-n-a-id` (the token, again), `data-n-a-ts`
 *      (a timestamp) and `data-n-a-sg` (a per-request signature) — plus two fields inside
 *      the inline `window.WIZ_global_data` blob: `Fwhl2e` (a locale/session context array
 *      the RPC call below expects verbatim) and `cfb2h` (the server build label, used as
 *      the `bl` query param). Naively following the HTTP redirect does NOT work — it lands
 *      on a GDPR consent wall, not the article; the real content lives in this HTML body.
 *   2. POST https://news.google.com/_/DotsSplashUi/data/batchexecute — Google's internal
 *      batchexecute RPC transport, calling the `Fbv4je` ("garturlreq") method with
 *      [ctx, articleId, timestamp, signature] from step 1. The response is a JSON-ish
 *      chunked stream (`)]}'` prefix, then length-prefixed frames); the frame with
 *      `["wrb.fr","Fbv4je", "<json>", ...]` contains an inner JSON string
 *      `["garturlres", "<the real publisher URL>", 1]`.
 * This is the same mechanism several open-source "google news url decoder" projects use.
 * A generic/placeholder context array (`ctx = ["X","X",...]`, seen in some older
 * write-ups) is REJECTED by the RPC today — it must be the real Fwhl2e blob from the
 * page. No cookies are required; both requests are stateless.
 *
 * Cost: resolving one token costs 2 extra HTTP requests, on top of the 1 to fetch the
 * feed itself. Capped by RESOLVE_CAP and run at bounded concurrency (RESOLVE_CONCURRENCY)
 * — see fetchGoogleNewsRssWithStats. This is a real latency/cost change versus the old
 * (free) regex decode; every caller still degrades to [] on any failure, same as before.
 *
 * Loud-failure signal: fetchGoogleNewsRssWithStats reports itemsSeen (raw <item> blocks)
 * vs itemsResolved (usable URLs recovered) and a `massDrop` flag when the resolved
 * fraction is implausibly low for a real 2026 feed. lib/tech-radar/fetch-pool-news.ts
 * threads this into PoolResult.providerStats (the same per-provider report table the
 * morning report already prints), plus a console.error with a MASS_DROP marker — so next
 * time Google changes the format, a scan's report says so instead of looking like a
 * quiet week. See fetchGoogleNewsRssWithStats for the exact thresholds.
 *
 * Missing url, non-2xx, or any exception -> [] (never throws).
 */

const DEFAULT_MAX = 25;

/** A normal desktop UA — the batchexecute endpoint is part of the same app as the page
 *  fetch, so both requests use the same one. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Per-network-call timeout for the token-resolution path (article page, then batchexecute). */
const RESOLVE_TIMEOUT_MS = 8_000;
/** How many tokens to resolve concurrently. Unbounded concurrency risks Google throttling
 *  a burst from one IP; live testing during this fix saw 15/15 succeed at concurrency 6
 *  in under 2s, so 5 is a conservative, comfortably-below-that choice. */
const RESOLVE_CONCURRENCY = 5;
/**
 * Hard ceiling on how many items get a resolution ATTEMPT per fetchGoogleNewsRss call,
 * independent of opts.max. A feed can carry up to ~100 <item> blocks; resolving all of
 * them would turn one "free" provider call into up to 200 requests per query, which does
 * not scale across a pool of dozens of queries. Set above the common opts.max (25) so the
 * downstream day-filter still has slack to find `max` fresh items after some attempts
 * fail or land outside the window.
 */
const RESOLVE_CAP = 40;

/** Below this many attempted items, a low resolved-fraction is not a meaningful sample —
 *  a single genuinely-quiet query should not trip the mass-drop alarm. */
const MASS_DROP_MIN_ATTEMPTED = 3;
/** Below this resolved-fraction (of ATTEMPTED items, not all items seen), treat it as
 *  Google's token format changing again rather than a run of individually-broken tokens. */
const MASS_DROP_MAX_RESOLVED_FRACTION = 0.15;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTitle(raw: string): string {
  const trimmed = raw.trim();
  const cdata = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return decodeEntities((cdata ? cdata[1] : trimmed).trim());
}

/** Google News' wrapper is `.../rss/articles/<token>?oc=5`. */
function extractToken(link: string): string | null {
  const m = link.trim().match(/\/rss\/articles\/([^?&\s]+)/);
  return m ? m[1] : null;
}

function base64UrlDecode(token: string): string {
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    // latin1 maps each byte to one char 1:1, which keeps embedded ASCII URL bytes
    // intact even when the rest of the decoded token is opaque binary.
    return Buffer.from(padded, "base64").toString("latin1");
  } catch {
    return "";
  }
}

function isUsablePublisherUrl(candidate: string): string | null {
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    if (host === "news.google.com") return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * The OLD token format embedded a plain URL directly in the decoded bytes. Free (no
 * network) when it hits. As of 2026-08 this misses almost every live token — see the
 * module doc comment — but is tried first because it costs nothing when it works, and
 * nothing is lost by trying.
 */
function recoverPublisherUrlSync(token: string): string | null {
  const decoded = base64UrlDecode(token);
  const match = decoded.match(/https?:\/\/[^\s"'<>]+/);
  if (!match) return null;
  return isUsablePublisherUrl(match[0]);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The 2026 mechanism: fetch the wrapper's article page, pull the id/timestamp/signature
 * and the page's own RPC context out of it, then replay that exact call against Google's
 * batchexecute endpoint. See the module doc comment for how each piece was found and
 * confirmed against a live token. Returns null on ANY failure (missing field, non-2xx,
 * timeout, unparseable response, or a resolved URL that is itself still news.google.com)
 * — never throws.
 */
async function recoverPublisherUrlViaNetwork(token: string): Promise<string | null> {
  try {
    const pageRes = await fetchWithTimeout(
      `https://news.google.com/rss/articles/${token}?oc=5`,
      { headers: { "user-agent": USER_AGENT } },
      RESOLVE_TIMEOUT_MS
    );
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const idMatch = html.match(/data-n-a-id="([^"]+)"/);
    const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);
    const sgMatch = html.match(/data-n-a-sg="([^"]+)"/);
    const blMatch = html.match(/"cfb2h":"([^"]+)"/);
    const sidMatch = html.match(/"FdrFJe":"([^"]+)"/);
    const ctxMatch = html.match(/"Fwhl2e":"((?:[^"\\]|\\.)*)"/);
    if (!idMatch || !tsMatch || !sgMatch || !blMatch || !sidMatch || !ctxMatch) return null;

    const articleId = idMatch[1];
    const timestamp = Number(tsMatch[1]);
    const signature = sgMatch[1];
    const bl = blMatch[1];
    const sid = sidMatch[1];

    // Fwhl2e's value is a JSON-escaped string whose payload is a JSON array missing its
    // opening bracket (Google's own wiz data-format quirk, confirmed by hand against a
    // live page — the value starts "%.@.[..." and needs one "[" prepended to parse).
    let ctx: unknown;
    try {
      const rawStr: string = JSON.parse(`"${ctxMatch[1]}"`);
      const bracketIdx = rawStr.indexOf("[");
      if (bracketIdx === -1) return null;
      ctx = JSON.parse("[" + rawStr.slice(bracketIdx));
    } catch {
      return null;
    }

    const inner = JSON.stringify(["garturlreq", ctx, articleId, timestamp, signature]);
    const freq = JSON.stringify([[["Fbv4je", inner]]]);
    const body = "f.req=" + encodeURIComponent(freq);
    const reqid = Math.floor(Math.random() * 900_000) + 100_000;
    const batchUrl =
      "https://news.google.com/_/DotsSplashUi/data/batchexecute" +
      `?rpcids=Fbv4je&source-path=%2Frss%2Farticles%2F${encodeURIComponent(token)}` +
      `&bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(sid)}` +
      "&hl=en-US&soc-app=1&soc-platform=1&soc-device=1" +
      `&_reqid=${reqid}&rt=c`;

    const batchRes = await fetchWithTimeout(
      batchUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": USER_AGENT,
        },
        body,
      },
      RESOLVE_TIMEOUT_MS
    );
    if (!batchRes.ok) return null;
    const text = await batchRes.text();

    for (const line of text.split("\n")) {
      if (!line.startsWith("[[")) continue;
      try {
        const frame = JSON.parse(line);
        const first = frame?.[0];
        if (!Array.isArray(first) || first[0] !== "wrb.fr" || typeof first[2] !== "string") continue;
        const payload = JSON.parse(first[2]);
        if (Array.isArray(payload) && payload[0] === "garturlres" && typeof payload[1] === "string") {
          return isUsablePublisherUrl(payload[1]);
        }
      } catch {
        // Not the frame we're looking for — batchexecute's response has several.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Sync fast path first (free), network resolution second (the real 2026 path). */
async function recoverPublisherUrl(token: string): Promise<string | null> {
  return recoverPublisherUrlSync(token) ?? recoverPublisherUrlViaNetwork(token);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

type RawItem = { title: string; token: string | null; pubDateRaw: string };

/** Pure XML parsing of <item> blocks — no URL recovery, nothing dropped. A small
 *  hand-rolled parser rather than a new XML dependency: the feed shape is fixed and
 *  narrow (item, title, link, pubDate). */
function extractItems(xml: string): RawItem[] {
  const out: RawItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const linkRaw = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "";
    const pubDateRaw = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    out.push({ title: titleRaw, token: extractToken(linkRaw), pubDateRaw });
  }
  return out;
}

/**
 * Parse the RSS feed body into NewsResult rows using ONLY the free, network-free sync
 * decode path (recoverPublisherUrlSync). Kept as a pure, synchronous function for
 * anything that wants a cheap best-effort pass without paying for network resolution —
 * as of 2026-08 the sync path misses almost every live token (see the module doc
 * comment), so this alone will usually return far fewer rows than the feed actually
 * contains. fetchGoogleNewsRss / fetchGoogleNewsRssWithStats do the real (network)
 * resolution and are what production code should call. `now` is accepted for symmetry
 * with the rest of the provider layer; date-window filtering itself lives in
 * fetchGoogleNewsRss, which is the only caller that knows opts.days.
 */
export function parseGoogleNewsRss(xml: string, now: Date): NewsResult[] {
  void now;
  const out: NewsResult[] = [];
  for (const raw of extractItems(xml)) {
    const url = raw.token ? recoverPublisherUrlSync(raw.token) : null;
    if (!url) continue;
    const ms = Date.parse(raw.pubDateRaw);
    out.push({
      title: extractTitle(raw.title),
      url,
      snippet: "",
      source: "google-news-rss",
      publishedAt: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    });
  }
  return out;
}

export type GoogleNewsRssStats = {
  items: NewsResult[];
  /** <item> blocks found in the feed XML, before any resolution attempt. */
  itemsSeen: number;
  /** Of itemsSeen, how many actually got a resolution attempt (bounded by RESOLVE_CAP). */
  itemsAttempted: number;
  /** Of itemsAttempted, how many resolved to a usable publisher URL (sync or network). */
  itemsResolved: number;
  /** True when itemsAttempted is a meaningful sample and itemsResolved recovered fewer
   *  than MASS_DROP_MAX_RESOLVED_FRACTION of them — Google's wrapper-token format
   *  probably changed again, not "no news this week". */
  massDrop: boolean;
};

const EMPTY_STATS: GoogleNewsRssStats = { items: [], itemsSeen: 0, itemsAttempted: 0, itemsResolved: 0, massDrop: false };

/**
 * The real (network-resolving) fetch, with the loud-failure signal attached. See the
 * module doc comment for the resolution mechanism and RESOLVE_CAP for the cost bound.
 * Missing url, non-2xx, or any exception -> EMPTY_STATS-shaped result (never throws).
 */
export async function fetchGoogleNewsRssWithStats(
  query: string,
  opts: { days?: number; max?: number } = {}
): Promise<GoogleNewsRssStats> {
  const locale = localeForQuery(query);
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  if (locale) {
    url.searchParams.set("hl", locale.rssHl);
    url.searchParams.set("gl", locale.rssGl);
    url.searchParams.set("ceid", locale.rssCeid);
  } else {
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
  }
  const max = Math.max(1, opts.max ?? DEFAULT_MAX);

  try {
    const res = await fetchWithTimeout(url.toString(), {}, 10_000);
    if (!res.ok) {
      console.warn(`[google-news-rss] HTTP ${res.status} for query: ${query}`);
      return EMPTY_STATS;
    }
    const xml = await res.text();
    const now = new Date();

    const rawItems = extractItems(xml);
    const toResolve = rawItems.slice(0, RESOLVE_CAP);

    const resolved = await mapWithConcurrency(toResolve, RESOLVE_CONCURRENCY, async (raw): Promise<NewsResult | null> => {
      if (!raw.token) return null;
      const publisherUrl = await recoverPublisherUrl(raw.token);
      if (!publisherUrl) return null;
      const ms = Date.parse(raw.pubDateRaw);
      return {
        title: extractTitle(raw.title),
        url: publisherUrl,
        snippet: "",
        source: "google-news-rss",
        publishedAt: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
      };
    });

    let items = resolved.filter((r): r is NewsResult => r !== null);
    const itemsResolved = items.length;

    if (opts.days != null) {
      const cutoff = now.getTime() - opts.days * 86_400_000;
      items = items.filter((r) => r.publishedAt != null && Date.parse(r.publishedAt) >= cutoff);
    }
    items = items.slice(0, max);

    const itemsSeen = rawItems.length;
    const itemsAttempted = toResolve.length;
    const massDrop =
      itemsAttempted >= MASS_DROP_MIN_ATTEMPTED && itemsResolved / itemsAttempted < MASS_DROP_MAX_RESOLVED_FRACTION;
    if (massDrop) {
      // Specific, greppable marker — see the module doc comment. This is the log line;
      // fetch-pool-news.ts's providerStats carries the same signal into the run report.
      console.error(
        `[google-news-rss] MASS_DROP query=${JSON.stringify(query)} itemsSeen=${itemsSeen} ` +
          `itemsAttempted=${itemsAttempted} itemsResolved=${itemsResolved} — Google's wrapper-token ` +
          `format may have changed again (see lib/news/google-news-rss.ts doc comment)`
      );
    }

    return { items, itemsSeen, itemsAttempted, itemsResolved, massDrop };
  } catch {
    return EMPTY_STATS;
  }
}

/**
 * Thin wrapper over fetchGoogleNewsRssWithStats for callers that only want the articles.
 * Never throws — degrades to [] on any failure, same contract as every other provider.
 */
export async function fetchGoogleNewsRss(query: string, opts: { days?: number; max?: number } = {}): Promise<NewsResult[]> {
  try {
    return (await fetchGoogleNewsRssWithStats(query, opts)).items;
  } catch {
    return [];
  }
}
