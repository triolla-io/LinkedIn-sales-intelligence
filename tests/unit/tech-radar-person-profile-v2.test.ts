import { describe, it, expect } from "vitest";

import {
  parsePersonProfile,
  parseProfileResponse,
  parseProfileResponseWithReason,
  personPromptInput,
  PROFILE_MODEL,
  PROFILE_SYSTEM,
} from "@/lib/tech-radar/person-profile";

/**
 * The live 31.8 measurement this file exists to make impossible:
 *
 * Pazit Garfinkel, Head of Retail Banking at Bank Hapoalim, came back with FIVE axes whose
 * `personDecision` was the same sentence five times — "חתומה על הצעת השירותים הקמעונאיים
 * ועל תקציב הפיתוח" — i.e. one axis wearing five labels, each a restatement of her title.
 * Two of them offered the bank's company-wide segment string "Individual consumers and
 * households" as their layer-2 fact, which is the company answering for the person. She had
 * no competitor axis at all: no One Zero, no consumer credit.
 *
 * The fix is upstream of the axes. Before the layer cake the model now answers a THREE-
 * QUESTION ROLE ANALYSIS — what the title owns anywhere, what lines this company actually
 * runs and for whom, and the intersection verified against the person's own words — and the
 * intersection is returned as two new REQUIRED-ish fields: `audience` (whose customers are
 * these) and `scope` (`owns`/`notOwns`). A build with no audience fails loudly here rather
 * than producing a company-shaped profile that only looks like a person.
 */

const AUDIENCE = { type: ["B2C"], who: "משקי בית ולקוחות פרטיים", geography: "ישראל" };

const DOMAINS = [
  { domain: "בנקאות קמעונאית", kind: "found", source: "title", evidence: "Head of Retail Banking" },
];

/** One valid axis: an empty `axes` is still `null`, and that pre-v2 rule is untouched. */
const AXES = [
  {
    label: "האשראי הצרכני של משקי הבית",
    stage: "competitor",
    domain: "בנקאות קמעונאית",
    layerEvidence: { layer: 2, quote: "One Zero מתחרה על אותם לקוחות פרטיים" },
    personDecision: "מחזיקה את החלטת האשראי הצרכני",
    companyFact: "One Zero מתחרה על אותם לקוחות פרטיים",
    externalExample: "",
    agenda: false,
    searchQueries: ["One Zero אשראי צרכני", "consumer credit Israel"],
    rationale: "כי היא מחזיקה את החלטת האשראי הצרכני בזמן ש-One Zero משיק אשראי לאותם לקוחות",
  },
];

const BASE = {
  reasoning: "קומה 1 בנקאות, קומה 2 לקוחות פרטיים, קומה 3 שקט, קומה 4 ההיצע הקמעונאי",
  roleLens: "מחזיקה את הקמעונאות",
  audience: AUDIENCE,
  scope: { owns: ["בנקאות קמעונאית", "אשראי צרכני"], notOwns: ["בנקאות עסקית", "שוקי הון"] },
  entityTags: [{ name: "One Zero", aliases: ["וואן זירו", "One Zero Bank"], kind: "competitor" }],
  domains: DOMAINS,
  axes: AXES,
};

describe("parsePersonProfile v2", () => {
  it("keeps audience, scope and entityTags", () => {
    const d = parsePersonProfile(JSON.stringify(BASE));
    expect(d?.audience?.type).toEqual(["B2C"]);
    expect(d?.audience?.who).toBe("משקי בית ולקוחות פרטיים");
    expect(d?.audience?.geography).toBe("ישראל");
    expect(d?.scope?.owns).toContain("אשראי צרכני");
    expect(d?.scope?.notOwns).toContain("שוקי הון");
    expect(d?.entityTags?.[0]?.aliases).toContain("וואן זירו");
    expect(d?.entityTags?.[0]?.kind).toBe("competitor");
  });

  it("rejects a profile with no audience (fails loudly, not silently)", () => {
    const { audience: _drop, ...rest } = BASE;
    expect(parsePersonProfile(JSON.stringify(rest))).toBeNull();
    expect(parseProfileResponseWithReason(JSON.stringify(rest)).reason).toMatch(/audience/i);
  });

  it("rejects an audience with no usable type, and one with no 'who'", () => {
    expect(parsePersonProfile(JSON.stringify({ ...BASE, audience: { ...AUDIENCE, type: ["B2X"] } }))).toBeNull();
    expect(parsePersonProfile(JSON.stringify({ ...BASE, audience: { ...AUDIENCE, who: "  " } }))).toBeNull();
    expect(parsePersonProfile(JSON.stringify({ ...BASE, audience: "משקי בית" }))).toBeNull();
  });

  it("keeps a multi-type audience, deduped, and an INTERNAL audience with no geography", () => {
    const multi = parsePersonProfile(
      JSON.stringify({ ...BASE, audience: { type: ["B2C", "B2B", "B2C", "nonsense"], who: "פרטיים ועסקים", geography: "" } })
    );
    expect(multi?.audience.type).toEqual(["B2C", "B2B"]);
    expect(multi?.audience.geography).toBe("");
    const cito = parsePersonProfile(
      JSON.stringify({ ...BASE, audience: { type: ["INTERNAL"], who: "היחידות של הבנק עצמו" } })
    );
    expect(cito?.audience.type).toEqual(["INTERNAL"]);
    expect(cito?.audience.geography).toBe("");
  });

  it("defaults scope to empty owns/notOwns when absent or malformed", () => {
    const { scope: _drop, ...rest } = BASE;
    expect(parsePersonProfile(JSON.stringify(rest))?.scope).toEqual({ owns: [], notOwns: [] });
    expect(parsePersonProfile(JSON.stringify({ ...BASE, scope: "הקמעונאות" }))?.scope).toEqual({
      owns: [],
      notOwns: [],
    });
    expect(
      parsePersonProfile(JSON.stringify({ ...BASE, scope: { owns: ["קמעונאות", 7, "  "], notOwns: null } }))?.scope
    ).toEqual({ owns: ["קמעונאות"], notOwns: [] });
  });

  it("drops an entity tag with no name; clamps tag kind to the closed set", () => {
    const d = parsePersonProfile(
      JSON.stringify({
        ...BASE,
        entityTags: [
          { name: "", aliases: [], kind: "competitor" },
          { name: "Poalim Wonder", aliases: [], kind: "weird" },
        ],
      })
    );
    expect(d?.entityTags).toHaveLength(1);
    expect(d?.entityTags?.[0]).toEqual({ name: "Poalim Wonder", aliases: [], kind: "product" });
  });

  it("string-filters aliases, drops the tag's own name from them, and caps at 10 tags", () => {
    const d = parsePersonProfile(
      JSON.stringify({
        ...BASE,
        entityTags: [
          { name: "One Zero", aliases: ["וואן זירו", 42, "  ", "וואן זירו", "One Zero"], kind: "competitor" },
          ...Array.from({ length: 12 }, (_, n) => ({ name: `ישות ${n}`, aliases: [], kind: "project" })),
        ],
      })
    );
    expect(d?.entityTags?.[0]?.aliases).toEqual(["וואן זירו"]);
    expect(d?.entityTags).toHaveLength(10);
  });

  it("has no entityTags at all rather than a placeholder when the model returned none", () => {
    const { entityTags: _drop, ...rest } = BASE;
    expect(parsePersonProfile(JSON.stringify(rest))?.entityTags).toEqual([]);
  });

  it("is the same parse as parseProfileResponse — every pre-v2 rule still applies", () => {
    expect(parsePersonProfile(JSON.stringify(BASE))).toEqual(parseProfileResponse(JSON.stringify(BASE)));
    // No usable axis, no roleLens, no reasoning: all still null, all still named.
    expect(parsePersonProfile(JSON.stringify({ ...BASE, axes: [] }))).toBeNull();
    expect(parsePersonProfile(JSON.stringify({ ...BASE, roleLens: "" }))).toBeNull();
    expect(parsePersonProfile(JSON.stringify({ ...BASE, reasoning: "" }))).toBeNull();
    expect(parsePersonProfile("not json")).toBeNull();
  });
});

describe("PROFILE_MODEL", () => {
  it("builds with Sonnet by default — the rarest and most consequential call in the system", () => {
    expect(PROFILE_MODEL).toBe(process.env.TECH_RADAR_PROFILE_MODEL ?? "anthropic/claude-sonnet-5");
  });
});

describe("PROFILE_SYSTEM role analysis", () => {
  it("asks the three role questions in order, BEFORE the layer cake", () => {
    const one = PROFILE_SYSTEM.indexOf("ROLE-1");
    const two = PROFILE_SYSTEM.indexOf("ROLE-2");
    const three = PROFILE_SYSTEM.indexOf("ROLE-3");
    const layer1 = PROFILE_SYSTEM.indexOf("LAYER 1");
    expect(one).toBeGreaterThan(-1);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    expect(layer1).toBeGreaterThan(three);
  });

  it("ROLE-1 is answered from the title alone, before this company", () => {
    expect(PROFILE_SYSTEM).toMatch(/what does this job title mean ANYWHERE/);
    expect(PROFILE_SYSTEM).toMatch(/NOT own/);
    expect(PROFILE_SYSTEM).toMatch(/before\s+looking at this company/);
  });

  it("ROLE-2 quotes the company's own business lines, and who each line serves", () => {
    expect(PROFILE_SYSTEM).toMatch(/businessLines/);
    expect(PROFILE_SYSTEM).toMatch(/who each line serves/);
    expect(PROFILE_SYSTEM).toMatch(/Quote them/);
  });

  it("ROLE-3 is the intersection, and the person's own words outrank the canonical definition", () => {
    expect(PROFILE_SYSTEM).toMatch(/THE INTERSECTION = SCOPE/);
    expect(PROFILE_SYSTEM).toMatch(/notOwns/);
    expect(PROFILE_SYSTEM).toMatch(/own words outrank the canonical definition/);
  });

  it("derives audience from the lines the person owns, and says a missing one is rejected in code", () => {
    expect(PROFILE_SYSTEM).toMatch(/the union of forWhom across the lines they own/);
    expect(PROFILE_SYSTEM).toMatch(/"B2C"\/"B2B"\/"B2G"\/"INTERNAL"/);
    expect(PROFILE_SYSTEM).toMatch(/audience is REQUIRED/);
    expect(PROFILE_SYSTEM).toMatch(/\["INTERNAL"\]/);
  });

  it("tells the model the career summary is computed in code, not to be re-derived", () => {
    expect(PROFILE_SYSTEM).toMatch(/CAREER \(computed in code — trust it, do not re-derive\)/);
  });

  it("treats person research as layer-4 FOUND evidence and reserves source 'post'", () => {
    expect(PROFILE_SYSTEM).toMatch(/PERSON RESEARCH/);
    expect(PROFILE_SYSTEM).toMatch(/source: "post" is reserved/);
  });

  it("asks for 3-8 entity tags with aliases in both scripts, names only from the given lists", () => {
    expect(PROFILE_SYSTEM).toMatch(/ENTITY TAGS/);
    expect(PROFILE_SYSTEM).toMatch(/"kind": "competitor"\|"product"\|"project"\|"regulator"/);
    expect(PROFILE_SYSTEM).toMatch(/every spelling in both scripts/);
    expect(PROFILE_SYSTEM).toMatch(/3-8 tags/);
    expect(PROFILE_SYSTEM).toMatch(/an invented name in a tag becomes an\s+invented name in a message/);
  });

  it("forbids the five-labels-one-axis failure by name, and axes about notOwns subjects", () => {
    expect(PROFILE_SYSTEM).toMatch(/DISTINCT DECISIONS/);
    expect(PROFILE_SYSTEM).toContain("חתומה על הצעת השירותים");
    expect(PROFILE_SYSTEM).toMatch(/ONE axis wearing two labels/);
    expect(PROFILE_SYSTEM).toMatch(/scope\.notOwns is deleted in code/);
  });

  it("extends the JSON contract with the three new fields", () => {
    const contract = PROFILE_SYSTEM.slice(PROFILE_SYSTEM.indexOf("Return strict JSON only"));
    expect(contract).toMatch(/"audience":\{/);
    expect(contract).toMatch(/"scope":\{/);
    expect(contract).toMatch(/"entityTags":\[/);
  });

  it("keeps the pre-v2 rules that were paid for in production", () => {
    // The four-layer cake, both swaps, found/derived with quotes, the rationale rules, the
    // label proofreading and the agenda rule are all still there — v2 PREPENDS, it does not
    // replace. Each of these lines is a live failure that already cost a run.
    for (const marker of [
      "LAYER 2 — COMPANY & CUSTOMERS",
      "LAYER 3 — WHAT OCCUPIES THEM NOW",
      "LAYER 4 — THE PERSON'S FIELDS",
      "SWAP THE PERSON",
      "SWAP THE COMPANY",
      "FOUND (נמצא)",
      "DERIVED (נגזר)",
      "RATIONALE RULES",
      'EXACTLY ONE of them must have "agenda": true',
      "Proofread it before returning",
    ]) {
      expect(PROFILE_SYSTEM).toContain(marker);
    }
  });
});

describe("personPromptInput v2 inputs", () => {
  const base = {
    fullName: "פזית גרפינקל",
    currentTitle: "Head of Retail Banking",
    headline: null,
    companyName: "בנק הפועלים",
    employerProfile: { whatTheySell: "בנקאות", namedCompetitors: ["לאומי"] },
  };

  it("renders each business line as name — forWhom: description", () => {
    const prompt = personPromptInput({
      ...base,
      businessLines: [
        { name: "בנקאות קמעונאית", description: "חשבונות, אשראי ומשכנתאות", forWhom: "משקי בית" },
        { name: "בנקאות עסקית", description: "אשראי לעסקים", forWhom: "עסקים קטנים ובינוניים" },
      ],
    });
    expect(prompt).toContain("בנקאות קמעונאית — משקי בית: חשבונות, אשראי ומשכנתאות");
    expect(prompt).toContain("בנקאות עסקית — עסקים קטנים ובינוניים: אשראי לעסקים");
  });

  it("renders skills and education, defensively out of untyped Json", () => {
    const prompt = personPromptInput({
      ...base,
      skills: ["Retail Banking", 7, "  ", "Consumer Lending"],
      education: [
        { school: "אוניברסיטת תל אביב", degree: "MBA", field: "מנהל עסקים" },
        { school: "הטכניון", degree: null, field: null },
        "לא אובייקט",
      ],
    });
    expect(prompt).toContain("Skills: Retail Banking, Consumer Lending");
    expect(prompt).toMatch(/Education: .*אוניברסיטת תל אביב/);
    expect(prompt).toContain("MBA");
    expect(prompt).toContain("הטכניון");
  });

  it("labels the career summary as computed so the model does not re-derive it", () => {
    const prompt = personPromptInput({
      ...base,
      career: {
        tenureYearsInCurrentRole: 4,
        path: [
          { title: "Head of Retail Banking", company: "בנק הפועלים", years: 4 },
          { title: "מנהלת אזור", company: "בנק הפועלים", years: 6 },
        ],
      },
    });
    expect(prompt).toContain("Career (computed)");
    expect(prompt).toMatch(/tenure in current role: 4/i);
    expect(prompt).toContain("מנהלת אזור");
  });

  it("says tenure is unknown rather than printing a number nobody computed", () => {
    const prompt = personPromptInput({
      ...base,
      career: { tenureYearsInCurrentRole: null, path: [{ title: "Head of Retail", company: null, years: null }] },
    });
    expect(prompt).toContain("Career (computed)");
    expect(prompt).toMatch(/tenure in current role: unknown/i);
  });

  it("renders person research findings, capped at four and truncated per finding", () => {
    const long = "א".repeat(2000);
    const prompt = personPromptInput({
      ...base,
      personResearch: {
        findings: Array.from({ length: 6 }, (_, n) => ({
          title: `ראיון ${n}`,
          url: `https://example.com/${n}`,
          snippet: `תקציר ${n}`,
          pageText: long,
        })),
      },
    });
    expect(prompt).toContain("Person research");
    expect(prompt).toContain("ראיון 0");
    expect(prompt).toContain("ראיון 3");
    expect(prompt).not.toContain("ראיון 4");
    expect(prompt).not.toContain(long);
    expect(prompt).toContain("א".repeat(500));
  });

  it("writes no line at all for an absent input — an empty label invites the model to fill it", () => {
    const prompt = personPromptInput(base);
    expect(prompt).not.toMatch(/Business lines/);
    expect(prompt).not.toMatch(/Skills:/);
    expect(prompt).not.toMatch(/Education:/);
    expect(prompt).not.toMatch(/Career \(computed\)/);
    expect(prompt).not.toMatch(/Person research/);
  });
});
