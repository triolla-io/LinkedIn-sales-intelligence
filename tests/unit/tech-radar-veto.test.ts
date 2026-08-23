import { describe, it, expect, vi, beforeEach } from "vitest";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { parseVetoResponse, judgeWhyHim, selectRecipientsForItem, VETO_SYSTEM } = await import(
  "@/lib/tech-radar/veto"
);

function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}
const item = { technology: "DynamoDB Vector Search", title: "AWS adds vector search", kind: "vendor_launch" };
function candidate(id: string, company = "tc-365", axisRationale = "מנוע ההמלצות שהוא בנה") {
  return {
    contact: { contactId: id, fullName: `Person ${id}`, currentTitle: "COO" },
    company: { trackedCompanyId: company, name: "365Scores" },
    axisRationale,
  };
}

beforeEach(() => chat.mockReset());

describe("VETO_SYSTEM", () => {
  it("makes rejection the default", () => {
    expect(VETO_SYSTEM).toMatch(/default is REJECT/i);
    expect(VETO_SYSTEM).toMatch(/If you are unsure, reject/i);
  });

  /** The exact failure the 2026-08-20 run produced, named in the prompt. */
  it("names the company-level and role-level restatements as rejections", () => {
    expect(VETO_SYSTEM).toMatch(/restatement of their role/);
    expect(VETO_SYSTEM).toMatch(/restatement of their employer/);
    expect(VETO_SYSTEM).toMatch(/true of the company but not of the person/);
  });

  it("requires a reason recorded on rejection too", () => {
    expect(VETO_SYSTEM).toMatch(/recorded either way/i);
  });

  it("forbids using the adjustment to smuggle a rejection through", () => {
    expect(VETO_SYSTEM).toMatch(/Never use it to smuggle/i);
  });
});

describe("parseVetoResponse", () => {
  it("reads a pass", () => {
    expect(parseVetoResponse('{"specific":true,"whyHim":"הוא בנה את מנוע ההמלצות","adjustment":0.1}')).toEqual({
      specific: true,
      whyHim: "הוא בנה את מנוע ההמלצות",
      adjustment: 0.1,
    });
  });

  /**
   * A schema failure must never become a send. "true", 1 and "yes" are all a model not
   * following instructions, and the safe reading of "I could not parse the gate's
   * answer" is that the gate did not open.
   */
  it("treats anything but the literal boolean true as a rejection", () => {
    for (const raw of ['"true"', "1", '"yes"', "null"]) {
      const v = parseVetoResponse(`{"specific":${raw},"whyHim":"x"}`);
      expect(v.specific, `input ${raw}`).toBe(false);
    }
  });

  it("rejects a pass that carries no reason", () => {
    expect(parseVetoResponse('{"specific":true,"whyHim":"   "}').specific).toBe(false);
    expect(parseVetoResponse('{"specific":true}').specific).toBe(false);
  });

  it("rejects unparseable output and still gives a readable reason", () => {
    const v = parseVetoResponse("sorry, I cannot");
    expect(v.specific).toBe(false);
    expect(v.whyHim).toMatch(/נדחה/);
  });

  it("clamps the adjustment to the stated range", () => {
    expect(parseVetoResponse('{"specific":true,"whyHim":"x","adjustment":5}').adjustment).toBe(0.2);
    expect(parseVetoResponse('{"specific":true,"whyHim":"x","adjustment":-5}').adjustment).toBe(-0.2);
    expect(parseVetoResponse('{"specific":true,"whyHim":"x","adjustment":"big"}').adjustment).toBe(0);
  });
});

describe("judgeWhyHim", () => {
  it("sends the person's own context, not only the company's", async () => {
    chat.mockResolvedValue(ok('{"specific":true,"whyHim":"ok","adjustment":0}'));
    await judgeWhyHim({
      contact: { contactId: "c1", fullName: "Ori", currentTitle: "COO", roleLens: "אחראי על התוכן", personalNotes: "עבר לתפקיד לפני חודש" },
      company: { trackedCompanyId: "tc1", name: "365Scores" },
      item,
      axisRationale: "מנוע ההמלצות",
      axisLabel: "חיפוש וקטורי",
    });
    const body = chat.mock.calls[0][1] as { messages: { content: string }[]; model: string };
    expect(body.messages[1].content).toContain("אחראי על התוכן");
    expect(body.messages[1].content).toContain("עבר לתפקיד לפני חודש");
    expect(body.messages[1].content).toContain("חיפוש וקטורי");
  });

  /** A lenient veto launders a bad match, so this stage does not run on the cheap model. */
  it("runs on Opus, not Haiku", async () => {
    chat.mockResolvedValue(ok('{"specific":true,"whyHim":"ok"}'));
    await judgeWhyHim({ ...candidate("c1"), item });
    expect((chat.mock.calls[0][1] as { model: string }).model).toMatch(/opus/i);
  });

  it("is tagged for cost attribution on its own line", async () => {
    chat.mockResolvedValue(ok('{"specific":true,"whyHim":"ok"}'));
    await judgeWhyHim({ ...candidate("c1"), item });
    expect(chat.mock.calls[0][0]).toBe("tech-radar-veto");
  });

  /** An unreachable model must stop this candidate, not the run — and never pass it. */
  it("rejects rather than throwing when the call fails", async () => {
    chat.mockResolvedValue({ ok: false, status: 502, data: {} });
    const v = await judgeWhyHim({ ...candidate("c1"), item });
    expect(v.specific).toBe(false);
    expect(v.whyHim).toMatch(/502/);
  });
});

/**
 * The mailing-list scenario from production: one item, one company, three founders.
 */
describe("selectRecipientsForItem", () => {
  const founders = [candidate("ami"), candidate("ori"), candidate("roy")];

  it("sends to at most one person per company", async () => {
    chat.mockResolvedValue(ok('{"specific":true,"whyHim":"ok","adjustment":0}'));
    const chosen = await selectRecipientsForItem({ item, candidates: founders });
    expect(chosen).toHaveLength(1);
    expect(chosen[0].candidate.contact.contactId).toBe("ami");
  });

  /**
   * The load-bearing rule. Walking down the list until somebody passes would turn the
   * gate into a formality — so one rejection means silence for that company today.
   */
  it("does not promote a colleague after vetoing the first candidate", async () => {
    chat.mockResolvedValue(ok('{"specific":false,"whyHim":"נימוק ברמת החברה","adjustment":0}'));
    const chosen = await selectRecipientsForItem({ item, candidates: founders });
    expect(chosen).toHaveLength(0);
    // One call, not three: the other two were never even judged.
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("still reaches a second company after the first is vetoed", async () => {
    chat
      .mockResolvedValueOnce(ok('{"specific":false,"whyHim":"לא ספציפי"}'))
      .mockResolvedValueOnce(ok('{"specific":true,"whyHim":"כן ספציפי","adjustment":0}'));
    const chosen = await selectRecipientsForItem({
      item,
      candidates: [candidate("ami"), candidate("avigal", "tc-delek")],
    });
    expect(chosen).toHaveLength(1);
    expect(chosen[0].candidate.contact.contactId).toBe("avigal");
  });

  it("judges nobody when there are no candidates", async () => {
    expect(await selectRecipientsForItem({ item, candidates: [] })).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });
});
