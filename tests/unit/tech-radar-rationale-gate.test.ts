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
    agenda: false,
  },
  {
    label: "מודרניזציה של מערכות ליבה",
    key: "b",
    searchQueries: ["q"],
    rationale: "כי היא עובדת בבנקאות",
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
