import { describe, it, expect } from "vitest";

import {
  parseProfileResponse,
  personPromptInput,
  PROFILE_SYSTEM,
} from "@/lib/tech-radar/person-profile";

/**
 * The 2026-08-26 systematic failure: every axis was built through a CTO lens — "core
 * banking modernization" was minted for a VP Product, a Head of Retail, an innovation
 * deputy-CEO and a CITO alike, and is right only for the CITO.
 *
 * The fix is NOT a lens enum and NOT axis templates per role. The prompt gets the full
 * commercial picture and must think in stages before deriving axes:
 *   (a) which decisions does this person actually hold — what do they sign
 *   (b) who is trying to eat their customers; what would stress them tomorrow morning
 *   (c) what would they stop everything to read and forward to a colleague
 * Only then 3-5 axes, each rationale pointing at one of those answers. The reasoning is
 * SAVED so we can see how the brain reached the axes.
 */
const validAxes = [
  {
    label: "מוצרי מתחרים בריטייל הבנקאי",
    agenda: false,
    searchQueries: ["לאומי דיגיטל השקה", "retail banking product launch Israel"],
    rationale: "כי לאומי והדיסקונט מתחרים ישירות על לקוחות הריטייל שהיא מנהלת",
  },
  {
    label: "כניסת הבנק למסחר בקריפטו",
    agenda: true,
    searchQueries: ["בנק ישראל קריפטו רגולציה"],
    rationale: "כי היא מחזיקה את החלטת ההיצע הקמעונאי מול המהלך של לאומי",
  },
];

describe("parseProfileResponse reasoning", () => {
  it("keeps the staged reasoning alongside the axes", () => {
    const draft = parseProfileResponse(
      JSON.stringify({
        reasoning: "(א) חותמת על היצע המוצרים לריטייל. (ב) לאומי אוכל לה לקוחות. (ג) השקת ביטקוין של לאומי.",
        roleLens: "מחזיקה את היצע המוצרים הקמעונאי",
        axes: validAxes,
      })
    );
    expect(draft?.reasoning).toContain("לאומי אוכל לה לקוחות");
  });

  it("rejects a response with no reasoning — the thinking IS the feature", () => {
    // A model that skips the stages is the old brain with a new name. Null means the
    // caller records profile_call_failed instead of silently building unreasoned axes.
    const draft = parseProfileResponse(
      JSON.stringify({ roleLens: "תפקיד", axes: validAxes })
    );
    expect(draft).toBeNull();
  });
});

describe("personPromptInput", () => {
  const employerProfile = {
    whatTheySell: "ביטוח וחיסכון לצרכן הישראלי",
    customerSegments: ["B2C"],
    namedCompetitors: ["Lemonade", "הראל"],
    noClearCompetitors: false,
    noCompetitorsReason: "",
    digitalInitiatives: ["אפליקציית תביעות חדשה"],
    focusAreas: [{ area: "claims automation", why: "cost" }],
  };

  it("surfaces the commercial picture as first-class lines, not buried JSON", () => {
    const prompt = personPromptInput({
      fullName: "גיל תמיר",
      currentTitle: "Deputy CEO & Director of Innovation",
      headline: null,
      companyName: "הפניקס",
      employerProfile,
    });
    expect(prompt).toContain("ביטוח וחיסכון לצרכן הישראלי");
    expect(prompt).toContain("Lemonade");
    expect(prompt).toContain("אפליקציית תביעות חדשה");
  });

  it("carries the explicit no-competitors finding instead of a bare empty list", () => {
    const prompt = personPromptInput({
      fullName: "א",
      currentTitle: "CEO",
      headline: null,
      companyName: "מפעל הפיס",
      employerProfile: {
        ...employerProfile,
        namedCompetitors: [],
        noClearCompetitors: true,
        noCompetitorsReason: "מונופול ממשלתי בתחומו",
      },
    });
    expect(prompt).toContain("מונופול ממשלתי בתחומו");
  });

  it("tolerates a legacy employer profile missing the new fields", () => {
    // Prod still holds profiles researched before 2026-08-26; the builder must not
    // crash on them — it just has less to say.
    const prompt = personPromptInput({
      fullName: "א",
      currentTitle: "CTO",
      headline: null,
      companyName: "בנק",
      employerProfile: { focusAreas: [{ area: "x", why: "y" }] },
    });
    expect(prompt).toContain("בנק");
  });
});

describe("PROFILE_SYSTEM staged thinking", () => {
  it("demands the three stages before any axis is derived", () => {
    expect(PROFILE_SYSTEM).toMatch(/what do they sign/i);
    expect(PROFILE_SYSTEM).toMatch(/eat their customers/i);
    expect(PROFILE_SYSTEM).toMatch(/stop everything/i);
  });

  it("requires each rationale to point at a staged answer, not a domain", () => {
    expect(PROFILE_SYSTEM).toMatch(/כי הוא בבנקאות/);
  });

  it("requires competitor axes to carry the competitors' actual names as queries", () => {
    expect(PROFILE_SYSTEM).toMatch(/namedCompetitors|competitor.*BY NAME|actual names/i);
  });
});
