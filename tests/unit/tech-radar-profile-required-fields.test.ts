import { describe, it, expect } from "vitest";

import { parseProfileResponse, missingResearchFields } from "@/lib/tech-radar/profile";

/**
 * 2026-08-26, from the first sent draft's feedback: every axis was built through a CTO
 * lens because the employer profile never said what the company SELLS, to WHOM, or
 * against WHOM. Three fields become load-bearing:
 *
 *   whatTheySell     — required. Every company sells something; empty = failed research.
 *   customerSegments — required, same reasoning.
 *   namedCompetitors — empty is allowed ONLY as an explicit finding: the model must set
 *                      noClearCompetitors: true AND say why ("מונופול ממשלתי בתחומו").
 *                      An empty list without that declaration is a field the model
 *                      forgot, not a company without rivals.
 */
describe("parseProfileResponse required fields", () => {
  const base = {
    businessLines: [{ name: "insurance", description: "d" }],
    focusAreas: [{ area: "a", why: "w" }],
    searchQueries: ["q"],
  };

  it("reads whatTheySell, namedCompetitors and the explicit no-competitors finding", () => {
    const p = parseProfileResponse(
      JSON.stringify({
        ...base,
        whatTheySell: "ביטוח וניהול נכסים לצרכן הישראלי",
        customerSegments: ["B2C"],
        namedCompetitors: ["Lemonade", "הראל", "מגדל"],
      })
    );
    expect(p?.whatTheySell).toBe("ביטוח וניהול נכסים לצרכן הישראלי");
    expect(p?.namedCompetitors).toEqual(["Lemonade", "הראל", "מגדל"]);
    expect(p?.noClearCompetitors).toBe(false);
  });

  it("keeps the model's explicit no-competitors declaration and its reason", () => {
    const p = parseProfileResponse(
      JSON.stringify({
        ...base,
        whatTheySell: "הגרלות",
        customerSegments: ["B2C"],
        namedCompetitors: [],
        noClearCompetitors: true,
        noCompetitorsReason: "מונופול ממשלתי בתחומו",
      })
    );
    expect(p?.noClearCompetitors).toBe(true);
    expect(p?.noCompetitorsReason).toBe("מונופול ממשלתי בתחומו");
  });
});

/**
 * 2026-08-26, layer cake task 5: research now also answers the industry (layer 1 —
 * the broad shared net) and what is occupying the company right now, as dated facts
 * only (layer 3). A company with no verified dated move must say so explicitly
 * (quietNow: true), never default to silence.
 */
describe("parseProfileResponse industry and recentMoves", () => {
  const base = {
    businessLines: [{ name: "insurance", description: "d" }],
    focusAreas: [{ area: "a", why: "w" }],
    searchQueries: ["q"],
    whatTheySell: "ביטוח לצרכן",
    customerSegments: ["B2C"],
    namedCompetitors: ["Lemonade"],
  };

  it("reads the industry canonical name and caps queries at 5", () => {
    const p = parseProfileResponse(
      JSON.stringify({
        ...base,
        industry: {
          canonical: "בנקאות ישראל / Israeli banking",
          queries: ["q1", "q2", "q3", "q4", "q5", "q6"],
        },
      })
    );
    expect(p?.industry?.canonical).toBe("בנקאות ישראל / Israeli banking");
    expect(p?.industry?.queries).toHaveLength(5);
  });

  it("drops a recentMove whose dateIso does not parse, keeps a dated one", () => {
    const p = parseProfileResponse(
      JSON.stringify({
        ...base,
        recentMoves: [
          { fact: "launched instant payouts", dateIso: "2026-08-01", sourceUrl: "https://example.com/a" },
          { fact: "undated rumor", dateIso: "recently" },
        ],
      })
    );
    expect(p?.recentMoves).toHaveLength(1);
    expect(p?.recentMoves?.[0]?.fact).toBe("launched instant payouts");
    expect(p?.recentMoves?.[0]?.dateIso).toBe("2026-08-01");
  });

  it("defaults quietNow to false when the model omits it", () => {
    const p = parseProfileResponse(JSON.stringify(base));
    expect(p?.quietNow).toBe(false);
  });

  it("keeps an explicit quietNow: true finding", () => {
    const p = parseProfileResponse(JSON.stringify({ ...base, quietNow: true }));
    expect(p?.quietNow).toBe(true);
  });
});

describe("missingResearchFields", () => {
  const complete = {
    whatTheySell: "ביטוח לצרכן",
    customerSegments: ["B2C"],
    namedCompetitors: ["Lemonade"],
    noClearCompetitors: false,
    noCompetitorsReason: "",
    industry: { canonical: "ביטוח ישראל / Israeli insurance", queries: ["q1", "q2", "q3"] },
    recentMoves: [{ fact: "launched instant payouts", dateIso: "2026-08-01" }],
    quietNow: false,
  };

  it("accepts a complete profile", () => {
    expect(missingResearchFields(complete)).toEqual([]);
  });

  it("names an empty whatTheySell — every company sells something", () => {
    expect(missingResearchFields({ ...complete, whatTheySell: "" })).toContain("whatTheySell");
  });

  it("names empty customerSegments", () => {
    expect(missingResearchFields({ ...complete, customerSegments: [] })).toContain("customerSegments");
  });

  it("rejects an empty competitor list the model never declared", () => {
    expect(missingResearchFields({ ...complete, namedCompetitors: [] })).toContain("namedCompetitors");
  });

  it("accepts an empty competitor list backed by an explicit reasoned finding", () => {
    expect(
      missingResearchFields({
        ...complete,
        namedCompetitors: [],
        noClearCompetitors: true,
        noCompetitorsReason: "מונופול ממשלתי בתחומו",
      })
    ).toEqual([]);
  });

  it("rejects the declaration without its reason — a checkbox is not a finding", () => {
    expect(
      missingResearchFields({
        ...complete,
        namedCompetitors: [],
        noClearCompetitors: true,
        noCompetitorsReason: "",
      })
    ).toContain("noCompetitorsReason");
  });

  it("names industry when canonical is missing", () => {
    expect(
      missingResearchFields({ ...complete, industry: { canonical: "", queries: complete.industry.queries } })
    ).toContain("industry");
  });

  it("names industry when fewer than 3 queries", () => {
    expect(
      missingResearchFields({
        ...complete,
        industry: { canonical: complete.industry.canonical, queries: ["q1", "q2"] },
      })
    ).toContain("industry");
  });

  it("names recentMoves when empty and quietNow is not true", () => {
    expect(missingResearchFields({ ...complete, recentMoves: [], quietNow: false })).toContain("recentMoves");
  });

  it("accepts quietNow: true with an empty recentMoves list — that is an active finding", () => {
    expect(missingResearchFields({ ...complete, recentMoves: [], quietNow: true })).toEqual([]);
  });
});
