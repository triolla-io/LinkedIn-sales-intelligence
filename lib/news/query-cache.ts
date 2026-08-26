/**
 * The fetched-query memory.
 *
 * Born 2026-08-26: an Inngest step retry re-ran a whole person-scan from the top FOUR
 * times — the function opened a new RadarScanRun row and re-fetched every one of its 39
 * queries on every attempt, spending 156 provider calls on one approved scan. This table
 * is the other half of the fix: a query already answered recently is read back instead of
 * re-bought, so a retry (or a re-fired run) costs nothing on the provider side.
 *
 * Keyed by normalizeQuery() — the SAME normalization the query pool dedupes on
 * (lib/tech-radar/queries.ts) — so two axes asking the same thing share one row, exactly
 * as they share one provider call within a single run.
 */
import { prisma } from "@/lib/prisma";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import type { NewsResult } from "@/lib/news/types";

export const CACHE_TTL_HOURS = 24;
/** An empty answer expires sooner: it is indistinguishable from a provider outage, and a
 *  24h cached "nothing" would hide a broken provider for a whole day. */
export const EMPTY_CACHE_TTL_MINUTES = 90;

/**
 * The cached results for `query`, or null on a miss — absent, expired (24h for a
 * non-empty answer, 90min for an empty one), or a row whose `results` JSON does not
 * parse as an array. A corrupt row behaves like a miss, never a throw: this cache is a
 * cost optimization, not a source of truth, so anything it can't make sense of is
 * treated as "go fetch it".
 *
 * Never throws: a DB failure here degrades to "no cache" rather than failing a scan.
 */
export async function getCachedQuery(query: string, now: Date = new Date()): Promise<NewsResult[] | null> {
  const queryKey = normalizeQuery(query);
  if (!queryKey) return null;
  try {
    const row = await prisma.newsQueryCache.findUnique({ where: { queryKey } });
    if (!row) return null;
    if (!Array.isArray(row.results)) return null;

    const ageMs = now.getTime() - row.fetchedAt.getTime();
    const ttlMs =
      row.results.length === 0 ? EMPTY_CACHE_TTL_MINUTES * 60 * 1000 : CACHE_TTL_HOURS * 60 * 60 * 1000;
    if (ageMs > ttlMs) return null;

    return row.results as unknown as NewsResult[];
  } catch (err) {
    console.warn(`[news-query-cache] read failed for query "${query}": ${(err as Error).message}`);
    return null;
  }
}

/**
 * Upserts on the normalized key and refreshes fetchedAt. Stores exactly what the fetcher
 * returned — canonicalization is applied downstream, on the way into the pool's url
 * dedupe, so a cached and a fresh path produce byte-identical behaviour there.
 *
 * Never throws: a DB failure here must not fail the scan that just paid for these results.
 */
export async function putCachedQuery(query: string, results: NewsResult[]): Promise<void> {
  const queryKey = normalizeQuery(query);
  if (!queryKey) return;
  try {
    await prisma.newsQueryCache.upsert({
      where: { queryKey },
      create: { queryKey, query, results: results as unknown as object, resultCount: results.length, fetchedAt: new Date() },
      update: { query, results: results as unknown as object, resultCount: results.length, fetchedAt: new Date() },
    });
  } catch (err) {
    console.warn(`[news-query-cache] write failed for query "${query}": ${(err as Error).message}`);
  }
}
