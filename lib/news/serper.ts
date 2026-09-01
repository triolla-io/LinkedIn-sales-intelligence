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

/**
 * serper's WEB search endpoint — `/search`, not `/news`.
 *
 * Every provider in this directory queries a NEWS index, and that is correct for the radar
 * scan: an opportunity is something that just happened. It is the wrong instrument for
 * research ABOUT A PERSON, and on 2026-09-01 the difference was measured on one query with
 * one key. `פזית גרפינקל בנק הפועלים במה עוסקת`:
 *
 *   /news    → nothing. Zero results, for all four people in the pilot cohort, in every
 *              configuration tried — free RSS, paid pool, English name, full Hebrew name.
 *   /search  → the Calcalist piece on her appointment, the bank's OWN management page, the
 *              CAL card agreement, her Calcalist conference appearance, the children's
 *              banking launch, Globes on the CEO's first two appointments.
 *
 * A person's remit does not live in this month's news. It lives on their employer's
 * management page, on a conference agenda, and in an interview from two years ago — pages
 * a news index does not carry at all. This is the single reason v3's person research
 * returned nothing for everybody, and no amount of query phrasing reached past it.
 *
 * `publishedAt` is usually null here and that is fine: research is background, and nothing
 * found by it is ever forwarded to anybody (only the scan's items are). Freshness gates
 * belong on what gets sent, not on what we know about the recipient.
 *
 * Spends from the same monthly serper budget as the news endpoint, so it reserves a call
 * the same way. Never throws — same contract as every provider here.
 */
export async function fetchSerperWeb(query: string, opts: { max?: number } = {}): Promise<NewsResult[]> {
  const key = (process.env.SERPER_API_KEY ?? "").trim();
  if (!key) return [];
  if (!(await reserveNewsCall("serper"))) return [];
  const locale = localeForQuery(query);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://google.serper.dev/search", {
      signal: controller.signal,
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        q: query,
        num: Math.min(Math.max(opts.max ?? 10, 1), 20),
        ...(locale ? { gl: locale.gl, hl: locale.hl, location: locale.location } : {}),
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[serper/search] HTTP ${res.status} for query: ${query}`);
      return [];
    }
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.organic) ? data.organic : [];
    return rows
      .map((r) => {
        const o = r as Record<string, unknown>;
        return {
          title: String(o.title ?? ""),
          url: String(o.link ?? ""),
          snippet: String(o.snippet ?? ""),
          // Tagged apart from "serper" so a report can tell a web page from a news item —
          // they are not interchangeable evidence and should never be counted as one.
          source: "serper-web",
          publishedAt: serperDateToIso(o.date, new Date()),
        } satisfies NewsResult;
      })
      .filter((r) => r.url);
  } catch {
    return [];
  }
}
