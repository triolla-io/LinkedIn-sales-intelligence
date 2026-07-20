import { describe, it, expect } from "vitest";
import { enrichmentCreditCost } from "@/lib/apollo/budget";

// Mirrors Apollo's observed billing: a people/match with an email reveal costs
// ~1 credit; a "Waterfall Enriched Mobile Number" phone reveal costs 8 more.
// The old counter always charged 1 regardless, letting spend run ~9x the budget.
describe("enrichmentCreditCost", () => {
  it("charges 1 for an email-only reveal", () => {
    expect(enrichmentCreditCost({ email: "a@b.com", phone: null })).toBe(1);
  });

  it("charges 9 when a mobile number was revealed (1 + 8)", () => {
    expect(enrichmentCreditCost({ email: "a@b.com", phone: "+972501234567" })).toBe(9);
  });

  it("charges 8 for a phone-only reveal", () => {
    expect(enrichmentCreditCost({ email: null, phone: "+972501234567" })).toBe(8);
  });

  it("still charges at least 1 for a match that returned nothing", () => {
    expect(enrichmentCreditCost({ email: null, phone: null })).toBe(1);
  });
});
