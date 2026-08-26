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

describe("missingResearchFields", () => {
  const complete = {
    whatTheySell: "ביטוח לצרכן",
    customerSegments: ["B2C"],
    namedCompetitors: ["Lemonade"],
    noClearCompetitors: false,
    noCompetitorsReason: "",
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
});
