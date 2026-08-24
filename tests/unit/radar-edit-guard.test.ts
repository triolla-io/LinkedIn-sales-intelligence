import { describe, it, expect } from "vitest";
import { checkDraftEdit } from "@/lib/tech-radar/draft-guard";

/**
 * The edit gate has two tiers by design (24.8 review): HARD violations block the save —
 * a link that is not the article's own address, a figure the source never said. SOFT
 * violations only warn — the message is the user's, and a blocked edit teaches them to
 * abandon the screen, not to write better.
 */

const CANON = "https://ethanolproducer.com/articles/epa-rvo-2026";

describe("checkDraftEdit", () => {
  it("hard-flags any URL that is not the canonical one", () => {
    const r = checkDraftEdit(`היי, ראה כאן https://bit.ly/x וגם ${CANON}`, { canonicalUrl: CANON, sourceText: "" });
    expect(r.hard).toContain("foreign_link");
  });

  it("accepts a message whose only URL is the canonical one", () => {
    const r = checkDraftEdit(`נתקלתי בזה ${CANON}`, { canonicalUrl: CANON, sourceText: "" });
    expect(r.hard).toEqual([]);
  });

  it("hard-flags a figure that does not appear in the source text", () => {
    const r = checkDraftEdit("היעד קפץ ל-97 מיליארד גלון", { canonicalUrl: null, sourceText: "EPA set targets of 24.02 billion gallons" });
    expect(r.hard).toContain("unsourced_figure");
  });

  it("lets a sourced figure through", () => {
    const r = checkDraftEdit("היעד: 24.02 מיליארד גלון", { canonicalUrl: null, sourceText: "EPA set targets of 24.02 billion gallons" });
    expect(r.hard).toEqual([]);
  });

  it("ignores digits that belong to the canonical URL", () => {
    const r = checkDraftEdit(`שווה קריאה ${CANON}`, { canonicalUrl: CANON, sourceText: "no numbers here" });
    expect(r.hard).toEqual([]);
  });

  it("returns salesy phrasing as soft, not hard", () => {
    const r = checkDraftEdit("אולי תוכלו לשלב את זה אצלכם", { canonicalUrl: null, sourceText: "" });
    expect(r.hard).toEqual([]);
    expect(r.soft).toContain("adoption_suggestion");
  });

  it("a message with no URL at all is not a foreign-link violation", () => {
    const r = checkDraftEdit("נתקלתי במשהו שחשבתי עליך", { canonicalUrl: CANON, sourceText: "" });
    expect(r.hard).toEqual([]);
  });
});
