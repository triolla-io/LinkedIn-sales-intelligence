/**
 * Hard freshness gate — the product decision of 26.8: EVERY item, research and
 * reports included, must carry an extractable publication date within the last
 * FRESHNESS_WINDOW_DAYS. No date → rejected, not demoted. This supersedes the
 * per-kind recency curve in the v2 design doc, which was never implemented.
 *
 * Pure module: no prisma, no fetch, safe to import anywhere.
 */

/** Mirrors SCAN_WINDOW_DAYS (fetch-pool-news.ts) — a test pins them equal. */
export const FRESHNESS_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Zero, not -Infinity, for an unknown date. Every real publication date parses
 * to a positive epoch, so 0 still sorts last in poolRank — and it cannot produce
 * the NaN that (-Infinity - -Infinity) yields, which a comparator returns as an
 * unpredictable order.
 */
export function publishedMs(raw: string | null | undefined): number {
  if (typeof raw !== "string" || !raw) return 0;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

export function isFresh(publishedAt: string | null | undefined, now: Date): boolean {
  const ms = publishedMs(publishedAt);
  if (ms === 0) return false; // no extractable date
  if (ms > now.getTime() + DAY_MS) return false; // future-dated provider garbage
  return now.getTime() - ms <= FRESHNESS_WINDOW_DAYS * DAY_MS;
}

/** One pass, three buckets — stale and undated are counted separately so the run report can explain drops honestly. */
export function splitFresh<T extends { publishedAt?: string | null }>(
  items: T[],
  now: Date
): { fresh: T[]; stale: T[]; undated: T[] } {
  const fresh: T[] = [];
  const stale: T[] = [];
  const undated: T[] = [];
  for (const item of items) {
    if (publishedMs(item.publishedAt) === 0) undated.push(item);
    else if (isFresh(item.publishedAt, now)) fresh.push(item);
    else stale.push(item);
  }
  return { fresh, stale, undated };
}
