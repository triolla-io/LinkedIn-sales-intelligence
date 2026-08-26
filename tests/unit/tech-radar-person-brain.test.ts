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
 * commercial picture and must think in FOUR LAYERS before deriving axes:
 *   1 industry → 2 company & customers → 3 what occupies them now → 4 the person's fields
 * A layer may not answer without quoting the layer beneath it, a layer with no data fails
 * loudly, and every field the person works in is tagged FOUND (with a source and a
 * verbatim quote) or DERIVED (inferred by crossing role × company). Only then 3-5 axes,
 * each naming its domain and quoting the layer-2/3 fact it met. The reasoning is SAVED so
 * we can see how the brain reached the axes.
 */
const validDomains = [
  {
    domain: "ההיצע הקמעונאי",
    kind: "found",
    source: "title",
    evidence: "Head of Retail Banking",
  },
  {
    domain: "חוויית לקוח דיגיטלית",
    kind: "derived",
    source: null,
    evidence: "ראש בנקאות קמעונאית × בנק שמוכר לצרכן הפרטי",
  },
];

const validAxes = [
  {
    label: "מוצרי מתחרים בריטייל הבנקאי",
    agenda: false,
    stage: "competitor",
    domain: "ההיצע הקמעונאי",
    layerEvidence: { layer: 2, quote: "לאומי מתחרה על אותם לקוחות פרטיים" },
    personDecision: "מחזיקה את החלטת ההיצע הקמעונאי",
    companyFact: "לאומי מתחרה על אותם לקוחות פרטיים",
    searchQueries: ["לאומי דיגיטל השקה", "retail banking product launch Israel"],
    rationale: "כי לאומי והדיסקונט מתחרים ישירות על לקוחות הריטייל שהיא מנהלת",
  },
  {
    label: "כניסת הבנק למסחר בקריפטו",
    agenda: true,
    stage: "decision",
    domain: "חוויית לקוח דיגיטלית",
    layerEvidence: { layer: 3, quote: "הכריזו על מסחר בקריפטו לצרכן", dateIso: "2026-07-14" },
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
        reasoning: "(1) בנקאות. (2) לאומי אוכל לה לקוחות. (3) השקת ביטקוין של לאומי.",
        roleLens: "מחזיקה את היצע המוצרים הקמעונאי",
        domains: validDomains,
        axes: validAxes,
      })
    );
    expect(draft?.reasoning).toContain("לאומי אוכל לה לקוחות");
  });

  it("rejects a response with no reasoning — the thinking IS the feature", () => {
    // A model that skips the layers is the old brain with a new name. Null means the
    // caller records profile_call_failed instead of silently building unreasoned axes.
    const draft = parseProfileResponse(
      JSON.stringify({ roleLens: "תפקיד", domains: validDomains, axes: validAxes })
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

/**
 * The four layers are what the prompt can actually SEE. Layer 1 cannot quote an industry
 * that was never put in front of it, and layer 4 cannot find a field in an About paragraph
 * the prompt never received — the person data landed on Contact before this task and was
 * threaded through unread, which is a silent no-op until these lines exist.
 */
describe("personPromptInput layer inputs", () => {
  const full = {
    fullName: "אורי כהן",
    currentTitle: "VP Data & AI, Digital Division",
    headline: "בונה את שכבת הדאטה של הבנק",
    companyName: "בנק הפועלים",
    employerProfile: { whatTheySell: "בנקאות קמעונאית" },
    about: "מוביל את תחום הדאטה והבינה המלאכותית בחטיבה הדיגיטלית",
    experience: [
      { title: "Head of Data", company: "מזרחי טפחות", dateRange: "2019-2023" },
      { title: "Data Architect", company: "אמדוקס", dateRange: "2015-2019" },
    ],
    industry: { canonical: "בנקאות קמעונאית בישראל", queries: ["a", "b", "c"] },
    recentMoves: [
      { fact: "השיקו ארנק דיגיטלי", dateIso: "2026-07-14" },
      { fact: "רכשו סטארטאפ תשלומים", dateIso: "2026-06-02" },
    ],
    quietNow: false,
  };

  it("gives layer 1 the researched industry to quote", () => {
    expect(personPromptInput(full)).toContain("Industry: בנקאות קמעונאית בישראל");
  });

  it("gives layer 4 the About paragraph and the past roles to find fields in", () => {
    const prompt = personPromptInput(full);
    expect(prompt).toContain("About: מוביל את תחום הדאטה");
    expect(prompt).toContain("Experience: Head of Data — מזרחי טפחות (2019-2023)");
    expect(prompt).toContain("Data Architect — אמדוקס (2015-2019)");
  });

  it("gives layer 3 the dated moves, each with its own date", () => {
    const prompt = personPromptInput(full);
    expect(prompt).toContain("Recent moves (dated): 2026-07-14: השיקו ארנק דיגיטלי");
    expect(prompt).toContain("2026-06-02: רכשו סטארטאפ תשלומים");
  });

  it("says שקט when the research verified there were no moves", () => {
    const prompt = personPromptInput({ ...full, recentMoves: [], quietNow: true });
    expect(prompt).toContain("Recent moves: שקט");
    expect(prompt).not.toContain("Recent moves (dated):");
  });

  it("reads the layer inputs off the employer profile when the caller does not pass them", () => {
    // The research fields live on the employer's stored profile; a caller that just hands
    // over the profile must not silently lose layers 1 and 3.
    const prompt = personPromptInput({
      fullName: "א",
      currentTitle: "CTO",
      headline: null,
      companyName: "בנק",
      employerProfile: {
        industry: { canonical: "ביטוח כללי", queries: [] },
        recentMoves: [{ fact: "נכנסו לביטוח סייבר", dateIso: "2026-08-01" }],
      },
    });
    expect(prompt).toContain("Industry: ביטוח כללי");
    expect(prompt).toContain("2026-08-01: נכנסו לביטוח סייבר");
  });

  it("omits every layer line the data does not support, rather than writing an empty one", () => {
    const prompt = personPromptInput({
      fullName: "א",
      currentTitle: "CTO",
      headline: null,
      companyName: "בנק",
      employerProfile: {},
    });
    expect(prompt).not.toContain("Industry:");
    expect(prompt).not.toContain("About:");
    expect(prompt).not.toContain("Experience:");
    expect(prompt).not.toContain("Recent moves");
  });
});

describe("PROFILE_SYSTEM staged thinking", () => {
  /**
   * The three questions the staged prompt asked as (א)/(ב)/(ג) did not disappear with the
   * layer cake — they are what the four `stage` words MEAN, so they moved into the output
   * contract's stage bullet. This test guards them wherever they live.
   */
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

  /** The ownership rule that stopped core-systems modernization reaching a VP Product. */
  it("keeps infrastructure with the CIO and out of a product executive's axes", () => {
    expect(PROFILE_SYSTEM).toMatch(/only a CIO\/CTO signs infrastructure/);
    expect(PROFILE_SYSTEM).toMatch(/Core-systems modernization is the CIO's subject/);
  });
});

/**
 * The layer cake itself. These assertions are not decoration: the whole method is an
 * ORDER plus a CHAINING RULE, and both are invisible to any other test — a future edit
 * that drops a layer or lets a layer answer without a quote would otherwise pass green.
 */
describe("PROFILE_SYSTEM four-layer cake", () => {
  it("asks the four layers, in order", () => {
    const one = PROFILE_SYSTEM.indexOf("LAYER 1");
    const two = PROFILE_SYSTEM.indexOf("LAYER 2");
    const three = PROFILE_SYSTEM.indexOf("LAYER 3");
    const four = PROFILE_SYSTEM.indexOf("LAYER 4");
    expect(one).toBeGreaterThan(-1);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    expect(four).toBeGreaterThan(three);
  });

  it("makes the chaining rule the method — no layer answers without quoting the one beneath", () => {
    // \\s+ because the prompt keeps its own line wrapping: the sentence is verbatim, the
    // newline inside it is not content. Reflowing shipped prompt text to please a regex
    // is the tail wagging the model.
    expect(PROFILE_SYSTEM).toMatch(/quoting the output of the layer\s+beneath it/);
  });

  it("names the four layers' questions", () => {
    expect(PROFILE_SYSTEM).toContain("באיזו תעשייה החברה?");
    expect(PROFILE_SYSTEM).toContain("איזו חברה זו, מי הלקוחות, ומי מנסה לאכול אותם?");
    expect(PROFILE_SYSTEM).toContain("במה האדם הזה עוסק בפועל?");
  });

  it("fails loudly on a layer with no data instead of filling it with a guess", () => {
    expect(PROFILE_SYSTEM).toMatch(/FAILS LOUDLY/);
    expect(PROFILE_SYSTEM).toContain("אין דאטה");
    expect(PROFILE_SYSTEM).toMatch(/an empty layer filled with a guess is/);
  });

  it("treats שקט as a complete layer-3 answer, not a missing one", () => {
    expect(PROFILE_SYSTEM).toContain('"שקט"');
    expect(PROFILE_SYSTEM).toMatch(/A move without a date DOES NOT EXIST for this/);
  });

  it("tags each field of work FOUND with its source, or DERIVED by crossing", () => {
    expect(PROFILE_SYSTEM).toContain("FOUND (נמצא)");
    expect(PROFILE_SYSTEM).toContain("DERIVED (נגזר)");
    expect(PROFILE_SYSTEM).toMatch(/Read the FULL title/);
    expect(PROFILE_SYSTEM).toContain("מהכותרת");
  });

  it("puts the swap test AFTER layer 4 and scopes it to derived fields only", () => {
    const four = PROFILE_SYSTEM.indexOf("LAYER 4");
    const swap = PROFILE_SYSTEM.indexOf("SWAP THE PERSON");
    expect(four).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(four);
    expect(PROFILE_SYSTEM).toContain("DERIVED fields only");
  });

  it("asks for the domains and for each axis's quoted layer fact", () => {
    expect(PROFILE_SYSTEM).toMatch(/"domains"/);
    expect(PROFILE_SYSTEM).toMatch(/layerEvidence/);
    expect(PROFILE_SYSTEM).toMatch(/dateIso/);
    expect(PROFILE_SYSTEM).toMatch(/"kind":"found"\|"derived"/);
  });

  /**
   * The skeleton is the thing a model copies. Shipping a layer-2 example that carries a
   * date contradicts the instruction twenty lines above it ("Omit dateIso for layer 2"),
   * and the parser passes any dateIso through untouched — so a fabricated date would ride
   * a layer-2 axis with nothing downstream to catch it. The skeleton must show the field
   * as it actually varies.
   */
  it("never shows a dated layer-2 example in the JSON skeleton", () => {
    expect(PROFILE_SYSTEM).toContain('"layerEvidence":{"layer":2|3');
    expect(PROFILE_SYSTEM).not.toMatch(/"layer":2,"quote":"\.\.\.","dateIso"/);
    expect(PROFILE_SYSTEM).toMatch(/layer 3 ONLY, omitted on layer 2/);
    expect(PROFILE_SYSTEM).toMatch(/Omit dateIso for layer 2/);
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
  const base = {
    reasoning: "(1) בנקאות. (2) לאומי אוכל לה לקוחות.",
    roleLens: "מחזיקה את ההיצע הקמעונאי",
    domains: validDomains,
  };

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
 * The parser half of the layer cake: every field of work is a row with a provenance, and
 * every axis points at one of those rows. The parser stays STRUCTURAL — it checks that a
 * claim was made and can be traced, never whether the claim is any good. That judgement
 * is the gate's, which is why an unparseable layer-3 date survives here.
 */
describe("parseProfileResponse domains", () => {
  const base = {
    reasoning: "(1) בנקאות. (2) לאומי אוכל לה לקוחות.",
    roleLens: "מחזיקה את ההיצע הקמעונאי",
  };

  it("carries the mapped fields onto the draft, with their provenance", () => {
    const draft = parseProfileResponse(
      JSON.stringify({ ...base, domains: validDomains, axes: validAxes })
    );
    expect(draft?.domains).toHaveLength(2);
    expect(draft?.domains[0]).toEqual({
      domain: "ההיצע הקמעונאי",
      kind: "found",
      source: "title",
      evidence: "Head of Retail Banking",
    });
    expect(draft?.domains[1].kind).toBe("derived");
    expect(draft?.domains[1].source).toBeNull();
  });

  it("drops a found field with no source — a claim of provenance with no provenance", () => {
    const { draft, reason } = parseProfileResponseWithReason(
      JSON.stringify({
        ...base,
        domains: [{ ...validDomains[0], source: null }],
        axes: [validAxes[0]],
      })
    );
    expect(draft).toBeNull();
    expect(reason).toContain("found_without_source");
  });

  it("drops a found field with no verbatim quote, for the same reason", () => {
    const { reason } = parseProfileResponseWithReason(
      JSON.stringify({
        ...base,
        domains: [{ ...validDomains[0], evidence: "" }],
        axes: [validAxes[0]],
      })
    );
    expect(reason).toContain("found_without_source");
  });

  it("keeps a derived field, whose source is null by construction", () => {
    const draft = parseProfileResponse(
      JSON.stringify({
        ...base,
        domains: [validDomains[1]],
        axes: [{ ...validAxes[0], domain: "חוויית לקוח דיגיטלית" }],
      })
    );
    expect(draft?.domains).toHaveLength(1);
    expect(draft?.axes[0].domain).toBe("חוויית לקוח דיגיטלית");
  });

  it("stores the domain as the domains list spells it, not as the axis spelled it", () => {
    // Matching is case/space-insensitive, so this axis is kept — but a later exact-string
    // join between PersonAxis.domain and PersonProfile.domains[].domain would miss the
    // variant, so the canonical form is what gets persisted.
    const draft = parseProfileResponse(
      JSON.stringify({
        ...base,
        domains: validDomains,
        axes: [{ ...validAxes[0], domain: "  ההיצע   הקמעונאי " }],
      })
    );
    expect(draft?.axes[0].domain).toBe("ההיצע הקמעונאי");
  });

  it("drops an axis whose domain names no mapped field", () => {
    const { draft, reason } = parseProfileResponseWithReason(
      JSON.stringify({
        ...base,
        domains: validDomains,
        axes: [{ ...validAxes[0], domain: "בינה מלאכותית" }],
      })
    );
    expect(draft).toBeNull();
    expect(reason).toContain("no_domain");
  });

  it("drops an axis that quotes no layer-2/3 fact at all", () => {
    const { draft, reason } = parseProfileResponseWithReason(
      JSON.stringify({
        ...base,
        domains: validDomains,
        axes: [{ ...validAxes[0], layerEvidence: { layer: 2 } }],
      })
    );
    expect(draft).toBeNull();
    expect(reason).toContain("no_layer_evidence");
  });

  it("keeps a layer-3 axis whose dateIso does not parse — that rejection is the gate's", () => {
    const draft = parseProfileResponse(
      JSON.stringify({
        ...base,
        domains: validDomains,
        axes: [
          {
            ...validAxes[0],
            layerEvidence: { layer: 3, quote: "הכריזו על ארנק", dateIso: "לפני חודשיים" },
          },
        ],
      })
    );
    expect(draft?.axes[0].layerEvidence).toEqual({
      layer: 3,
      quote: "הכריזו על ארנק",
      dateIso: "לפני חודשיים",
    });
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

/**
 * Erez Rachmil's adopt axis was rejected `no_company_side` because he wrote the external
 * exemplar INTO the company side: "banks in advanced markets proved you can offer a modern
 * digital experience inside a legacy system". That is a fact about someone else.
 *
 * The two are now separate fields. companyFact stays what it always was — a fact about
 * THEIR company, here the gap — and the exemplar gets its own place, which is also what
 * keeps it out of the competitor check.
 */
describe("the adopt axis carries its exemplar separately", () => {
  it("keeps externalExample apart from companyFact", () => {
    const parsed = parseProfileResponse(
      JSON.stringify({
        reasoning: "ה) שרד",
        roleLens: "חתום על ארכיטקטורת הליבה",
        domains: [
          {
            domain: "ארכיטקטורת זיהוי",
            kind: "found",
            source: "headline",
            evidence: "Chief Information & Technology Officer",
          },
        ],
        axes: [
          {
            label: "פתיחת חשבון מיידית",
            stage: "adopt",
            domain: "ארכיטקטורת זיהוי",
            layerEvidence: { layer: 2, quote: "לקוחות פרטיים שפותחים חשבון" },
            personDecision: "חתום על תכנית ההשקעה בטכנולוגיה",
            companyFact: "פתיחת חשבון בבנק הפועלים עדיין דורשת מסמכים וימי עסקים",
            externalExample: "בנקים בסינגפור פותחים חשבון בדקות ללא מסמכים",
            agenda: false,
            searchQueries: ["instant account opening"],
            rationale: "כי הוא חתום על ארכיטקטורת הזיהוי, ופתיחת חשבון בבנק עדיין דורשת מסמכים",
          },
        ],
      })
    );
    expect(parsed?.axes[0].companyFact).toContain("בנק הפועלים");
    expect(parsed?.axes[0].externalExample).toContain("סינגפור");
  });

  it("the prompt tells an adopt axis where the exemplar goes", () => {
    expect(PROFILE_SYSTEM).toMatch(/externalExample/);
    // The instruction that was missing: the company side of an adopt axis is the GAP.
    expect(PROFILE_SYSTEM).toMatch(/gap/i);
  });
});
