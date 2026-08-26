import { describe, it, expect } from "vitest";

import { capPoolByAxis } from "@/lib/tech-radar/axis-fit";

/**
 * The 2026-08-26 run fetched 413 items and threw 213 away to stay under MAX_POOL_ITEMS.
 * The cut was round-robin over each axis's arrival order, so which half survived was
 * decided by provider response order — a gift could be dropped while a wire-service
 * rewrite two slots earlier was kept.
 *
 * The cap stays (it is the cost ceiling). What changes is that the items inside each
 * axis bucket are ORDERED before the cut, cheaply and deterministically:
 *   1. how many axes asked for the item — one triage dollar serving three subscribers
 *      beats one serving a single subscriber
 *   2. source tier — Israeli press is what this product is short of
 *   3. freshness
 * Ties break on url, so the same pool always cuts the same way.
 */
const item = (
  url: string,
  companyIds: string[],
  publishedAt: string | null = null
) => ({ url, companyIds, publishedAt });

describe("capPoolByAxis ranking", () => {
  it("keeps the item more axes asked for", () => {
    const shared = item("https://reuters.com/shared", ["a", "b", "c"]);
    const solo = item("https://reuters.com/solo", ["a"]);
    // Arrival order deliberately puts the less valuable item first.
    const { kept } = capPoolByAxis([solo, shared], 1);
    expect(kept.map((k) => k.url)).toEqual(["https://reuters.com/shared"]);
  });

  it("prefers an Israeli source over a foreign one at equal demand", () => {
    const foreign = item("https://reuters.com/a", ["a"]);
    const israeli = item("https://www.globes.co.il/b", ["a"]);
    const { kept } = capPoolByAxis([foreign, israeli], 1);
    expect(kept.map((k) => k.url)).toEqual(["https://www.globes.co.il/b"]);
  });

  it("prefers the fresher item when demand and source tier match", () => {
    const older = item("https://reuters.com/older", ["a"], "2026-08-01T00:00:00Z");
    const newer = item("https://reuters.com/newer", ["a"], "2026-08-25T00:00:00Z");
    const { kept } = capPoolByAxis([older, newer], 1);
    expect(kept.map((k) => k.url)).toEqual(["https://reuters.com/newer"]);
  });

  it("treats a missing date as oldest rather than newest", () => {
    // An unknown date must not outrank a known recent one, or items from the provider
    // that reports no date would win every tie.
    const dated = item("https://reuters.com/dated", ["a"], "2026-08-20T00:00:00Z");
    const undated = item("https://reuters.com/undated", ["a"], null);
    const { kept } = capPoolByAxis([undated, dated], 1);
    expect(kept.map((k) => k.url)).toEqual(["https://reuters.com/dated"]);
  });

  it("still spreads the cut across axes rather than letting one axis take the whole cap", () => {
    // The round-robin is the reason no interest gets starved; ranking orders WITHIN a
    // bucket and must not collapse that.
    const pool = [
      item("https://reuters.com/a1", ["a"], "2026-08-25T00:00:00Z"),
      item("https://reuters.com/a2", ["a"], "2026-08-24T00:00:00Z"),
      item("https://reuters.com/a3", ["a"], "2026-08-23T00:00:00Z"),
      item("https://reuters.com/b1", ["b"], "2026-08-01T00:00:00Z"),
    ];
    const { kept } = capPoolByAxis(pool, 2);
    expect(kept.map((k) => k.companyIds[0]).sort()).toEqual(["a", "b"]);
  });

  it("is deterministic for an identical pool", () => {
    const pool = [
      item("https://reuters.com/x", ["a"]),
      item("https://reuters.com/y", ["a"]),
      item("https://reuters.com/z", ["a"]),
    ];
    const first = capPoolByAxis(pool, 2).kept.map((k) => k.url);
    const second = capPoolByAxis([...pool].reverse(), 2).kept.map((k) => k.url);
    expect(first).toEqual(second);
  });
});
