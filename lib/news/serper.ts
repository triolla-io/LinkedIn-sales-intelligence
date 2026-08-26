import type { NewsResult } from "@/lib/news/types";
import { reserveNewsCall } from "@/lib/news/budget";
import { localeForQuery } from "@/lib/news/locale";

/**
 * Google's recency operator for a day count: qdr:d / qdr:w / qdr:m / qdr:y.
 *
 * Rounded UP to the coarser bucket — asking for less than the window would drop news the
 * window allows, and the exact cut is made after the fetch anyway.
 */
export function recencyTbs(days: number | undefined): string | null {
  if (!days || days <= 0) return null;
  if (days <= 1) return "qdr:d";
  if (days <= 7) return "qdr:w";
  if (days <= 31) return "qdr:m";
  if (days <= 366) return "qdr:y";
  return null;
}

/** Serper.dev news search — https://serper.dev. Free credits then ~$0.001/query.
 *  Missing key, budget exhausted, or any error → [] (never throws). */
export async function fetchSerper(
  query: string,
  opts: { days?: number } = {}
): Promise<NewsResult[]> {
  const key = (process.env.SERPER_API_KEY ?? "").trim();
  if (!key) return [];
  if (!(await reserveNewsCall("serper"))) return []; // cap monthly pay-per-query spend
  const locale = localeForQuery(query);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://google.serper.dev/news", {
      signal: controller.signal,
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      // Spread rather than send nulls: serper reads an explicit gl/hl as an instruction,
      // so an English query must carry no locale keys at all rather than empty ones.
      // tbs is Google's recency filter, which serper passes through. Without it every
      // result is untimed, and in August 2026 serper served an entire scan alone — so
      // "the last 30 days" silently became "any time", and a 66-day-old story reached a
      // bank executive. The post-fetch gate is what actually enforces the window; this
      // just stops us paying for results we are about to throw away.
      body: JSON.stringify({
        q: query,
        num: 10,
        ...(recencyTbs(opts.days) ? { tbs: recencyTbs(opts.days) } : {}),
        ...(locale ? { gl: locale.gl, hl: locale.hl, location: locale.location } : {}),
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // A swallowed non-2xx is indistinguishable from "no news". Tavily returns 432
      // when the account plan limit is spent; that looked like an empty week during
      // the Tech Radar bring-up. Log the status; still never throw.
      console.warn(`[serper] HTTP ${res.status} for query: ${query}`);
      return [];
    }
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.news) ? data.news : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: String(o.title ?? ""),
        url: String(o.link ?? ""),
        snippet: String(o.snippet ?? ""),
        source: "serper",
        publishedAt: typeof o.date === "string" ? o.date : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
