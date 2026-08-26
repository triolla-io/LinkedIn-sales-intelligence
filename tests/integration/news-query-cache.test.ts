import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCachedQuery, putCachedQuery, CACHE_TTL_HOURS, EMPTY_CACHE_TTL_MINUTES } from "@/lib/news/query-cache";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import type { NewsResult } from "@/lib/news/types";

/**
 * The 2026-08-26 incident: an Inngest retry re-ran a whole person-scan from the top and
 * spent 156 provider calls on one approved run. This table is the memory that makes a
 * retried fetch free — a query already answered in the last CACHE_TTL_HOURS (or the last
 * EMPTY_CACHE_TTL_MINUTES, for a "nothing found" answer) is read back, not re-bought.
 */

const TEST_PREFIX = "__news-query-cache-test__";

function result(url: string): NewsResult {
  return { title: "t", url, snippet: "s", source: "tavily", publishedAt: "1 day ago" };
}

async function cleanup() {
  await prisma.newsQueryCache.deleteMany({ where: { query: { startsWith: TEST_PREFIX } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("news query cache", () => {
  it("round-trips a put through get", async () => {
    const query = `${TEST_PREFIX} open banking launch`;
    const results = [result("https://a.com/1"), result("https://a.com/2")];
    await putCachedQuery(query, results);
    const out = await getCachedQuery(query);
    expect(out).toEqual(results);
  });

  it("is a miss for an absent query", async () => {
    const out = await getCachedQuery(`${TEST_PREFIX} never asked`);
    expect(out).toBeNull();
  });

  it(`is a miss for a non-empty row older than ${CACHE_TTL_HOURS}h`, async () => {
    const query = `${TEST_PREFIX} stale nonempty`;
    await putCachedQuery(query, [result("https://a.com/1")]);
    await prisma.newsQueryCache.update({
      where: { queryKey: normalizeQuery(query) },
      data: { fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect(await getCachedQuery(query)).toBeNull();
  });

  it(`is a hit for a non-empty row 2h old (within the ${CACHE_TTL_HOURS}h TTL)`, async () => {
    const query = `${TEST_PREFIX} fresh nonempty`;
    await putCachedQuery(query, [result("https://a.com/1")]);
    await prisma.newsQueryCache.update({
      where: { queryKey: normalizeQuery(query) },
      data: { fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    expect(await getCachedQuery(query)).toEqual([result("https://a.com/1")]);
  });

  it(`is a miss for an EMPTY row 2h old (past the ${EMPTY_CACHE_TTL_MINUTES}min empty TTL)`, async () => {
    const query = `${TEST_PREFIX} stale empty`;
    await putCachedQuery(query, []);
    await prisma.newsQueryCache.update({
      where: { queryKey: normalizeQuery(query) },
      data: { fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    expect(await getCachedQuery(query)).toBeNull();
  });

  it(`is a hit for an EMPTY row 30min old (within the ${EMPTY_CACHE_TTL_MINUTES}min empty TTL)`, async () => {
    const query = `${TEST_PREFIX} fresh empty`;
    await putCachedQuery(query, []);
    await prisma.newsQueryCache.update({
      where: { queryKey: normalizeQuery(query) },
      data: { fetchedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });
    expect(await getCachedQuery(query)).toEqual([]);
  });

  it("is a miss and does not throw when results is not an array", async () => {
    const query = `${TEST_PREFIX} corrupt row`;
    await prisma.newsQueryCache.create({
      data: {
        queryKey: normalizeQuery(query),
        query,
        results: { not: "an array" },
        resultCount: 0,
      },
    });
    await expect(getCachedQuery(query)).resolves.toBeNull();
  });

  it("shares one row between two queries differing only in normalization", async () => {
    const a = `${TEST_PREFIX} Open Banking Launch`;
    const b = `  ${TEST_PREFIX.toLowerCase()} open banking launch  `;
    expect(normalizeQuery(a)).toBe(normalizeQuery(b));
    await putCachedQuery(a, [result("https://a.com/1")]);
    expect(await getCachedQuery(b)).toEqual([result("https://a.com/1")]);
    const rows = await prisma.newsQueryCache.count({ where: { queryKey: normalizeQuery(a) } });
    expect(rows).toBe(1);
  });

  it("upserts on queryKey and refreshes fetchedAt", async () => {
    const query = `${TEST_PREFIX} upsert me`;
    await putCachedQuery(query, [result("https://a.com/1")]);
    const first = await prisma.newsQueryCache.findUniqueOrThrow({ where: { queryKey: normalizeQuery(query) } });
    await putCachedQuery(query, [result("https://a.com/2")]);
    const second = await prisma.newsQueryCache.findUniqueOrThrow({ where: { queryKey: normalizeQuery(query) } });
    expect(second.id).toBe(first.id);
    expect(second.fetchedAt.getTime()).toBeGreaterThanOrEqual(first.fetchedAt.getTime());
    expect(await getCachedQuery(query)).toEqual([result("https://a.com/2")]);
  });
});
