import { describe, it, expect } from "vitest";
import { parseConfirmResponse } from "@/lib/fintech-radar/match";

describe("parseConfirmResponse", () => {
  const valid = new Set(["c1", "c2"]);
  it("keeps only known ids and clamps score", () => {
    const out = parseConfirmResponse(JSON.stringify({ matches: [
      { contactId: "c1", score: 1.4, reason: "payments exec" },
      { contactId: "c2", score: 0.6, reason: "fintech CFO" },
      { contactId: "ghost", score: 0.9, reason: "n/a" },
    ] }), valid);
    expect(out.map((m) => m.contactId)).toEqual(["c1", "c2"]);
    expect(out[0].score).toBe(1);
  });
  it("returns [] on garbage", () => {
    expect(parseConfirmResponse("nope", valid)).toEqual([]);
  });
});
