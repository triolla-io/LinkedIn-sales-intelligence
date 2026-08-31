import { describe, it, expect } from "vitest";

import { parseProfileResponse } from "@/lib/tech-radar/profile";

/**
 * 2026-08-31: Pazit Garfinkel (Head of Retail Banking at Bank Hapoalim) was given the
 * BANK's company-wide customerSegments string as her own customers — a retail chair
 * described as serving everyone the bank serves. A business line is the only place
 * that knows who IT serves, so each line now carries `forWhom` and the person model
 * cuts a person's audience out of the lines they actually own.
 *
 * `forWhom` defaults to "" — a profile researched before this change simply has no
 * such key, and "" says "unknown" without inventing an audience for it.
 */
describe("businessLines forWhom", () => {
  it("keeps forWhom from the model output", () => {
    const p = parseProfileResponse(
      JSON.stringify({
        businessLines: [
          { name: "Retail banking", description: "consumer accounts", forWhom: "households in Israel" },
        ],
        products: [],
        customerSegments: ["B2C"],
        whatTheySell: "banking",
        namedCompetitors: ["Leumi / לאומי"],
        noClearCompetitors: false,
        noCompetitorsReason: "",
        techStack: [],
        digitalInitiatives: [],
        focusAreas: [{ area: "a", why: "b" }],
        searchQueries: ["q"],
        industry: { canonical: "בנקאות ישראל / Israeli banking", queries: ["q"] },
        recentMoves: [],
        quietNow: true,
      })
    );
    expect(p?.businessLines[0]?.forWhom).toBe("households in Israel");
  });

  it("defaults forWhom to empty string when absent (legacy)", () => {
    const p = parseProfileResponse(
      JSON.stringify({
        businessLines: [{ name: "x", description: "y" }],
        products: [],
        customerSegments: ["B2C"],
        whatTheySell: "s",
        namedCompetitors: [],
        noClearCompetitors: true,
        noCompetitorsReason: "monopoly",
        techStack: [],
        digitalInitiatives: [],
        focusAreas: [{ area: "a", why: "b" }],
        searchQueries: ["q"],
        industry: { canonical: "c", queries: ["q"] },
        recentMoves: [],
        quietNow: true,
      })
    );
    expect(p?.businessLines[0]?.forWhom).toBe("");
  });
});
