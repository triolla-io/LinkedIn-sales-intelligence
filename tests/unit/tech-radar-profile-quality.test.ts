import { describe, expect, it } from "vitest";
import {
  MIN_AXES_PER_PERSON,
  thinProfiles,
  stageDistribution,
  sameDecisionCollisions,
  uniqueQueryCount,
} from "@/lib/tech-radar/profile-quality";

/**
 * Four numbers the 2026-08-26 run could not produce, each answering a question the report
 * left open:
 *
 *  - Elinor Levinson Gafni came back with TWO axes, one of which was not even hers, and
 *    the run said "done". A thin profile has to declare itself thin.
 *  - Stage (ד) produced zero axes for all four people and nothing counted it, so the
 *    prompt's failure to land was invisible.
 *  - Erez and Pazit both work at Bank Hapoalim. If the brain hands them the same decision,
 *    it took the company and not the person — which is the whole defect.
 *  - Refusing a cross-sector merge raises the axis count. It only raises the BILL if it
 *    raises the number of distinct query strings.
 */
const axis = (over: Record<string, unknown> = {}) => ({
  label: "l", rationale: "r", stage: "decision" as const,
  personDecision: "מחזיקה את החלטת חוויית הלקוח", companyFact: "f",
  searchQueries: ["q1"], agenda: false, key: "k",
  ...over,
});

describe("thinProfiles", () => {
  it("names anyone left under the floor, with the count", () => {
    const out = thinProfiles([
      { name: "Elinor Levinson Gafni", axes: [axis(), axis()] },
      { name: "Erez Rachmil", axes: [axis(), axis(), axis(), axis()] },
    ]);
    expect(out).toEqual([{ name: "Elinor Levinson Gafni", axes: 2, floor: MIN_AXES_PER_PERSON }]);
  });

  it("treats the floor as inclusive — three axes is not thin", () => {
    expect(thinProfiles([{ name: "A", axes: [axis(), axis(), axis()] }])).toEqual([]);
  });

  it("names a person the gate emptied completely", () => {
    expect(thinProfiles([{ name: "A", axes: [] }])[0]).toMatchObject({ name: "A", axes: 0 });
  });
});

describe("stageDistribution", () => {
  it("counts every stage, including the ones that produced nothing", () => {
    const d = stageDistribution([axis(), axis({ stage: "competitor" }), axis({ stage: "competitor" })]);
    // adopt at 0 across everyone is the signal that stage (ד) did not land — so it has to
    // be present as a zero, not absent from the object.
    expect(d).toEqual({ decision: 1, competitor: 2, stop_and_read: 0, adopt: 0 });
  });
});

describe("sameDecisionCollisions", () => {
  it("flags two people at the SAME employer handed the same decision", () => {
    const out = sameDecisionCollisions([
      { name: "Erez Rachmil", employerId: "hapoalim", axes: [axis({ personDecision: "חותם על תקציב מערכות הליבה" })] },
      { name: "Pazit Garfinkel", employerId: "hapoalim", axes: [axis({ personDecision: "חותם על תקציב מערכות הליבה" })] },
    ]);
    expect(out).toEqual([
      { employerId: "hapoalim", decision: "חותם על תקציב מערכות הליבה", people: ["Erez Rachmil", "Pazit Garfinkel"] },
    ]);
  });

  it("ignores the same decision at DIFFERENT employers — that is not the defect", () => {
    // Two heads of retail banking at two banks owning retail pricing is expected. The
    // failure is one company's decisions handed to two of its own executives.
    expect(
      sameDecisionCollisions([
        { name: "Pazit", employerId: "hapoalim", axes: [axis({ personDecision: "מחזיקה את תמחור הריטייל" })] },
        { name: "Elinor", employerId: "leumi", axes: [axis({ personDecision: "מחזיקה את תמחור הריטייל" })] },
      ])
    ).toEqual([]);
  });

  it("matches on meaning, not on punctuation and spacing", () => {
    const out = sameDecisionCollisions([
      { name: "A", employerId: "e", axes: [axis({ personDecision: "חותם  על תקציב הליבה." })] },
      { name: "B", employerId: "e", axes: [axis({ personDecision: "חותם על תקציב הליבה" })] },
    ]);
    expect(out).toHaveLength(1);
  });

  it("is silent when one person holds a decision alone", () => {
    expect(sameDecisionCollisions([{ name: "A", employerId: "e", axes: [axis()] }])).toEqual([]);
  });
});

describe("uniqueQueryCount", () => {
  it("collapses the identical query two axes both asked for", () => {
    // The dedup that makes refusing a cross-sector merge affordable.
    expect(uniqueQueryCount([axis({ searchQueries: ["a", "b"] }), axis({ searchQueries: ["B", "c"] })])).toBe(3);
  });

  it("is zero for no axes, not one", () => {
    expect(uniqueQueryCount([])).toBe(0);
  });
});
