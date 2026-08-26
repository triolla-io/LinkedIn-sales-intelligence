import { describe, expect, it } from "vitest";
import { checkDraft, MAX_DRAFT_CHARS, SOFT_DRAFT_CHARS } from "@/lib/tech-radar/draft-guard";

/**
 * Yuval's real voice opens with a rhetorical question — "היי, ראית את זה?" — and the
 * `ask` rule banned a bare "?" anywhere, so the guard would have killed every draft
 * written in his own register.
 *
 * The no-CTA guarantee lives on the TAIL, not the opener: a question after the first
 * sentence is still an ask.
 */
describe("rhetorical opener", () => {
  it("allows a question mark in the opening sentence — Yuval's voice", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש על הונאות. זה נוגע ישר בביט.\nhttps://a.com/x")).toEqual([]);
  });

  it("allows the opener question when the greeting sits on its own line", () => {
    // The 4-part structure the prompt asks for puts the greeting and the hook together,
    // but a model that breaks the line must not lose the draft to a positional rule.
    expect(checkDraft("היי דנה,\nראית את זה?\nמחקר חדש על הונאות.")).toEqual([]);
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
});

/**
 * Two tiers, and the split is the whole point. A content paragraph plus an opener plus
 * "why him" lands near 600, so 600 can only ADVISE — blocking there would reject good
 * drafts over two characters in the one run meant to produce volume. 900 is where a
 * message has stopped being a message.
 */
describe("length tiers", () => {
  it("advises at 600 and blocks at 900", () => {
    expect(SOFT_DRAFT_CHARS).toBe(600);
    expect(MAX_DRAFT_CHARS).toBe(900);
  });

  it("a 700-char message is advised, not blocked", () => {
    const v = checkDraft("מ".repeat(700) + "\nhttps://a.com/x");
    expect(v).toContain("long");
    expect(v).not.toContain("too_long");
  });

  it("flags a message over 900 chars as too_long", () => {
    expect(checkDraft("מ".repeat(901) + "\nhttps://a.com/x")).toContain("too_long");
  });

  it("does not count the URL toward either tier", () => {
    // A tracking-heavy link must not push a legitimate message over a limit.
    const ok = "מ".repeat(590) + "\nhttps://a.com/" + "x".repeat(400);
    expect(checkDraft(ok)).toEqual([]);
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
