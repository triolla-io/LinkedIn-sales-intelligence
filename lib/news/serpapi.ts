import type { NewsResult } from "@/lib/news/types";
import { reserveNewsCall } from "@/lib/news/budget";
import { localeForQuery } from "@/lib/news/locale";

/**
 * SerpApi Google News — https://serpapi.com.
 *
 * This is the provider the Tech Radar actually needs: it takes long,
 * natural-language queries (which GNews cannot match and Tavily charges plan
 * quota for) and returns real Google News coverage of product launches.
 *
 * Two quirks worth knowing:
 *  - The date window goes INSIDE the query as Google's own `when:Nd` operator;
 *    there is no separate date parameter for this engine.
 *  - google_news returns no snippet — only a title — so the title has to carry
 *    the signal downstream. Triage is written to cope with that.
 *
 * Missing key, budget exhausted, or any error → [] (never throws).
 */

/** SerpApi's own display format, e.g. "08/12/2026, 12:30 PM, +0000 UTC". */
export function parseSerpapiDate(row: { iso_date?: unknown; date?: unknown }): string | null {
  if (typeof row.iso_date === "string" && row.iso_date.trim()) return row.iso_date;
  if (typeof row.date !== "string" || !row.date.trim()) return null;
  const parsed = new Date(row.date.replace(/,\s*\+0000 UTC$/, " UTC"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type Row = Record<string, unknown>;

function toResult(row: Row): NewsResult | null {
  const url = typeof row.link === "string" ? row.link : "";
  if (!url) return null;
  const title = String(row.title ?? "");
  const source = row.source as Record<string, unknown> | undefined;
  return {
    title,
    url,
    // No snippet from this engine — the title is all the signal there is.
    snippet: title,
    source: `serpapi:${source?.name ?? ""}`,
    publishedAt: parseSerpapiDate(row),
  };
}

export async function fetchSerpapi(
  query: string,
  opts: { days?: number; max?: number } = {}
): Promise<NewsResult[]> {
  // Production stores a SerpApi key under the older SERPER_API_KEY name; read both
  // so the deployed value keeps working until it is renamed.
  const key = (process.env.SERPAPI_API_KEY ?? process.env.SERPER_API_KEY ?? "").trim();
  if (!key) return [];
  if (!(await reserveNewsCall("serpapi"))) return [];

  const days = opts.days ?? 30;
  const max = opts.max ?? 10;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_news");
    url.searchParams.set("q", `${query} when:${days}d`);
    // A Hebrew query is asking about the Israeli market; gl=us&hl=en was why one came
    // back with Greek and Indian coverage. English queries stay global.
    const locale = localeForQuery(query);
    url.searchParams.set("gl", locale?.gl ?? "us");
    url.searchParams.set("hl", locale?.hl ?? "en");
    url.searchParams.set("api_key", key);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[serpapi] HTTP ${res.status} for query: ${query}`);
      return [];
    }
    const data = await res.json();
    // SerpApi reports quota and query problems in a 200 body.
    if (data?.error) {
      console.warn(`[serpapi] ${String(data.error)} for query: ${query}`);
      return [];
    }

    const rows: unknown[] = Array.isArray(data?.news_results) ? data.news_results : [];
    const flattened: Row[] = rows.flatMap((r) => {
      const row = r as Row;
      // Google News groups related coverage under `stories`.
      return Array.isArray(row.stories) ? (row.stories as Row[]) : [row];
    });

    return flattened
      .map(toResult)
      .filter((r): r is NewsResult => r !== null)
      .slice(0, max);
  } catch {
    return [];
  }
}
