import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: vi.fn() }));

const { openrouterChat } = await import("@/lib/openrouter/client");
const { gateRationales, parseRationaleVerdicts, RATIONALE_GATE_SYSTEM } = await import(
  "@/lib/tech-radar/rationale-gate"
);

const chat = vi.mocked(openrouterChat);

function ok(content: string) {
  return { ok: true as const, status: 200, data: { choices: [{ message: { content } }] } };
}

const proposals = [
  {
    label: "מוצרי מתחרים בריטייל",
    key: "a",
    searchQueries: ["q"],
    rationale: "כי לאומי מתחרה ישירות על לקוחות הריטייל שהיא מנהלת",
    personDecision: "מחזיקה את החלטת ההיצע הקמעונאי",
    companyFact: "לאומי מתחרה על אותם לקוחות פרטיים",
    stage: "competitor" as const,
    agenda: false,
  },
  {
    label: "מודרניזציה של מערכות ליבה",
    key: "b",
    searchQueries: ["q"],
    rationale: "כי היא עובדת בבנקאות",
    personDecision: "חתומה על תמהיל המוצרים",
    companyFact: "לקוחות קמעונאיים שחוסכים",
    stage: "decision" as const,
    agenda: true,
  },
];

beforeEach(() => chat.mockReset());

/**
 * The veto's bar — "not person-specific" — moved to the profile stage. "כי הוא בבנקאות"
 * is a domain description and dies at build; "כי הוא מחזיק את החלטת X" points at a
 * staged answer and lives. One batch call per person, not one per axis.
 */
describe("parseRationaleVerdicts", () => {
  it("reads a generic verdict per index", () => {
    const v = parseRationaleVerdicts('{"verdicts":[{"i":0,"generic":false},{"i":1,"generic":true}]}', 2);
    expect(v).toEqual([false, true]);
  });

  it("treats a missing verdict as NOT generic — a judge that forgot an axis must not silently kill it", () => {
    const v = parseRationaleVerdicts('{"verdicts":[{"i":1,"generic":true}]}', 2);
    expect(v).toEqual([false, true]);
  });
});

describe("gateRationales", () => {
  it("drops the domain-description axis and keeps the pointed one", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false},{"i":1,"generic":true}]}'));
    const out = await gateRationales("מחזיקה את היצע הריטייל", proposals);
    expect(out.kept.map((a) => a.key)).toEqual(["a"]);
    expect(out.rejected.map((r) => r.label)).toEqual(["מודרניזציה של מערכות ליבה"]);
  });

  it("re-promotes an agenda axis when the gated one carried the agenda flag", async () => {
    // The parser guarantees exactly one agenda axis; the gate must not break that
    // invariant on its way out, or the person is left with role axes only.
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false},{"i":1,"generic":true}]}'));
    const out = await gateRationales("lens", proposals);
    expect(out.kept.some((a) => a.agenda)).toBe(true);
  });

  it("fails open when the judge call fails — a dead judge must not brick onboarding", async () => {
    chat.mockResolvedValue({ ok: false as const, status: 500, detail: "boom" });
    const out = await gateRationales("lens", proposals);
    expect(out.kept).toHaveLength(2);
    expect(out.judged).toBe(false);
  });

  it("makes one call for the whole batch", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false},{"i":1,"generic":false}]}'));
    await gateRationales("lens", proposals);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe("RATIONALE_GATE_SYSTEM", () => {
  it("names the bar in both directions", () => {
    expect(RATIONALE_GATE_SYSTEM).toMatch(/כי הוא בבנקאות/);
    expect(RATIONALE_GATE_SYSTEM).toMatch(/decision|מחזיק/i);
  });
});

/**
 * The two swap tests, which is what the judge was missing.
 *
 * Its ONE test was the company swap ("could this sentence be written about a different
 * person with the same title at another company?"). A stage-(ד) rationale — "what is done
 * well somewhere else that this person could adopt" — names the person's decision and an
 * external exemplar and no fact about their own employer, so it PASSES the company swap
 * and was correctly killed by a justly-applied but incomplete test. Both of Pazit
 * Garfinkel's adoption axes died that way, and stage (ד) produced zero axes for all four
 * people in the 2026-08-26 run.
 */
describe("gateRationales declared sides", () => {
  const withSides = (over: Partial<(typeof proposals)[number]>) => ({ ...proposals[0], ...over });

  it("rejects an axis whose person side is only the job title", async () => {
    const out = await gateRationales("lens", [withSides({ personDecision: "ראש בנקאות קמעונאית" })]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["no_person_side"]);
    expect(out.deterministic.no_person_side).toBe(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("rejects an axis that declares no company side at all", async () => {
    const out = await gateRationales("lens", [withSides({ companyFact: "" })], {
      namedCompetitors: ["Bank Leumi / לאומי"],
    });
    expect(out.rejected.map((r) => r.reason)).toEqual(["no_company_side"]);
    expect(out.deterministic.no_company_side).toBe(1);
  });

  it("rejects a company side that names a technology instead of the company", async () => {
    // "ארכיטקטורת API פתוחה" is the exact shape of the axes a CITO was handed: it names
    // no customer and no rival, so nothing was crossed.
    const out = await gateRationales("lens", [withSides({ companyFact: "ארכיטקטורת API פתוחה" })], {
      namedCompetitors: ["Bank Leumi / לאומי"],
    });
    expect(out.rejected.map((r) => r.reason)).toEqual(["no_company_side"]);
  });

  it("accepts a company side that quotes the employer's researched segment", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    const out = await gateRationales("lens", [withSides({ companyFact: "B2C: Individual consumers" })], {
      namedCompetitors: ["Bank Leumi / לאומי"],
      customerSegments: ["B2C: Individual consumers and retail customers"],
    });
    expect(out.kept).toHaveLength(1);
  });

  it("flags a hallucinated rival that appears only in the companyFact", async () => {
    // The rationale used to be the only field scanned for invented names. The company
    // side is now where names live, so it is scanned too — an invented rival in a
    // message to a board member cannot be taken back.
    const out = await gateRationales("lens", [withSides({ companyFact: "Revolut נכנסת לשוק שלה" })], {
      namedCompetitors: ["Bank Leumi / לאומי"],
    });
    expect(out.rejected[0].reason).toContain("unknown_competitor:Revolut");
  });

  it("shows the judge both declared sides, so it can run the swaps at all", async () => {
    chat.mockResolvedValue(ok('{"verdicts":[{"i":0,"generic":false}]}'));
    await gateRationales("lens", [proposals[0]]);
    const user = chat.mock.calls[0][1].messages[1].content as string;
    expect(user).toContain("מחזיקה את החלטת ההיצע הקמעונאי");
    expect(user).toContain("לאומי מתחרה על אותם לקוחות פרטיים");
  });
});

describe("RATIONALE_GATE_SYSTEM swap tests", () => {
  it("carries BOTH swaps, not only the company swap", () => {
    expect(RATIONALE_GATE_SYSTEM).toMatch(/SWAP THE PERSON/);
    expect(RATIONALE_GATE_SYSTEM).toMatch(/SWAP THE COMPANY/);
  });

  it("calls an axis generic only when it survives BOTH swaps", () => {
    expect(RATIONALE_GATE_SYSTEM).toMatch(/survives BOTH/);
  });

  it("tells the judge that an adoption rationale surviving one swap is not generic", () => {
    expect(RATIONALE_GATE_SYSTEM).toMatch(/adopt/i);
  });
});
