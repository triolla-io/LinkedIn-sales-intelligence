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
    expect(checkDraft("היי דנה, ראית שגייסו 3.5 מיליון דולר?")).toEqual([]);
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
