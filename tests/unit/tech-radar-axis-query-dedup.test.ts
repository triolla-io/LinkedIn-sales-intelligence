import { describe, it, expect, vi } from "vitest";
import { buildAxisQueryPool } from "@/lib/tech-radar/axis-fit";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import { fetchPoolNews } from "@/lib/tech-radar/fetch-pool-news";
import type { NewsResult } from "@/lib/news/types";

/**
 * THE reason not merging axes is affordable.
 *
 * The saving was never in folding two people's axes into one row — it is in the pool:
 * two axes asking for the same string are one fetched query, and the item that comes
 * back is tagged for both. So when the competitive-set gate refuses a merge and the two
 * companies genuinely share a rival, the two axes still produce ONE provider call.
 *
 * If this stops collapsing, refusing merges multiplies provider spend silently — which
 * is the outcome the product owner asked to be measured rather than assumed.
 */
const MAX_QUERIES_PER_AXIS = 3;

function result(url: string): NewsResult {
  return { title: "t", url, snippet: "s", source: "tavily", publishedAt: "1 day ago" };
}

/** No pacing in a test: fetchPoolNews sleeps 1.5s between queries in production. */
const noSleep = { sleep: async () => {} };

describe("axis queries are deduped before they are fetched", () => {
  it("fetches one query once, however many axes asked for it", async () => {
    const pool = buildAxisQueryPool(
      [
        { id: "ax-elinor", searchQueries: ["בנקאות פתוחה ישראל"] },
        // The same string from a different axis — different person, same rival subject.
        { id: "ax-pazit", searchQueries: ["  בנקאות פתוחה ישראל  "] },
      ],
      normalizeQuery,
      MAX_QUERIES_PER_AXIS
    );
    expect(pool).toHaveLength(1);
    expect(pool[0].axisIds).toEqual(["ax-elinor", "ax-pazit"]);

    const fetcher = vi.fn(async () => [result("https://globes.co.il/1")]);
    const out = await fetchPoolNews(
      pool.map((p) => ({ query: p.query, companyIds: p.axisIds })),
      fetcher,
      noSleep
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(out.queriesRun).toBe(1);
    // Both axes are credited with the item, which is what the shared judgement needs.
    expect(out.items[0].companyIds).toEqual(["ax-elinor", "ax-pazit"]);
  });

  /**
   * The cost of NOT merging, priced. Two unmerged axes on the same subject cost one extra
   * query per query string they do not have in common — not one extra per axis.
   */
  it("charges only for the query strings the two axes do not share", async () => {
    const pool = buildAxisQueryPool(
      [
        {
          id: "ax-hapoalim",
          searchQueries: ["open banking Israel launch", "בנקאות פתוחה ישראל", "Pepper אפליקציה"],
        },
        {
          id: "ax-leumi",
          searchQueries: ["Open Banking Israel Launch", "בנקאות פתוחה ישראל", "וואן זירו מוצר חדש"],
        },
      ],
      normalizeQuery,
      MAX_QUERIES_PER_AXIS
    );
    // 6 queries written, 4 distinct: two collapsed, two are genuinely different.
    expect(pool).toHaveLength(4);

    const fetcher = vi.fn(async () => [result("https://globes.co.il/x")]);
    const out = await fetchPoolNews(
      pool.map((p) => ({ query: p.query, companyIds: p.axisIds })),
      fetcher,
      noSleep
    );
    expect(out.queriesRun).toBe(4);
  });

  /** Case and surrounding quotes are phrasing, not intent — the grouping key ignores both. */
  it("collapses queries that differ only in case or quoting", async () => {
    const pool = buildAxisQueryPool(
      [
        { id: "ax1", searchQueries: ['"Open Banking API launch"'] },
        { id: "ax2", searchQueries: ["open banking api launch"] },
        { id: "ax3", searchQueries: ["Open Banking API Launch."] },
      ],
      normalizeQuery,
      MAX_QUERIES_PER_AXIS
    );
    expect(pool).toHaveLength(1);
    expect(pool[0].axisIds).toEqual(["ax1", "ax2", "ax3"]);
  });
});
