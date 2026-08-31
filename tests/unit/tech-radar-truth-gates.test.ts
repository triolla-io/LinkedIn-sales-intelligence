/**
 * The three truth gates, each one a bug read out of the prod DB on 2026-08-31.
 *
 * They share a shape: the brain wrote something that LOOKS like evidence — a date, a
 * second decision, a bank's name — and nothing downstream could tell it apart from the
 * real thing. A fabricated date is worse than a missing one, because layers.ts believes
 * it; a cloned decision is worse than a missing axis, because it fills the screen; an
 * invented rival is worse than silence, because it goes out in a message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: vi.fn() }));

const { openrouterChat } = await import("@/lib/openrouter/client");
const { gateRationales } = await import("@/lib/tech-radar/rationale-gate");
const { dateIsoNotInMoves, duplicateDecisionIndexes, invalidEntityTags } = await import(
  "@/lib/tech-radar/rationale-rules"
);

const chat = vi.mocked(openrouterChat);

function ok(content: string) {
  return { ok: true as const, status: 200, data: { choices: [{ message: { content } }] } };
}

beforeEach(() => chat.mockReset());

describe("dateIsoNotInMoves — the 2024-01-01 killer", () => {
  const moves = [{ dateIso: "2026-07-14" }, { dateIso: "2026-08-02" }];
  it("rejects a dateIso that matches no research move verbatim", () => {
    expect(dateIsoNotInMoves("2024-01-01", moves)).toBe(true);
  });
  it("accepts a dateIso copied from a move", () => {
    expect(dateIsoNotInMoves("2026-07-14", moves)).toBe(false);
  });
  it("undefined dateIso is not this rule's business (layer3_undated owns it)", () => {
    expect(dateIsoNotInMoves(undefined, moves)).toBe(false);
  });
});

describe("duplicateDecisionIndexes — one signature, one axis", () => {
  it("flags near-identical personDecisions (Pazit's five clones)", () => {
    const idx = duplicateDecisionIndexes([
      "חתומה על הצעת השירותים הקמעונאיים ועל תקציב הפיתוח שלהם",
      "חתומה על הצעת השירותים הקמעונאיים ועל תקציב הפיתוח של ערוצים דיגיטליים",
      "חתומה על מדיניות האשראי הצרכני ותיאבון הסיכון",
    ]);
    expect(idx).toEqual([1]);
  });
  it("distinct decisions pass untouched", () => {
    expect(duplicateDecisionIndexes(["חתום על ארכיטקטורת הליבה", "מחזיק את תקציב הסייבר"])).toEqual([]);
  });
});

describe("invalidEntityTags — no invented names", () => {
  const gaz = ["One Zero", "וואן זירו", "Bank Leumi", "לאומי"];
  const employer = { names: ["Bank Hapoalim", "בנק הפועלים"], products: ["Poalim Wonder"] };
  it("drops a competitor tag whose name is not in the gazetteer (the FIBI case)", () => {
    const dropped = invalidEntityTags(
      [{ name: "בנק בינלאומי ראשון", aliases: [], kind: "competitor" }],
      gaz,
      employer
    );
    expect(dropped).toEqual(["בנק בינלאומי ראשון"]);
  });
  it("keeps a gazetteer competitor and an employer product", () => {
    const dropped = invalidEntityTags(
      [
        { name: "One Zero", aliases: ["וואן זירו"], kind: "competitor" },
        { name: "Poalim Wonder", aliases: [], kind: "product" },
      ],
      gaz,
      employer
    );
    expect(dropped).toEqual([]);
  });
  it("accepts a gazetteer entry that still carries both scripts in one string", () => {
    // Real callers hand this the employer research's raw `namedCompetitors`, where one
    // entry is "Bank Leumi / לאומי". A tag naming only "לאומי" is the same company.
    const dropped = invalidEntityTags(
      [{ name: "לאומי", aliases: [], kind: "competitor" }],
      ["Bank Leumi / לאומי"],
      employer
    );
    expect(dropped).toEqual([]);
  });
  it("drops a product tag that is nobody's product here", () => {
    const dropped = invalidEntityTags(
      [{ name: "Leumi Digital", aliases: [], kind: "product" }],
      gaz,
      employer
    );
    expect(dropped).toEqual(["Leumi Digital"]);
  });
  it("leaves a regulator alone — there is no closed list to check it against", () => {
    const dropped = invalidEntityTags(
      [{ name: "בנק ישראל", aliases: [], kind: "regulator" }],
      gaz,
      employer
    );
    expect(dropped).toEqual([]);
  });
});

// ─── The gate wiring ─────────────────────────────────────────────────────────

const base = {
  label: "מוצרי מתחרים בריטייל",
  key: "a",
  searchQueries: ["q"],
  rationale: "היא מחזיקה את החלטת ההיצע הקמעונאי, והלקוחות הפרטיים שלה הם בדיוק מי שנוטש",
  personDecision: "חתומה על הצעת השירותים הקמעונאיים ועל תקציב הפיתוח שלהם",
  companyFact: "לקוחות קמעונאיים שחוסכים",
  stage: "decision" as const,
  agenda: false,
};
const layer3 = (dateIso: string | undefined) => ({
  ...base,
  layerEvidence: { layer: 3 as const, quote: "מיזוג הזרוע הדיגיטלית הוכרז החודש", dateIso },
});
const moves = [{ dateIso: "2026-07-14" }, { dateIso: "2026-08-02" }];

describe("gateRationales layer3_fabricated_date", () => {
  it("rejects a layer-3 date the employer research never reported, before the LLM call", async () => {
    const out = await gateRationales("lens", [layer3("2024-01-01")], { recentMoves: moves });
    expect(out.rejected.map((r) => r.reason)).toEqual(["layer3_fabricated_date"]);
    expect(out.deterministic.layer3_fabricated_date).toBe(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("passes a layer-3 date copied verbatim from a research move", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    const out = await gateRationales("lens", [layer3("2026-08-02")], { recentMoves: moves });
    expect(out.rejected).toEqual([]);
    expect(out.kept).toHaveLength(1);
  });

  it("keeps layer3_undated ahead of it — a missing date is reported as missing", async () => {
    const out = await gateRationales("lens", [layer3(undefined)], { recentMoves: moves });
    expect(out.rejected.map((r) => r.reason)).toEqual(["layer3_undated"]);
    expect(out.deterministic.layer3_fabricated_date).toBeUndefined();
  });

  it("does not fire when the caller supplied no moves to check against", async () => {
    // Fail-open, exactly like the unknown_competitor rule behind `gazetteer.length > 0`:
    // with no research moves in hand the gate cannot tell a fabricated date from a real
    // one, and rejecting every dated layer-3 axis would be worse than not asking.
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    const out = await gateRationales("lens", [layer3("2026-08-01")], {});
    expect(out.rejected).toEqual([]);
    expect(out.kept).toHaveLength(1);
  });

  it("ignores layer-2 evidence — the rule is layer-3 only", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    const out = await gateRationales("lens", [
      { ...base, layerEvidence: { layer: 2 as const, quote: "q", dateIso: "2024-01-01" } },
    ], { recentMoves: moves });
    expect(out.rejected).toEqual([]);
  });
});

describe("gateRationales duplicate_person_decision", () => {
  it("keeps the first of a cloned pair and rejects the later one", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    const out = await gateRationales("lens", [
      base,
      { ...base, key: "b", label: "ערוצים דיגיטליים", personDecision: `${base.personDecision} של ערוצים דיגיטליים` },
    ]);
    expect(out.kept.map((a) => a.key)).toEqual(["a"]);
    expect(out.rejected).toEqual([
      { label: "ערוצים דיגיטליים", rationale: base.rationale, reason: "duplicate_person_decision" },
    ]);
    expect(out.deterministic.duplicate_person_decision).toBe(1);
  });

  it("leaves genuinely different decisions alone", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false},{"i":1,"generic":false}]}'));
    const out = await gateRationales("lens", [
      base,
      { ...base, key: "b", personDecision: "מחזיקה את תקציב הסייבר" },
    ]);
    expect(out.kept).toHaveLength(2);
    expect(out.deterministic.duplicate_person_decision).toBeUndefined();
  });

  it("counts a duplicate ONCE — it runs over the survivors, after the other rules", async () => {
    // The middle axis dies on no_person_side, so it is not also available to be counted
    // as the clone of the first; the third one is the clone.
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    const out = await gateRationales("lens", [
      base,
      { ...base, key: "b", personDecision: "ראש בנקאות קמעונאית" },
      { ...base, key: "c", personDecision: `${base.personDecision} של ערוצים דיגיטליים` },
    ]);
    expect(out.kept.map((a) => a.key)).toEqual(["a"]);
    expect(out.deterministic).toEqual({ no_person_side: 1, duplicate_person_decision: 1 });
  });

  it("does not call the judge when dedup empties the batch", async () => {
    const out = await gateRationales("lens", [
      { ...base, personDecision: "ראש בנקאות קמעונאית" },
      { ...base, key: "b", personDecision: "ראש בנקאות קמעונאית" },
    ]);
    expect(out.kept).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });
});
