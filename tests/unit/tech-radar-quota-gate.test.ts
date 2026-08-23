import { describe, it, expect } from "vitest";
import { projectRunCost, judgeQuota, usableProviders } from "@/lib/tech-radar/quota-gate";
import type { QuotaStatus } from "@/lib/news/budget";

function status(over: Partial<QuotaStatus> = {}): QuotaStatus {
  return { provider: "tavily", window: "month", used: 0, cap: 950, remaining: 950, ...over };
}

describe("projectRunCost", () => {
  it("charges one search per researched company", () => {
    expect(projectRunCost({ companiesToResearch: 5, pooledQueries: 0 }).searches).toBe(5);
  });

  /**
   * fetchPoolNews retries broader when a query returns nothing, so a pooled query costs
   * two. Projecting the optimistic number is how a run that "fits" runs out half way.
   */
  it("charges two per pooled query, because of the broaden retry", () => {
    expect(projectRunCost({ companiesToResearch: 0, pooledQueries: 10 }).searches).toBe(20);
  });

  it("adds the halves and reports them separately", () => {
    expect(projectRunCost({ companiesToResearch: 4, pooledQueries: 3 })).toEqual({
      searches: 10,
      breakdown: { research: 4, scan: 6 },
    });
  });

  it("is zero when there is nothing to do", () => {
    expect(projectRunCost({ companiesToResearch: 0, pooledQueries: 0 }).searches).toBe(0);
  });
});

describe("judgeQuota", () => {
  it("allows a run that fits", () => {
    expect(judgeQuota(100, status({ used: 100, remaining: 850 })).ok).toBe(true);
  });

  it("allows a run that exactly fills the remaining quota", () => {
    expect(judgeQuota(100, status({ remaining: 100 })).ok).toBe(true);
  });

  it("refuses a run that fits only partially, rather than starting it", () => {
    expect(judgeQuota(101, status({ remaining: 100 })).ok).toBe(false);
  });

  /**
   * The exact numbers from the run this exists for: Tavily at 2,174 against a 950 cap,
   * i.e. nothing left, while a scan needed 144. The reason has to carry both numbers —
   * "quota exceeded" with no arithmetic is not something a human can act on.
   */
  it("refuses the real failure and names both numbers", () => {
    const v = judgeQuota(144, status({ used: 2174, remaining: 0 }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toContain("144");
      expect(v.reason).toContain("0");
      expect(v.reason).toContain("tavily");
    }
  });

  it("allows a zero-cost run even at an exhausted quota", () => {
    expect(judgeQuota(0, status({ used: 950, remaining: 0 })).ok).toBe(true);
  });

  /** Unknown is not a green light: reservations fail open, so an unmetered run could spend without limit. */
  it("refuses when the quota is unknown, and says to fix the measurement", () => {
    const v = judgeQuota(10, status({ window: "none", cap: null, remaining: null }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/UPSTASH/);
  });
});

describe("usableProviders", () => {
  /**
   * The state that actually occurred: two providers out of quota, one usable. A run
   * needs one — and naming which died is the difference between an env fix and a code fix.
   */
  it("separates the usable from the blocked, with a reason each", async () => {
    const out = await usableProviders(
      [
        status({ provider: "tavily", used: 2174, remaining: 0 }),
        status({ provider: "gnews", window: "day", used: 774, cap: 90, remaining: 0 }),
        status({ provider: "serper", used: 1, cap: 1500, remaining: 1499 }),
      ],
      144
    );
    expect(out.usable.map((s) => s.provider)).toEqual(["serper"]);
    expect(out.blocked.map((b) => b.provider)).toEqual(["tavily", "gnews"]);
    expect(out.blocked[1].reason).toContain("ליום");
  });

  it("reports every provider blocked when none can cover the run", async () => {
    const out = await usableProviders([status({ remaining: 0 })], 10);
    expect(out.usable).toEqual([]);
    expect(out.blocked).toHaveLength(1);
  });
});
