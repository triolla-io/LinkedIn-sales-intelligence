import { describe, it, expect } from "vitest";
import { parseProfileResponse, clampPersonalNotes, PROFILE_SYSTEM, MAX_PERSONAL_NOTES } from "@/lib/tech-radar/person-profile";
import { parseAxisFit, buildAxisQueryPool, AXIS_FIT_SYSTEM } from "@/lib/tech-radar/axis-fit";
import { normalizeAxisKey, MAX_AXES_PER_PERSON } from "@/lib/tech-radar/axis";

const axis = (label: string, rationale = "כי הוא בנה את זה", queries = ["vector search research"]) =>
  JSON.stringify({ label, rationale, searchQueries: queries, agenda: false });

describe("PROFILE_SYSTEM", () => {
  /** v1's whole failure was answering "what does this person own?" with the company. */
  it("says the employer profile is context, not the answer", () => {
    expect(PROFILE_SYSTEM).toMatch(/A description of the company as an answer/);
    expect(PROFILE_SYSTEM).toMatch(/is a failed answer/);
  });

  it("forbids a label so generic it would be discarded", () => {
    expect(PROFILE_SYSTEM).toMatch(/פינטק/);
    expect(PROFILE_SYSTEM).toMatch(/Never a single generic word/);
  });

  /** The queries must hunt research, not launches — otherwise the inverted triage
   *  filters out everything the axis brings back. */
  /**
   * The queries decide what a person actually receives. Aimed at weight — flagship
   * reports, regulatory and market moves — because the run before this returned
   * on-topic, weightless items and the filter now rejects them anyway.
   */
  it("aims the queries at weight, not at product launches", () => {
    expect(PROFILE_SYSTEM).toMatch(/flagship reports, industry studies, regulatory moves/);
    expect(PROFILE_SYSTEM).toMatch(/NOT at product launches/);
  });

  /**
   * Israeli recipients, and the best gifts are local. Plain Hebrew surfaces Globes and
   * Calcalist; a probe on 2026-08-23 showed "site:" restriction returns the right
   * publication on the wrong topic, so the prompt forbids it.
   */
  it("requires a Hebrew query for Israeli people, and forbids site: operators", () => {
    expect(PROFILE_SYSTEM).toMatch(/AT LEAST ONE query per axis must be IN HEBREW/);
    expect(PROFILE_SYSTEM).toMatch(/Do NOT use "site:" operators/);
  });

  /** Exactly one axis must come from what the company is doing, not from the title. */
  it("demands exactly one agenda axis, with worked examples of both", () => {
    expect(PROFILE_SYSTEM).toMatch(/EXACTLY ONE of them must have "agenda": true/);
    expect(PROFILE_SYSTEM).toMatch(/NOT AGENDA, this is a role/);
  });

  /** The rationale is what the veto reads. A company-level one is worthless there. */
  /**
   * The exact sentence the veto rejected on 2026-08-23 — "כ-VP Assets, אחראי על…" — is
   * now named in the prompt as the thing not to produce.
   */
  it("names the title-restatement the veto rejected as forbidden", () => {
    expect(PROFILE_SYSTEM).toMatch(/כ-VP Assets, אחראי על/);
    expect(PROFILE_SYSTEM).toMatch(/restatement of the title and will be rejected/);
  });
});

describe("parseProfileResponse", () => {
  it("parses a role lens and its axes", () => {
    const out = parseProfileResponse(
      `{"reasoning":"חשיבה בשלבים","roleLens":"אחראי על מנוע ההמלצות","axes":[${axis("קונסולידציה של מסדי וקטורים")}]}`
    );
    expect(out?.roleLens).toBe("אחראי על מנוע ההמלצות");
    expect(out?.axes[0].key).toBe(normalizeAxisKey("קונסולידציה של מסדי וקטורים"));
  });

  /** A label of pure filler would create an axis every later proposal collides with. */
  it("drops an axis whose label normalises to nothing", () => {
    expect(parseProfileResponse(`{"reasoning":"חשיבה בשלבים","roleLens":"x","axes":[${axis("תחום")}]}`)).toBeNull();
  });

  it("drops an axis with no queries, since it can never surface anything", () => {
    expect(parseProfileResponse(`{"reasoning":"חשיבה בשלבים","roleLens":"x","axes":[${axis("זיהוי הונאות", "r", [])}]}`)).toBeNull();
  });

  it("drops an axis with no rationale, since the veto would have nothing to read", () => {
    expect(parseProfileResponse(`{"reasoning":"חשיבה בשלבים","roleLens":"x","axes":[${axis("זיהוי הונאות", "")}]}`)).toBeNull();
  });

  it("collapses the same subject proposed twice", () => {
    const out = parseProfileResponse(
      `{"reasoning":"חשיבה בשלבים","roleLens":"x","axes":[${axis("זיהוי הונאות")},${axis("הונאות זיהוי")}]}`
    );
    expect(out?.axes).toHaveLength(1);
  });

  it("caps the axes per person", () => {
    const many = Array.from({ length: 9 }, (_, i) => axis(`נושא מספר ${i} ייחודי`)).join(",");
    expect(parseProfileResponse(`{"reasoning":"חשיבה בשלבים","roleLens":"x","axes":[${many}]}`)?.axes.length).toBe(MAX_AXES_PER_PERSON);
  });

  it("returns null without a role lens", () => {
    expect(parseProfileResponse(`{"reasoning":"חשיבה","axes":[${axis("זיהוי הונאות")}]}`)).toBeNull();
    expect(parseProfileResponse("not json")).toBeNull();
  });
});

describe("clampPersonalNotes", () => {
  it("leaves a short note alone", () => {
    expect(clampPersonalNotes("  החליף מסד וקטורים  ")).toBe("החליף מסד וקטורים");
  });

  it("truncates at a word boundary rather than mid-word", () => {
    const note = "מילה ".repeat(200);
    const out = clampPersonalNotes(note);
    expect(out.length).toBeLessThanOrEqual(MAX_PERSONAL_NOTES);
    expect(out.endsWith("מילה")).toBe(true);
  });

  it("still truncates when there is no space to break on", () => {
    expect(clampPersonalNotes("א".repeat(600)).length).toBe(MAX_PERSONAL_NOTES);
  });
});

describe("AXIS_FIT_SYSTEM", () => {
  /**
   * The rationale is SHARED by every subscriber, so naming a person in it would
   * reintroduce exactly the bug this replaces — one reason serving many people.
   */
  it("forbids naming a person or company in the shared rationale", () => {
    expect(AXIS_FIT_SYSTEM).toMatch(/never about any person or company/i);
    expect(AXIS_FIT_SYSTEM).toMatch(/shared by everyone who follows the subject/);
  });

  it("refuses to reward general importance", () => {
    expect(AXIS_FIT_SYSTEM).toMatch(/Do NOT reward an item for being important in general/);
  });
});

describe("parseAxisFit", () => {
  it("reads a score and rationale", () => {
    expect(parseAxisFit('{"score":0.7,"rationale":"מוסיף נתוני אימוץ"}')).toEqual({
      score: 0.7,
      rationale: "מוסיף נתוני אימוץ",
    });
  });

  it("scores zero when the number cannot be trusted", () => {
    for (const bad of ['"high"', "7", "-1", "null"]) {
      expect(parseAxisFit(`{"score":${bad},"rationale":"r"}`).score, `input ${bad}`).toBe(0);
    }
  });

  /** A score with no reason cannot be explained later, so it is not a score. */
  it("scores zero when there is no rationale", () => {
    expect(parseAxisFit('{"score":0.9,"rationale":""}').score).toBe(0);
    expect(parseAxisFit("garbage").score).toBe(0);
  });
});

describe("buildAxisQueryPool", () => {
  const norm = (q: string) => q.toLowerCase().trim();

  /**
   * The one function that flips the direction: queries come from axes, so a company
   * with nobody subscribed contributes nothing and cannot pull the run toward itself.
   */
  it("shares one query across every axis that asked for it", () => {
    const pool = buildAxisQueryPool(
      [
        { id: "ax1", searchQueries: ["Vector Search Research", "embedding cost"] },
        { id: "ax2", searchQueries: ["vector search research"] },
      ],
      norm,
      4
    );
    const shared = pool.find((p) => norm(p.query) === "vector search research");
    expect(shared?.axisIds).toEqual(["ax1", "ax2"]);
    expect(pool).toHaveLength(2);
  });

  it("caps queries per axis", () => {
    const pool = buildAxisQueryPool([{ id: "ax1", searchQueries: ["a", "b", "c", "d"] }], norm, 2);
    expect(pool).toHaveLength(2);
  });

  it("spends one slot when an axis asks twice for the same thing", () => {
    const pool = buildAxisQueryPool([{ id: "ax1", searchQueries: ["a", "A", "b"] }], norm, 2);
    expect(pool.map((p) => norm(p.query)).sort()).toEqual(["a", "b"]);
  });

  /** Deterministic, so an Inngest step replay produces the same pool. */
  it("is deterministic in query and subscriber order", () => {
    const build = () =>
      buildAxisQueryPool(
        [
          { id: "zz", searchQueries: ["b", "a"] },
          { id: "aa", searchQueries: ["a"] },
        ],
        norm,
        4
      );
    expect(build()).toEqual(build());
    expect(build()[0].axisIds).toEqual(["aa", "zz"]);
  });

  it("ignores junk without dropping the rest", () => {
    const pool = buildAxisQueryPool(
      [{ id: "ax1", searchQueries: ["  ", "real query", null as unknown as string] }],
      norm,
      4
    );
    expect(pool).toHaveLength(1);
    expect(pool[0].query).toBe("real query");
  });
});

const { capPoolByAxis } = await import("@/lib/tech-radar/axis-fit");

const item = (url: string, axes: string[]) => ({ url, companyIds: axes });

/**
 * Triage cost scales with pool size and nothing else useful. The 2026-08-23 run pulled
 * 677 items and spent ~$1 triaging them for 30 survivors — over half the daily budget.
 */
describe("capPoolByAxis", () => {
  it("keeps everything when the pool is already small", () => {
    const items = [item("a", ["ax1"]), item("b", ["ax2"])];
    expect(capPoolByAxis(items, 10)).toEqual({ kept: items, dropped: 0 });
  });

  /**
   * The load-bearing property: cutting by arrival order would hand the whole budget to
   * whichever queries ran first, starving every other interest.
   */
  it("gives every axis a turn before any axis gets a second", () => {
    const items = [
      item("a1", ["ax1"]), item("a2", ["ax1"]), item("a3", ["ax1"]),
      item("b1", ["ax2"]), item("b2", ["ax2"]),
      item("c1", ["ax3"]),
    ];
    const { kept } = capPoolByAxis(items, 3);
    expect(kept.map((i) => i.url).sort()).toEqual(["a1", "b1", "c1"]);
  });

  it("reports what it discarded, so a truncated run says so", () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`u${i}`, ["ax1"]));
    const out = capPoolByAxis(items, 5);
    expect(out.kept).toHaveLength(5);
    expect(out.dropped).toBe(15);
  });

  it("keeps filling from the axes that have more when others run dry", () => {
    const items = [
      item("a1", ["ax1"]), item("a2", ["ax1"]), item("a3", ["ax1"]), item("a4", ["ax1"]),
      item("b1", ["ax2"]),
    ];
    const { kept } = capPoolByAxis(items, 4);
    expect(kept.map((i) => i.url)).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("does not duplicate an item that several axes subscribe to", () => {
    const items = [item("shared", ["ax1", "ax2"]), item("b1", ["ax2"])];
    const { kept } = capPoolByAxis(items, 5);
    expect(kept.map((i) => i.url)).toEqual(["shared", "b1"]);
  });

  it("handles an item with no subscribing axis without starving the rest", () => {
    const items = [item("orphan", []), item("a1", ["ax1"])];
    const { kept } = capPoolByAxis(items, 2);
    expect(kept).toHaveLength(2);
  });

  it("returns nothing at a limit of zero rather than everything", () => {
    expect(capPoolByAxis([item("a", ["ax1"])], 0)).toEqual({ kept: [], dropped: 1 });
  });

  /** Deterministic, so an Inngest step replay produces the same pool. */
  it("is stable across input order", () => {
    const items = [item("a1", ["ax1"]), item("b1", ["ax2"]), item("c1", ["ax3"])];
    const first = capPoolByAxis(items, 2).kept.map((i) => i.url);
    const again = capPoolByAxis([...items].reverse(), 2).kept.map((i) => i.url);
    expect(first).toEqual(again);
  });
});
