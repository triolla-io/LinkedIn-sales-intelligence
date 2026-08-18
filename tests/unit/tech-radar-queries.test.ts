import { describe, it, expect } from "vitest";
import { normalizeQuery, buildQueryPool } from "@/lib/tech-radar/queries";
import { MAX_QUERIES_PER_COMPANY } from "@/lib/tech-radar/types";

describe("normalizeQuery", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeQuery("  Open   Banking   LAUNCH ")).toBe("open banking launch");
  });
  it("strips surrounding quotes", () => {
    expect(normalizeQuery('"embedded finance launch"')).toBe("embedded finance launch");
  });
  it("keeps boolean operators and parentheses — providers need them", () => {
    expect(normalizeQuery("payments (launch OR release)")).toBe("payments (launch or release)");
  });
  it("keeps internal quoted phrases inside a boolean query", () => {
    expect(normalizeQuery('fintech OR "open banking"')).toBe('fintech or "open banking"');
  });
  it("drops trailing punctuation", () => {
    expect(normalizeQuery("stablecoin launch.")).toBe("stablecoin launch");
  });
  it("returns empty for blanks and punctuation-only input", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery("   ")).toBe("");
    expect(normalizeQuery("!!! ---")).toBe("");
    expect(normalizeQuery(undefined as unknown as string)).toBe("");
  });
});

describe("buildQueryPool", () => {
  // THE cost lever. If this stops collapsing, provider spend multiplies silently.
  it("collapses one query asked by three companies into a single subscription", () => {
    const pool = buildQueryPool([
      { id: "c1", searchQueries: ["Open Banking API launch"] },
      { id: "c2", searchQueries: ["open banking api launch"] },
      { id: "c3", searchQueries: ['  "Open Banking API Launch"  '] },
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].companyIds).toEqual(["c1", "c2", "c3"]);
  });

  it("executes the original query string, not the normalized one", () => {
    const pool = buildQueryPool([{ id: "c1", searchQueries: ['payments ("launch" OR release)'] }]);
    expect(pool[0].query).toBe('payments ("launch" OR release)');
  });

  it("keeps genuinely different queries apart", () => {
    const pool = buildQueryPool([
      { id: "c1", searchQueries: ["fraud detection launch", "core banking modernization"] },
    ]);
    expect(pool).toHaveLength(2);
  });

  it("caps each company's contribution", () => {
    const many = Array.from({ length: MAX_QUERIES_PER_COMPANY + 6 }, (_, i) => `query number ${i}`);
    const pool = buildQueryPool([{ id: "c1", searchQueries: many }]);
    expect(pool).toHaveLength(MAX_QUERIES_PER_COMPANY);
  });

  it("does not let a company's duplicate spend two slots", () => {
    const pool = buildQueryPool([{ id: "c1", searchQueries: ["same q", "SAME Q", "other q"] }]);
    expect(pool).toHaveLength(2);
    expect(pool.every((p) => p.companyIds.length === 1)).toBe(true);
  });

  it("drops empty and non-string queries", () => {
    const pool = buildQueryPool([
      { id: "c1", searchQueries: ["", "   ", "!!!", null as unknown as string, "real query"] },
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].query).toBe("real query");
  });

  it("is deterministic regardless of company order", () => {
    const companies = [
      { id: "c2", searchQueries: ["zebra query", "alpha query"] },
      { id: "c1", searchQueries: ["alpha query", "mid query"] },
    ];
    const first = buildQueryPool(companies);
    const second = buildQueryPool([...companies].reverse());
    expect(first.map((p) => p.query)).toEqual(second.map((p) => p.query));
    expect(first.map((p) => p.companyIds)).toEqual(second.map((p) => p.companyIds));
  });

  it("handles no companies and companies with no queries", () => {
    expect(buildQueryPool([])).toEqual([]);
    expect(buildQueryPool([{ id: "c1", searchQueries: [] }])).toEqual([]);
    expect(buildQueryPool([{ id: "c1", searchQueries: undefined as unknown as string[] }])).toEqual([]);
  });
});
