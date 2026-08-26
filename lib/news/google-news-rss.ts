import type { NewsResult } from "@/lib/news/types";
import { localeForQuery } from "@/lib/news/locale";

/**
 * Google News RSS — https://news.google.com/rss/search. Free, keyless, no per-account
 * quota — like GDELT (lib/news/gdelt.ts), there is no reserveNewsCall gate here.
 *
 * Google wraps every article link in a redirect
 * (news.google.com/rss/articles/<token>?oc=5). The token is not a plain URL; it must be
 * base64url-decoded and searched for an embedded `https?://` link. When nothing usable
 * is found, the item is DROPPED rather than forwarded as a wrapper link — a wrapper URL
 * must never reach a draft (it is rejected downstream anyway, and a dropped item is
 * honest where a wrapper is not).
 *
 * Missing url, non-2xx, or any exception -> [] (never throws).
 */

const DEFAULT_MAX = 25;

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

/** Recover the real publisher URL from a wrapper token, or null when it cannot be. */
function recoverPublisherUrl(token: string): string | null {
  const decoded = base64UrlDecode(token);
  const match = decoded.match(/https?:\/\/[^\s"'<>]+/);
  if (!match) return null;
  try {
    const host = new URL(match[0]).hostname.toLowerCase();
    if (host === "news.google.com") return null;
    return match[0];
  } catch {
    return null;
  }
}

/**
 * Parse the RSS feed body into NewsResult rows. Pure — a small hand-rolled parser
 * rather than a new XML dependency, since the feed shape is fixed and narrow (item,
 * title, link, pubDate). `now` is accepted for symmetry with the rest of the provider
 * layer; date-window filtering itself lives in fetchGoogleNewsRss, which is the only
 * caller that knows opts.days.
 */
export function parseGoogleNewsRss(xml: string, now: Date): NewsResult[] {
  void now;
  const out: NewsResult[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const linkRaw = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "";
    const pubDateRaw = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";

    const token = extractToken(linkRaw);
    const url = token ? recoverPublisherUrl(token) : null;
    if (!url) continue;

    const ms = Date.parse(pubDateRaw);
    const publishedAt = Number.isNaN(ms) ? null : new Date(ms).toISOString();

    out.push({
      title: extractTitle(titleRaw),
      url,
      snippet: "",
      source: "google-news-rss",
      publishedAt,
    });
  }
  return out;
}

export async function fetchGoogleNewsRss(
  query: string,
  opts: { days?: number; max?: number } = {}
): Promise<NewsResult[]> {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[google-news-rss] HTTP ${res.status} for query: ${query}`);
      return [];
    }
    const xml = await res.text();
    const now = new Date();
    let items = parseGoogleNewsRss(xml, now);
    if (opts.days != null) {
      const cutoff = now.getTime() - opts.days * 86_400_000;
      items = items.filter((r) => r.publishedAt != null && Date.parse(r.publishedAt) >= cutoff);
    }
    return items.slice(0, max);
  } catch {
    return [];
  }
}
