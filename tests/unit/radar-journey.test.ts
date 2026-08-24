import { describe, it, expect } from "vitest";
import { deriveJourney } from "@/lib/tech-radar/journey";

/**
 * The mapper is the ONLY place stored fields become screen words, which makes it the
 * only place the "zero jargon" rule has to be enforced — hence the dictionary test at
 * the bottom. If a future step leaks "stature" or "veto" into a value, it fails here
 * rather than in front of a user.
 */

const FORBIDDEN = ["וטו", "stature", "shareworthy", "fit", "טריאז"];

const goodItem = { thin: false, shareworthy: 0.9, stature: 0.8, kind: "big_news" };
const goodMatch = { score: 0.8, rationale: "EPA ↔ יעדי התפוקה שהציג" };

const step = (j: ReturnType<typeof deriveJourney>, key: string) =>
  j.steps.find((s) => s.key === key)!;

describe("deriveJourney", () => {
  it("a full pass ends in a draft, all five steps green", () => {
    const j = deriveJourney({
      item: goodItem,
      match: goodMatch,
      draft: { status: "PENDING_REVIEW", whyHim: "זו החלטה שלו", discardReason: null },
    });
    expect(j.steps.map((s) => s.state)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(j.verdict.tone).toBe("good");
    expect(j.overridable).toBe(false);
  });

  it("a snippet-only item stops at 'read' and everything after is blank", () => {
    const j = deriveJourney({ item: { ...goodItem, thin: true }, match: goodMatch, draft: null });
    expect(step(j, "read").state).toBe("fail");
    expect(j.steps.slice(1).every((s) => s.state === "empty")).toBe(true);
    expect(j.verdict.tone).toBe("bad");
  });

  it("an on-topic but weightless item stops at importance", () => {
    const j = deriveJourney({
      item: { ...goodItem, stature: 0.2 },
      match: goodMatch,
      draft: null,
    });
    expect(step(j, "read").state).toBe("pass");
    expect(step(j, "importance").state).toBe("fail");
    expect(step(j, "connection").state).toBe("empty");
  });

  it("no axis connection stops at the connection step", () => {
    const j = deriveJourney({ item: goodItem, match: null, draft: null });
    expect(step(j, "importance").state).toBe("pass");
    expect(step(j, "connection").state).toBe("fail");
    expect(step(j, "personal").state).toBe("empty");
  });

  it("a weak connection is a stop, not a pass", () => {
    const j = deriveJourney({
      item: goodItem,
      match: { score: 0.2, rationale: "תחום הזיקוק — כללי" },
      draft: null,
    });
    expect(step(j, "connection").state).toBe("fail");
  });

  it("a personal-gate rejection is the one an override can lift", () => {
    const j = deriveJourney({
      item: goodItem,
      match: goodMatch,
      draft: { status: "VETOED", whyHim: null, discardReason: "תחזית מאקרו שנכונה לכל מנהל בענף" },
    });
    expect(step(j, "personal").state).toBe("fail");
    expect(step(j, "draft").state).toBe("empty");
    expect(j.overridable).toBe(true);
    expect(j.verdict.text).toContain("מאקרו");
  });

  it("an item that connected but produced no draft is not reported as sent", () => {
    const j = deriveJourney({ item: goodItem, match: goodMatch, draft: null });
    expect(step(j, "connection").state).toBe("pass");
    expect(step(j, "draft").state).not.toBe("pass");
    expect(j.overridable).toBe(false);
  });

  it("never leaks internal vocabulary into anything rendered", () => {
    const cases = [
      { item: goodItem, match: goodMatch, draft: { status: "PENDING_REVIEW", whyHim: "x", discardReason: null } },
      { item: { ...goodItem, thin: true }, match: null, draft: null },
      { item: { ...goodItem, stature: 0.1 }, match: goodMatch, draft: null },
      { item: goodItem, match: { score: 0.1, rationale: "כללי" }, draft: null },
      { item: goodItem, match: goodMatch, draft: { status: "VETOED", whyHim: null, discardReason: "לא אישי" } },
    ];
    for (const c of cases) {
      const rendered = JSON.stringify(deriveJourney(c));
      for (const word of FORBIDDEN) {
        expect(rendered).not.toContain(word);
      }
    }
  });
});
