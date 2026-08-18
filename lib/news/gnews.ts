import type { NewsResult } from "@/lib/news/types";
import { reserveNewsCall } from "@/lib/news/budget";

/**
 * GNews treats `-`, `+` and `/` as query operators, so an ordinary phrase like
 * "real-time fraud detection" is rejected outright with HTTP 400 "query has a syntax
 * error" — which this client would then swallow into an empty result. Confirmed live
 * 2026-08-18: "fraud detection launch 2024 2025" -> 200, "real-time fraud detection" -> 400.
 *
 * Quoted phrases are left alone: they ARE valid GNews syntax and are how a caller pins
 * an exact phrase.
 */
export function sanitizeGnewsQuery(query: string): string {
  const quoted: string[] = [];
  // Park quoted phrases so their contents are never rewritten.
  const parked = query.replace(/"[^"]*"/g, (m) => {
    quoted.push(m);
    return `\u0000${quoted.length - 1}\u0000`;
  });
  const cleaned = parked
    .replace(/[-+/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, i) => quoted[Number(i)]);
}

/**
 * GNews ANDs every term across title + description, so a long natural-language query
 * matches nothing. Measured live 2026-08-18:
 *   "payment fraud detection launch" -> 0 results, "payment fraud detection" -> 33.
 * The Tech Radar's profile-derived queries are written for semantic search (Tavily) and
 * have to be cut down before GNews can match them at all.
 *
 * Boolean queries are left completely alone: the Fintech Radar hand-writes them
 * (`fintech (funding OR raises ...)`) and cutting one apart would silently destroy it.
 */
const GNEWS_FILLER = new Set([
  "new", "latest", "launch", "launches", "launched", "launching", "release", "releases",
  "released", "introduces", "introducing", "unveils", "unveiled", "announces", "announced",
  "announcement", "available", "real", "time", "next", "gen", "generation",
  "platform", "software", "tool", "tools", "solution", "solutions", "system", "systems",
  "service", "services", "provider", "providers", "company", "companies", "institutions",
  "the", "a", "an", "for", "and", "with", "of", "in", "to",
]);
const GNEWS_MAX_TERMS = 3;
/** Below this, the query is already short enough for GNews to match. */
const GNEWS_SHORTEN_ABOVE = 3;

export function shortenForGnews(query: string): string {
  // Boolean syntax means the caller wrote this query deliberately — hands off.
  if (/\b(OR|AND|NOT)\b|[()]/.test(query)) return query;

  const quoted = query.match(/"[^"]*"/g);
  // A quoted phrase IS the intent; keep just that.
  if (quoted && quoted.length > 0) return quoted.slice(0, GNEWS_MAX_TERMS).join(" ");

  const words = query.split(/\s+/).filter(Boolean);
  if (words.length <= GNEWS_SHORTEN_ABOVE) return query;

  const kept = words.filter((w) => !GNEWS_FILLER.has(w.toLowerCase()) && !/^\d{4}$/.test(w));
  // Everything was filler — fall back to the leading words rather than an empty query.
  const source = kept.length > 0 ? kept : words;
  return source.slice(0, GNEWS_MAX_TERMS).join(" ").toLowerCase();
}

/** GNews API — https://gnews.io. Free tier 100 req/day.
 *  Missing key, budget exhausted, or any error → [] (never throws). */
export async function fetchGnews(query: string, opts: { max?: number } = {}): Promise<NewsResult[]> {
  const key = (process.env.GNEWS_API_KEY ?? "").trim();
  if (!key) return [];
  const q = shortenForGnews(sanitizeGnewsQuery(query));
  if (!q) return []; // nothing searchable survived sanitizing — don't spend a call
  if (!(await reserveNewsCall("gnews"))) return []; // stay inside the free 100/day quota
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const url = new URL("https://gnews.io/api/v4/search");
    url.searchParams.set("q", q);
    url.searchParams.set("lang", "en");
    url.searchParams.set("max", String(opts.max ?? 10));
    url.searchParams.set("apikey", key);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      // Silently returning [] here is what hid a 400 (bad syntax) and a 429 (rate limit)
      // behind "no results" during the Tech Radar bring-up. Log the status; still no throw.
      console.warn(`[gnews] HTTP ${res.status} for query: ${q}`);
      return [];
    }
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.articles) ? data.articles : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      const src = o.source as Record<string, unknown> | undefined;
      return {
        title: String(o.title ?? ""),
        url: String(o.url ?? ""),
        snippet: String(o.description ?? ""),
        source: `gnews:${src?.name ?? ""}`,
        publishedAt: typeof o.publishedAt === "string" ? o.publishedAt : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
