import { describe, it, expect } from "vitest";
import { allocateWeeklyCap } from "@/lib/tech-radar/cap";
import type { CappedCandidate } from "@/lib/tech-radar/types";

function cand(company: string, item: string, score: number, lineKey?: string): CappedCandidate {
  return { trackedCompanyId: company, itemId: item, fitRationale: "r", score, lineKey };
}

describe("allocateWeeklyCap", () => {
  it("returns everything when both ceilings are slack", () => {
    const out = allocateWeeklyCap([cand("a", "1", 0.9), cand("b", "2", 0.5)]);
    expect(out).toHaveLength(2);
  });

  it("applies the per-company cap, keeping the highest scores", () => {
    const input = [1, 2, 3, 4, 5, 6, 7].map((n) => cand("a", `i${n}`, n / 10));
    const out = allocateWeeklyCap(input, { perCompany: 3 });
    expect(out.map((c) => c.itemId)).toEqual(["i7", "i6", "i5"]);
  });

  // The core guarantee: one strong company must not swallow the week.
  it("keeps at least one per company when the global cap cuts", () => {
    const input = [
      ...[0.99, 0.98, 0.97, 0.96, 0.95].map((s, i) => cand("strong", `s${i}`, s)),
      cand("weak1", "w1", 0.11),
      cand("weak2", "w2", 0.1),
    ];
    const out = allocateWeeklyCap(input, { perCompany: 5, weekly: 5 });
    expect(out).toHaveLength(5);
    const companies = new Set(out.map((c) => c.trackedCompanyId));
    expect(companies.has("weak1")).toBe(true);
    expect(companies.has("weak2")).toBe(true);
    // The remaining 3 slots go to the strong company's best.
    expect(out.filter((c) => c.trackedCompanyId === "strong").map((c) => c.itemId)).toEqual(["s0", "s1", "s2"]);
  });

  it("rations the floor itself when there are more companies than the weekly cap", () => {
    const input = [
      cand("c1", "i1", 0.9),
      cand("c2", "i2", 0.8),
      cand("c3", "i3", 0.7),
      cand("c4", "i4", 0.6),
    ];
    const out = allocateWeeklyCap(input, { perCompany: 5, weekly: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.trackedCompanyId)).toEqual(["c1", "c2"]);
  });

  it("gives every company exactly one when companies equal the weekly cap", () => {
    const input = [
      cand("c1", "a", 0.9),
      cand("c1", "b", 0.85),
      cand("c2", "c", 0.4),
      cand("c3", "d", 0.3),
    ];
    const out = allocateWeeklyCap(input, { perCompany: 5, weekly: 3 });
    expect(new Set(out.map((c) => c.trackedCompanyId))).toEqual(new Set(["c1", "c2", "c3"]));
  });

  it("is deterministic on tied scores regardless of input order", () => {
    const a = [cand("c1", "z", 0.5), cand("c2", "a", 0.5), cand("c3", "m", 0.5)];
    const first = allocateWeeklyCap(a, { weekly: 2 });
    const second = allocateWeeklyCap([...a].reverse(), { weekly: 2 });
    expect(first).toEqual(second);
  });

  it("handles empty input and zeroed ceilings without throwing", () => {
    expect(allocateWeeklyCap([])).toEqual([]);
    expect(allocateWeeklyCap([cand("a", "1", 1)], { weekly: 0 })).toEqual([]);
    expect(allocateWeeklyCap([cand("a", "1", 1)], { perCompany: 0 })).toEqual([]);
  });

  /**
   * From the live Delek Group run: a holding company with oil & gas, financial services
   * and real estate received five opportunities, ALL of them financial services. The
   * energy side scored lower and was wiped out entirely, even though it had its own
   * focus area and its own search query.
   */
  it("gives every business line a slot before doubling up on one", () => {
    const input = [
      cand("delek", "fin1", 0.9, "financial services"),
      cand("delek", "fin2", 0.88, "financial services"),
      cand("delek", "fin3", 0.86, "financial services"),
      cand("delek", "energy1", 0.6, "oil and gas"),
      cand("delek", "estate1", 0.5, "real estate"),
    ];
    const out = allocateWeeklyCap(input, { perCompany: 3, weekly: 15 });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.lineKey))).toEqual(
      new Set(["financial services", "oil and gas", "real estate"])
    );
  });

  it("fills the remaining per-company slots by score once each line is represented", () => {
    const input = [
      cand("delek", "fin1", 0.9, "financial services"),
      cand("delek", "fin2", 0.88, "financial services"),
      cand("delek", "energy1", 0.6, "oil and gas"),
    ];
    const out = allocateWeeklyCap(input, { perCompany: 3, weekly: 15 });
    expect(out.map((c) => c.itemId).sort()).toEqual(["energy1", "fin1", "fin2"]);
  });

  it("keeps the highest scorer within each line", () => {
    const input = [
      cand("delek", "fin_low", 0.4, "financial services"),
      cand("delek", "fin_high", 0.95, "financial services"),
      cand("delek", "energy1", 0.6, "oil and gas"),
    ];
    const out = allocateWeeklyCap(input, { perCompany: 2, weekly: 15 });
    expect(out.map((c) => c.itemId).sort()).toEqual(["energy1", "fin_high"]);
  });

  it("behaves exactly as before when no line is attributed", () => {
    const input = [1, 2, 3, 4, 5].map((n) => cand("a", `i${n}`, n / 10));
    const out = allocateWeeklyCap(input, { perCompany: 3 });
    expect(out.map((c) => c.itemId)).toEqual(["i5", "i4", "i3"]);
  });

  it("orders the result by score descending", () => {
    const out = allocateWeeklyCap([cand("a", "1", 0.2), cand("b", "2", 0.8), cand("c", "3", 0.5)]);
    expect(out.map((c) => c.score)).toEqual([0.8, 0.5, 0.2]);
  });
});
