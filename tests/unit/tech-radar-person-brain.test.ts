import { describe, it, expect } from "vitest";

import {
  parseProfileResponse,
  parseProfileResponseWithReason,
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
    stage: "competitor",
    personDecision: "מחזיקה את החלטת ההיצע הקמעונאי",
    companyFact: "לאומי מתחרה על אותם לקוחות פרטיים",
    searchQueries: ["לאומי דיגיטל השקה", "retail banking product launch Israel"],
    rationale: "כי לאומי והדיסקונט מתחרים ישירות על לקוחות הריטייל שהיא מנהלת",
  },
  {
    label: "כניסת הבנק למסחר בקריפטו",
    agenda: true,
    stage: "decision",
    personDecision: "חתומה על תמהיל המוצרים הקמעונאי",
    companyFact: "לקוחות קמעונאיים שחוסכים ומשקיעים",
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

/**
 * The structural half of the swap-test fix.
 *
 * On 2026-08-26 the crossing could not be checked at all: both sides of it existed only
 * inside one Hebrew sentence, and a regex over prose cannot say which half is the person
 * and which is the company. So the axis declares them — and declares WHICH staged
 * question produced it, because "derived from the role and the company" is a tag that
 * distinguishes nothing.
 */
describe("parseProfileResponse declared intersection", () => {
  const base = { reasoning: "(א) חותמת על ההיצע. (ב) לאומי אוכל לה לקוחות.", roleLens: "מחזיקה את ההיצע הקמעונאי" };

  it("carries both declared sides and the stage tag onto the axis", () => {
    const draft = parseProfileResponse(JSON.stringify({ ...base, axes: validAxes }));
    expect(draft?.axes[0].personDecision).toBe("מחזיקה את החלטת ההיצע הקמעונאי");
    expect(draft?.axes[0].companyFact).toBe("לאומי מתחרה על אותם לקוחות פרטיים");
    expect(draft?.axes[0].stage).toBe("competitor");
    expect(draft?.axes[1].stage).toBe("decision");
  });

  it("accepts the adopt stage, the one that produced ZERO axes for everyone", () => {
    // Stage (ד) — "what is done well somewhere else" — died in the live run because its
    // rationales named no fact about the person's own company, so they survived the
    // company swap and the judge (which had only that test) called them generic.
    const draft = parseProfileResponse(
      JSON.stringify({
        ...base,
        axes: [{ ...validAxes[0], stage: "adopt" }],
      })
    );
    expect(draft?.axes[0].stage).toBe("adopt");
  });

  it("drops an axis that cannot say which staged question produced it", () => {
    const draft = parseProfileResponse(
      JSON.stringify({
        ...base,
        axes: [
          { ...validAxes[0], stage: "derived from the role and the company" },
          { ...validAxes[1], stage: undefined },
        ],
      })
    );
    expect(draft).toBeNull();
  });

  it("says which requirement emptied the axis list, rather than one message for four gates", () => {
    const { reason } = parseProfileResponseWithReason(
      JSON.stringify({ ...base, axes: [{ ...validAxes[0], stage: "whatever" }] })
    );
    expect(reason).toContain("stage");
  });
});

/**
 * The swap test, inside the thinking and before the derivation — which is where the
 * product owner asked for it, precisely because a filter afterwards can only delete what
 * a union already spent its output budget on.
 */
describe("PROFILE_SYSTEM swap test", () => {
  it("carries both swaps, not just the company swap", () => {
    expect(PROFILE_SYSTEM).toMatch(/SWAP THE PERSON/);
    expect(PROFILE_SYSTEM).toMatch(/SWAP THE COMPANY/);
  });

  it("puts the swaps BEFORE any axis is derived", () => {
    const swap = PROFILE_SYSTEM.indexOf("SWAP THE PERSON");
    const derive = PROFILE_SYSTEM.indexOf("axes — 3 to 5 subjects");
    expect(swap).toBeGreaterThan(-1);
    expect(derive).toBeGreaterThan(swap);
  });

  it("keeps an axis only when it breaks under both swaps", () => {
    expect(PROFILE_SYSTEM).toMatch(/BREAKS UNDER BOTH/);
  });

  it("names the union failure it exists to prevent", () => {
    // Any CITO at any bank would have received Erez Rachmil's four axes.
    expect(PROFILE_SYSTEM).toMatch(/the COMPANY'S subject/);
    expect(PROFILE_SYSTEM).toMatch(/the TITLE'S subject/);
  });

  it("requires the rationale to name both sides of the crossing", () => {
    expect(PROFILE_SYSTEM).toMatch(/BOTH SIDES/);
  });

  it("declares the two sides and the stage tag as fields, not as prose", () => {
    expect(PROFILE_SYSTEM).toMatch(/personDecision/);
    expect(PROFILE_SYSTEM).toMatch(/companyFact/);
    expect(PROFILE_SYSTEM).toMatch(/"stage":"decision"\|"competitor"\|"stop_and_read"\|"adopt"/);
  });
});
