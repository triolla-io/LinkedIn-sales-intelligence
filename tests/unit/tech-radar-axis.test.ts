import { describe, it, expect } from "vitest";
import {
  normalizeAxisKey,
  axisSimilarity,
  judgeAxisMerge,
  judgeCeilings,
  isTooBroad,
  companyMonitorKey,
  MAX_AXES_PER_ORG,
  MAX_AXES_PER_PERSON,
} from "@/lib/tech-radar/axis";

describe("normalizeAxisKey", () => {
  /**
   * Token-sorted on purpose: two people describing the same interest in a different word
   * order must land on ONE axis. Without this, the catalog inflates with synonyms and
   * every axis has one subscriber — which is per-person fit wearing a costume.
   */
  it("treats a reordered label as the same axis", () => {
    expect(normalizeAxisKey("זיהוי הונאות")).toBe(normalizeAxisKey("הונאות זיהוי"));
  });

  it("drops filler that carries no distinguishing meaning", () => {
    expect(normalizeAxisKey("תחום זיהוי הונאות")).toBe(normalizeAxisKey("זיהוי הונאות"));
    expect(normalizeAxisKey("the payments industry")).toBe(normalizeAxisKey("payments"));
  });

  it("is case- and punctuation-insensitive", () => {
    expect(normalizeAxisKey('"Fraud Detection"')).toBe(normalizeAxisKey("fraud detection"));
    expect(normalizeAxisKey("core-banking")).toBe(normalizeAxisKey("core banking"));
  });

  it("collapses a repeated token", () => {
    expect(normalizeAxisKey("payments payments")).toBe("payments");
  });

  /** A label that is nothing but filler is not an interest. */
  it("returns empty for a label with no content", () => {
    expect(normalizeAxisKey("תחום")).toBe("");
    expect(normalizeAxisKey("the industry of")).toBe("");
    expect(normalizeAxisKey("   ")).toBe("");
    expect(normalizeAxisKey(undefined as unknown as string)).toBe("");
  });

  it("does not merge two genuinely different interests", () => {
    expect(normalizeAxisKey("זיהוי הונאות")).not.toBe(normalizeAxisKey("ליבה בנקאית"));
  });
});

describe("axisSimilarity", () => {
  it("is 1 for the same interest worded differently", () => {
    expect(axisSimilarity("fraud detection", "detection fraud")).toBe(1);
  });

  it("is 0 for no shared tokens", () => {
    expect(axisSimilarity("fraud detection", "core banking")).toBe(0);
  });

  it("is partial for a shared token", () => {
    // {fraud, detection} vs {fraud, prevention} -> 1 shared of 3 distinct
    expect(axisSimilarity("fraud detection", "fraud prevention")).toBeCloseTo(1 / 3);
  });

  /**
   * Set overlap, not substring. v1 matched company names with `contains` and paired
   * "Delek Group" with "Delek US Holdings" — a real bug. Overlap cannot do that in
   * either direction, so both directions are pinned.
   */
  it("does not treat one label containing another as identical", () => {
    expect(axisSimilarity("payments", "cross border payments")).toBeLessThan(1);
    expect(axisSimilarity("cross border payments", "payments")).toBeLessThan(1);
  });

  it("is 0 when either side has no content", () => {
    expect(axisSimilarity("תחום", "payments")).toBe(0);
    expect(axisSimilarity("", "")).toBe(0);
  });
});

describe("judgeAxisMerge", () => {
  const existing = [
    { id: "ax-fraud", key: normalizeAxisKey("זיהוי הונאות"), label: "זיהוי הונאות" },
    { id: "ax-core", key: normalizeAxisKey("ליבה בנקאית"), label: "ליבה בנקאית" },
  ];

  /** Level 1: free. No LLM call, no similarity maths. */
  it("merges on an exact canonical key", () => {
    expect(judgeAxisMerge("הונאות זיהוי", existing)).toEqual({
      decision: "merge",
      axisId: "ax-fraud",
      via: "exact_key",
      similarity: 1,
    });
  });

  /** Level 3: the ONLY band that costs a model call. */
  it("asks only in the ambiguous band", () => {
    // Two three-token labels sharing two tokens: 2 shared of 4 distinct = 0.5.
    const richer = [{ id: "ax-pay-fraud", key: normalizeAxisKey("זיהוי הונאות בתשלומים"), label: "זיהוי הונאות בתשלומים" }];
    const v = judgeAxisMerge("זיהוי הונאות בהעברות", richer);
    expect(v.decision).toBe("ask");
    if (v.decision === "ask") {
      expect(v.axisId).toBe("ax-pay-fraud");
      expect(v.similarity).toBeGreaterThanOrEqual(0.35);
      expect(v.similarity).toBeLessThan(0.6);
    }
  });

  /**
   * This test used to assert that two short labels sharing one token fall BELOW the ask
   * band and become separate axes "without anyone being asked". The first live build
   * showed that is precisely the wrong behaviour: near-duplicates score 0.08-0.38, so a
   * band starting at 0.35 was blind to almost all of them, and 6 people produced 33
   * axes with one subscriber each. ASK_ABOVE is now 0 — everything the free levels do
   * not settle is asked. Changed on evidence, not to make an implementation pass.
   */
  it("asks about a near-duplicate rather than silently creating one", () => {
    const v = judgeAxisMerge("הונאות תשלומים", existing);
    expect(v.decision).toBe("ask");
    if (v.decision === "ask") expect(v.axisId).toBe("ax-fraud");
  });

  it("auto-merges when overlap is high enough to be certain", () => {
    const richer = [{ id: "ax-pay-fraud", key: normalizeAxisKey("זיהוי הונאות בתשלומים"), label: "זיהוי הונאות בתשלומים" }];
    // {זיהוי, הונאות} inside {זיהוי, הונאות, בתשלומים}: 2 shared of 3 = 0.667.
    const v = judgeAxisMerge("זיהוי הונאות", richer);
    expect(v.decision).toBe("merge");
    if (v.decision === "merge") expect(v.via).toBe("similarity");
  });

  /** Even a distant label is asked: one batched call answers the whole set anyway, and
   *  lexical distance is exactly what proved unable to make this call. */
  it("asks even when nothing looks close", () => {
    expect(judgeAxisMerge("אנרגיה מתחדשת", existing).decision).toBe("ask");
  });

  /** Create is what remains when there is nothing to ask ABOUT. */
  it("creates only when the org has no axes at all", () => {
    expect(judgeAxisMerge("זיהוי הונאות", []).decision).toBe("create");
  });

  it("rejects a label that normalises to nothing", () => {
    expect(judgeAxisMerge("תחום", existing)).toEqual({ decision: "reject", reason: "empty_key" });
  });

  /** Whatever is handed in is what can be merged into — never an axis not offered. */
  it("never names an axis it was not given", () => {
    const v = judgeAxisMerge("זיהוי הונאות", [existing[1]]);
    if (v.decision === "merge" || v.decision === "ask") expect(v.axisId).toBe(existing[1].id);
  });
});

describe("judgeCeilings", () => {
  it("allows below both ceilings", () => {
    expect(judgeCeilings({ orgAxisCount: 10, personAxisCount: 2 })).toEqual({ allowed: true });
  });

  /**
   * The person ceiling is checked FIRST. A person already holding five axes should be
   * told that, not told the org is full — the two have different remedies.
   */
  it("reports the person ceiling before the org ceiling when both are hit", () => {
    expect(judgeCeilings({ orgAxisCount: MAX_AXES_PER_ORG, personAxisCount: MAX_AXES_PER_PERSON })).toEqual({
      allowed: false,
      reason: "person_ceiling",
    });
  });

  it("blocks at the org ceiling", () => {
    expect(judgeCeilings({ orgAxisCount: MAX_AXES_PER_ORG, personAxisCount: 1 })).toEqual({
      allowed: false,
      reason: "org_ceiling",
    });
  });

  it("blocks at exactly the ceiling, not one past it", () => {
    expect(judgeCeilings({ orgAxisCount: MAX_AXES_PER_ORG - 1, personAxisCount: 1 }).allowed).toBe(true);
    expect(judgeCeilings({ orgAxisCount: 1, personAxisCount: MAX_AXES_PER_PERSON - 1 }).allowed).toBe(true);
  });
});

describe("isTooBroad", () => {
  /** "פינטק" with most of the cohort subscribed condemns itself. */
  it("condemns an axis more than 40% of people subscribe to", () => {
    expect(isTooBroad({ subscriberCount: 5, orgPeopleCount: 10, medianShareworthy: 0.9 })).toBe(true);
  });

  it("leaves an axis at exactly 40% alone", () => {
    expect(isTooBroad({ subscriberCount: 4, orgPeopleCount: 10, medianShareworthy: 0.9 })).toBe(false);
  });

  it("condemns an axis returning noise however few subscribe", () => {
    expect(isTooBroad({ subscriberCount: 1, orgPeopleCount: 10, medianShareworthy: 0.2 })).toBe(true);
  });

  /** Before the first scan there is no median, and a new axis must survive to have one. */
  it("does not condemn a fresh axis that has not been scanned yet", () => {
    expect(isTooBroad({ subscriberCount: 1, orgPeopleCount: 10, medianShareworthy: null })).toBe(false);
  });

  it("does not divide by zero on an org with no people", () => {
    expect(isTooBroad({ subscriberCount: 0, orgPeopleCount: 0, medianShareworthy: null })).toBe(false);
  });
});

describe("companyMonitorKey", () => {
  /** Structural, so it can never collide with a normalised label. */
  it("is namespaced away from label keys", () => {
    expect(companyMonitorKey("tc1")).toBe("company:tc1");
    expect(normalizeAxisKey("company tc1")).not.toBe(companyMonitorKey("tc1"));
  });
});
