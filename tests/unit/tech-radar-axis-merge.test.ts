import { describe, it, expect, vi, beforeEach } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { parseMergeAnswers, resolveMergeQuestions, MERGE_SYSTEM } = await import("@/lib/tech-radar/axis-merge");

const ok = (content: string) => ({ ok: true, status: 200, data: { choices: [{ message: { content } }] } });
const existing = [
  { id: "ax-live", label: "עיכוב בהעברת נתונים חי וגודל תפוקה" },
  { id: "ax-core", label: "ליבה בנקאית" },
];

beforeEach(() => chat.mockReset());

describe("MERGE_SYSTEM", () => {
  /** The three real axes from the failed build are the prompt's worked example. */
  it("carries the live-data case that lexical matching missed", () => {
    expect(MERGE_SYSTEM).toContain("עיבוד נתונים בזמן אמת בקנה מידה ענק");
    expect(MERGE_SYSTEM).toMatch(/THE SAME subject/);
  });

  it("says industry overlap is not sameness", () => {
    expect(MERGE_SYSTEM).toMatch(/does NOT make two subjects the same/);
    expect(MERGE_SYSTEM).toMatch(/would return different articles/);
  });

  /** A wrong merge destroys a distinction; a duplicate axis wastes a little budget. */
  it("prefers separating when uncertain, and says why", () => {
    expect(MERGE_SYSTEM).toMatch(/answer null/);
    expect(MERGE_SYSTEM).toMatch(/cannot be recovered/);
  });
});

describe("parseMergeAnswers", () => {
  const valid = new Set(["ax-live", "ax-core"]);

  it("reads a merge and a new subject", () => {
    const out = parseMergeAnswers('{"answers":[{"index":0,"sameAsId":"ax-live"},{"index":1,"sameAsId":null}]}', valid);
    expect(out.get(0)).toBe("ax-live");
    expect(out.get(1)).toBeNull();
  });

  /**
   * A hallucinated id would attach a person to an axis that does not exist, and the
   * failure would surface far from here. Dropped to null — a new axis, not a broken link.
   */
  it("drops an id the model invented", () => {
    expect(parseMergeAnswers('{"answers":[{"index":0,"sameAsId":"ax-imaginary"}]}', valid).get(0)).toBeNull();
  });

  it("ignores a repeated or malformed index", () => {
    const out = parseMergeAnswers(
      '{"answers":[{"index":0,"sameAsId":"ax-live"},{"index":0,"sameAsId":"ax-core"},{"index":"x","sameAsId":"ax-core"},{"index":-1,"sameAsId":"ax-core"}]}',
      valid
    );
    expect(out.get(0)).toBe("ax-live");
    expect(out.size).toBe(1);
  });

  it("returns nothing for unparseable output", () => {
    expect(parseMergeAnswers("sorry", valid).size).toBe(0);
  });
});

describe("resolveMergeQuestions", () => {
  it("asks once for the whole batch, not once per proposal", async () => {
    chat.mockResolvedValue(ok('{"answers":[{"index":0,"sameAsId":"ax-live"},{"index":1,"sameAsId":null}]}'));
    const out = await resolveMergeQuestions(existing, [
      { label: "עיכוב בהעברת נתונים חיים בספורט" },
      { label: "אנרגיה מתחדשת" },
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(out.get(0)).toBe("ax-live");
    expect(out.get(1)).toBeNull();
  });

  it("puts every existing id and every proposal in the one prompt", async () => {
    chat.mockResolvedValue(ok('{"answers":[]}'));
    await resolveMergeQuestions(existing, [{ label: "נושא חדש" }]);
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("id=ax-live");
    expect(body.messages[1].content).toContain("id=ax-core");
    expect(body.messages[1].content).toContain("0. נושא חדש");
  });

  /** A truncated answer loses the whole batch, so the budget scales with the batch. */
  it("scales its output budget with the batch size", async () => {
    chat.mockResolvedValue(ok('{"answers":[]}'));
    await resolveMergeQuestions(existing, Array.from({ length: 5 }, (_, i) => ({ label: `נושא ${i}` })));
    expect((chat.mock.calls[0][1] as { max_tokens: number }).max_tokens).toBeGreaterThanOrEqual(300 + 5 * 60);
  });

  /**
   * The safe direction. A duplicate axis wastes some search budget; a wrong merge folds
   * two subjects together and loses the rationale that justified it.
   */
  it("answers nothing when the call fails, so every proposal becomes a new axis", async () => {
    chat.mockResolvedValue({ ok: false, status: 500, data: {} });
    expect((await resolveMergeQuestions(existing, [{ label: "x" }])).size).toBe(0);
  });

  it("does not call at all with nothing to compare against", async () => {
    expect((await resolveMergeQuestions([], [{ label: "x" }])).size).toBe(0);
    expect((await resolveMergeQuestions(existing, [])).size).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it("is tagged for cost attribution", async () => {
    chat.mockResolvedValue(ok('{"answers":[]}'));
    await resolveMergeQuestions(existing, [{ label: "x" }]);
    expect(chat.mock.calls[0][0]).toBe("tech-radar-axis-merge");
  });
});
