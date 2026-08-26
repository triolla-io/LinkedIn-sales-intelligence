import type { NewsResult } from "@/lib/news/types";
import { localeForQuery } from "@/lib/news/locale";

/**
 * GDELT DOC 2.0 — https://api.gdeltproject.org/api/v2/doc/doc. Free, keyless, no
 * per-account quota of any kind — unlike the other four providers in this fan-out,
 * there is no reserveNewsCall gate here, because there is no budget to protect. This
 * task exists BECAUSE the other four are out of quota for the month; GDELT and
 * Google News RSS (lib/news/google-news-rss.ts) are pure recall added beside them.
 *
 * Missing url, non-2xx, or any exception -> [] (never throws).
 */

/** GDELT's documented cap on maxrecords. */
const MAX_RECORDS_HARD_CAP = 250;
const DEFAULT_MAX_RECORDS = 25;

const GDELT_COMPACT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/**
 * GDELT's ArtList `seendate` is a compact stamp ("20260826T120000Z"). Normalize it to
 * ISO, or pass a plain parseable date through. Anything else is null, never a guess —
 * the 30-day freshness gate rejects undated items on purpose, and a wrong guess here
 * would smuggle a stale item past it as if it were fresh.
 */
export function gdeltDateToIso(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const m = s.match(GDELT_COMPACT);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}.000Z`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function fetchGdelt(
  query: string,
  opts: { days?: number; max?: number } = {}
): Promise<NewsResult[]> {
  // GDELT takes locale as operators INSIDE the query string, not as separate params.
  // Read them off the locale object rather than knowing Israel by name here.
  const locale = localeForQuery(query);
  const q = locale
    ? `${query} sourcelang:${locale.gdeltSourceLang} sourcecountry:${locale.gdeltSourceCountry}`
    : query;
  const maxrecords = Math.min(Math.max(1, opts.max ?? DEFAULT_MAX_RECORDS), MAX_RECORDS_HARD_CAP);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", q);
    url.searchParams.set("mode", "ArtList");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", String(maxrecords));
    if (opts.days) url.searchParams.set("timespan", `${opts.days}d`);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[gdelt] HTTP ${res.status} for query: ${q}`);
      return [];
    }
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.articles) ? data.articles : [];
    return rows
      .map((r) => {
        const o = r as Record<string, unknown>;
        return {
          title: String(o.title ?? ""),
          url: String(o.url ?? ""),
          snippet: "", // GDELT ArtList carries no snippet field
          source: "gdelt",
          publishedAt: gdeltDateToIso(o.seendate),
        } satisfies NewsResult;
      })
      .filter((r) => r.url);
  } catch {
    return [];
  }
}
