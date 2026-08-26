import type { NewsResult } from "@/lib/news/types";
import { reserveNewsCall } from "@/lib/news/budget";
import { localeForQuery } from "@/lib/news/locale";

const RELATIVE_DATE = /^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i;
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  // Flat 30 days: a serper item reported as "1 month ago" is stamped at fetch time and
  // the freshness gate compares it slightly later, so it lands just outside the 30-day
  // window and is deterministically dropped. Acceptable — an item this vague about its
  // own age is borderline by definition.
  month: 30 * 86_400_000,
};

/**
 * Serper reports relative dates ("2 days ago"). Normalize to ISO at fetch time,
 * or the hard freshness gate would reject the whole provider as undated.
 * An unrecognized string is null, never a guess.
 */
export function serperDateToIso(raw: unknown, now: Date): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const m = raw.trim().match(RELATIVE_DATE);
  if (!m) return null;
  return new Date(now.getTime() - Number(m[1]) * UNIT_MS[m[2].toLowerCase()]).toISOString();
}

/** Serper.dev news search — https://serper.dev. Free credits then ~$0.001/query.
 *  Missing key, budget exhausted, or any error → [] (never throws). */
export async function fetchSerper(query: string, opts: { days?: number } = {}): Promise<NewsResult[]> {
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
      // tbs=qdr:m is Google's past-month range — the only granularity that matches a
      // 30-day window, so days is a presence flag rather than a tunable figure here.
      body: JSON.stringify({
        q: query,
        num: 10,
        ...(locale ? { gl: locale.gl, hl: locale.hl, location: locale.location } : {}),
        ...(opts.days ? { tbs: "qdr:m" } : {}),
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
        publishedAt: serperDateToIso(o.date, new Date()),
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
