import { describe, expect, it } from "vitest";
import { checkDraft, MAX_DRAFT_CHARS } from "@/lib/tech-radar/draft-guard";

describe("rhetorical opener", () => {
  it("allows a question mark in the opening sentence — Yuval's voice", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש על הונאות. זה נוגע ישר בביט.\nhttps://a.com/x")).toEqual([]);
  });
  it("still flags a question after the opener as an ask", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש. מה דעתך שנדבר?")).toContain("ask");
  });
  it("still flags a trailing question with no opener question", () => {
    expect(checkDraft("היי דנה, נתקלתי במחקר.\nשווה שנקבע שיחה?")).toContain("ask");
  });
  it("does not treat a URL query string as an ask", () => {
    expect(checkDraft("היי דנה, מחקר מעניין!\nhttps://a.com/x?utm=1&y=2")).toEqual([]);
  });
  it("does not treat a decimal point in a funding figure as a sentence end", () => {
    // The opener itself carries the figure; content follows so this is not the
    // bare single-question shape (see the "single-sentence ask" tests below) —
    // it isolates the decimal-boundary behaviour from the lone-question rule.
    expect(checkDraft("היי דנה, ראית שגייסו 3.5 מיליון דולר?\nמחקר מעניין.")).toEqual([]);
  });
  it("still flags a run-on with no space after the period hiding a later ask", () => {
    expect(checkDraft("היי דנה, ראית את המחקר.יש לך זמן לשיחה?")).toContain("ask");
  });
  it("flags a single-sentence meeting ask with no boundary before its '?'", () => {
    expect(checkDraft("היי דנה, יש לך זמן השבוע?")).toContain("ask");
  });
  it("flags a single-sentence 'let's meet' ask with no boundary before its '?'", () => {
    expect(checkDraft("היי דנה, נוכל להיפגש בשבוע הבא כדי לעבור על זה?")).toContain("ask");
  });
  it("flags a single-sentence ask even when a comma precedes it (a comma is not a boundary)", () => {
    expect(checkDraft("היי דנה, ראיתי מחקר מעניין, נוכל לדבר עליו?")).toContain("ask");
  });
  it("still flags a real trailing ask after a legitimate opener", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש. יש לך זמן?")).toContain("ask");
  });
  it("still returns [] for the legitimate opener-plus-content shape with no later ask", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש על הונאות. זה נוגע ישר בביט.")).toEqual([]);
  });
});

describe("meeting-ask phrases, caught by wording — not by position", () => {
  /**
   * The positional rule only fires when the tail after the opener's "?" is empty. Once
   * the model writes the 3-6 sentence body the prompt requires, the tail is never empty
   * again, so a meeting ask phrased in the opening sentence must be caught by wording.
   * "No meeting request, ever" is a hard rule, so it cannot depend on the message
   * happening to stop right after the question.
   */
  it("flags 'יש לך זמן' in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, יש לך זמן השבוע? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
  it("flags the 'יש לכם זמן' inflection in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, יש לכם זמן השבוע? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
  it("flags 'נוכל להיפגש' in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, נוכל להיפגש השבוע? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
  it("flags the 'נוכל לדבר' inflection in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, נוכל לדבר על זה? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
});

describe("length cap", () => {
  it("exports the cap as 600", () => {
    expect(MAX_DRAFT_CHARS).toBe(600);
  });
  it("flags a message over 600 chars (excluding the URL)", () => {
    const long = "מ".repeat(601) + "\nhttps://a.com/x";
    expect(checkDraft(long)).toContain("too_long");
  });
  it("does not count the URL toward the cap", () => {
    const ok = "מ".repeat(590) + "\nhttps://a.com/" + "x".repeat(200);
    expect(checkDraft(ok)).not.toContain("too_long");
  });
  it("does not flag exactly 600 chars — the boundary is inclusive", () => {
    const exact = "מ".repeat(600) + "\nhttps://a.com/x";
    expect(checkDraft(exact)).not.toContain("too_long");
  });
});

describe("unchanged hard rules", () => {
  it("still flags meeting asks, adoption suggestions, self-pitch, emoji", () => {
    expect(checkDraft("בוא נקבע שיחה קצרה")).toContain("ask");
    expect(checkDraft("כדאי לבדוק את הכלי")).toContain("adoption_suggestion");
    expect(checkDraft("החברה שלנו עושה בדיוק את זה")).toContain("self_pitch");
    expect(checkDraft("מחקר מטורף 🚀")).toContain("emoji");
  });
});
