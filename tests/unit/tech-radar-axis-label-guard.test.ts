import { describe, it, expect } from "vitest";

import { checkAxisLabel } from "@/lib/tech-radar/draft-guard";

/**
 * An axis label is COPY. "אבטחה סייבר וגנת מפני איומים מתוחכמים" was written by the
 * axis-merge model on 2026-08-26 and is shown to ariel and yuval on the people and
 * decisions screens.
 *
 * Scope, stated honestly: these are the same MECHANICAL checks the draft guard applies —
 * script, pictographs, structure. They do NOT catch the misspelling in the example above
 * ("וגנת" for "והגנה"); no regex does. That one needs the axis-merge prompt to proofread
 * its own output, which is a prompt change, not a guard.
 *
 * The draft rules about asks and self-pitch are deliberately NOT applied: they judge the
 * semantics of a message and mean nothing for a topic label.
 */
describe("checkAxisLabel", () => {
  it("accepts a clean Hebrew label", () => {
    expect(checkAxisLabel("מודרניזציה של מערכות הליבה בבנקינג")).toEqual([]);
  });

  it("accepts a label that legitimately carries a Latin product name", () => {
    // Correct Hebrew typography separates the scripts with a hyphen or a space.
    expect(checkAxisLabel("אדריכלות API פתוחה")).toEqual([]);
  });

  it("rejects Hebrew glued to Latin", () => {
    expect(checkAxisLabel("אבטחתAPI בשירותים פיננסיים")).toContain("glued_script");
  });

  it("rejects a pictograph", () => {
    expect(checkAxisLabel("תשלומים בזמן אמת 🚀")).toContain("emoji");
  });

  it("rejects an empty label", () => {
    expect(checkAxisLabel("   ")).toContain("empty");
  });

  it("rejects a doubled internal space", () => {
    // "Phoenix Holdings  קבוצת הפניקס" arrived from LinkedIn with exactly this and became
    // both a company name and an axis label.
    expect(checkAxisLabel("תשתיות ענן  וגמישות חישובית")).toContain("double_space");
  });

  it("rejects a label that is really a sentence", () => {
    const sentence = "זהו ציר שעוסק בכל מה שקשור לתשלומים בזמן אמת ובהסדרים חוצי גבולות וגם ברגולציה של בנק ישראל ובתחרות מול חברות פינטק";
    expect(checkAxisLabel(sentence)).toContain("too_long");
  });

  it("rejects trailing punctuation", () => {
    expect(checkAxisLabel("זיהוי הונאות ותאימות AML בסקאלה.")).toContain("stray_punctuation");
  });

  it("does not apply the message-semantics rules to a label", () => {
    // "ממליץ ל" trips adoption_suggestion in a DRAFT. As a label fragment it is merely
    // odd wording, and rejecting axes for it would silently drop real interests.
    expect(checkAxisLabel("ממליץ לבדוק תשתיות ענן")).toEqual([]);
  });
});
