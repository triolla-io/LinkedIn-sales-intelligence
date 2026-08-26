import { describe, it, expect } from "vitest";
import { tallyAxisStats } from "@/lib/tech-radar/person-scan";

/**
 * "0 results" has to be attributable to an axis, or the decisions screen cannot tell an
 * explained silence from a broken radar. The pool is deduplicated across axes, so one
 * query serves several subscribers — every one of them must be credited.
 */

const axes = [
  { id: "a1", label: "חבות RIN" },
  { id: "a2", label: "מרווחי זיקוק" },
  { id: "a3", label: "מונטיזציה" },
];

describe("tallyAxisStats", () => {
  it("credits a shared query to every axis that asked for it", () => {
    const stats = tallyAxisStats(
      axes,
      [{ query: "refining margins", axisIds: ["a1", "a2"] }],
      [{ url: "https://news.com/1", companyIds: ["a1", "a2"] }]
    );
    expect(stats.find((s) => s.axisId === "a1")).toMatchObject({ queries: 1, results: 1 });
    expect(stats.find((s) => s.axisId === "a2")).toMatchObject({ queries: 1, results: 1 });
  });

  it("an axis that asked and got nothing is reported as silence, not omitted", () => {
    const stats = tallyAxisStats(
      axes,
      [
        { query: "rin obligations", axisIds: ["a1"] },
        { query: "sports monetization", axisIds: ["a3"] },
      ],
      [{ url: "https://news.com/1", companyIds: ["a1"] }]
    );
    const a3 = stats.find((s) => s.axisId === "a3")!;
    expect(a3).toMatchObject({ queries: 1, results: 0 });
    expect(stats).toHaveLength(3);
  });

  it("flags a Hebrew query that brought back no Israeli source", () => {
    const stats = tallyAxisStats(
      [axes[0]],
      [{ query: "זיקוק דלקים בישראל", axisIds: ["a1"] }],
      [{ url: "https://reuters.com/x", companyIds: ["a1"] }]
    );
    expect(stats[0].hebrewNoIsraeliSource).toBe(true);
  });

  it("does not flag a Hebrew query that did reach an Israeli source", () => {
    const stats = tallyAxisStats(
      [axes[0]],
      [{ query: "זיקוק דלקים בישראל", axisIds: ["a1"] }],
      [{ url: "https://www.calcalist.co.il/x", companyIds: ["a1"] }]
    );
    expect(stats[0].hebrewNoIsraeliSource).toBe(false);
  });

  it("does not flag an axis that never asked in Hebrew", () => {
    const stats = tallyAxisStats(
      [axes[0]],
      [{ query: "rin obligations refiners", axisIds: ["a1"] }],
      []
    );
    expect(stats[0].hebrewNoIsraeliSource).toBe(false);
  });

  /**
   * The freshness gate can remove an Israeli source while leaving a non-Israeli one
   * fresh. `results` still reads off the post-gate list (an honest "found less this
   * week"), but the Hebrew-source warning must be checked against what the query
   * actually returned before the gate — otherwise a merely-stale Israeli hit reads as
   * "this query never finds Israeli coverage", which is a different, false diagnosis.
   */
  it("does not flag a Hebrew query whose Israeli source only went stale, not missing", () => {
    const stats = tallyAxisStats(
      [axes[0]],
      [{ query: "זיקוק דלקים בישראל", axisIds: ["a1"] }],
      [{ url: "https://reuters.com/x", companyIds: ["a1"] }], // post-gate: survivors only
      [
        { url: "https://reuters.com/x", companyIds: ["a1"] },
        { url: "https://www.calcalist.co.il/stale", companyIds: ["a1"] }, // pre-gate: the Israeli hit that went stale
      ]
    );
    expect(stats[0].results).toBe(1); // the honest post-gate count
    expect(stats[0].hebrewNoIsraeliSource).toBe(false); // the query DID reach Israeli coverage
  });
});
