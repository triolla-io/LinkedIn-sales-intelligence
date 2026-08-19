import { describe, it, expect } from "vitest";
import { isCLevelTitle, isSeniorTitle } from "@/lib/company-signals/clevel";

/**
 * The bare acronyms in the term list were matched as substrings, so "Coordinator"
 * contained "coo" and every coordinator in the database was treated as a COO. A Human
 * Resources Coordinator at Delek was drafted a message during the Tech Radar bring-up;
 * the same list gates company-signals and the Fintech Radar.
 */
describe("isCLevelTitle / isSeniorTitle — acronyms need word boundaries", () => {
  const falsePositives = [
    "Human Resources Coordinator",
    "Recruiting Coordinator",
    "Social Media Coordinator",
    "Cooperation Manager",
    "Microbiologist",
    "Procurement Specialist",
  ];

  it.each(falsePositives)("does not treat %s as C-level", (title) => {
    expect(isCLevelTitle(title)).toBe(false);
  });

  it.each(falsePositives)("does not treat %s as senior", (title) => {
    expect(isSeniorTitle(title)).toBe(false);
  });

  const realCLevel = [
    "CEO",
    "ceo",
    "COO",
    "Group COO",
    "CTO & Co-Founder",
    "Chief Executive Officer",
    "Chief Information and Data Officer",
    "Founder",
    "Managing Director",
    'מנכ"ל',
    "CIO, Retail",
    "CRO",
  ];

  it.each(realCLevel)("still recognises %s as C-level", (title) => {
    expect(isCLevelTitle(title)).toBe(true);
  });

  const seniorButNotCLevel = [
    "VP Payments",
    "VP, Engineering",
    "Head of Digital",
    "head of cyber defense center",
    "Head of Omnichannel Banking",
    "SVP Operations",
    "EVP, Chief Information and Data Officer",
    'סמנכ"ל כספים',
  ];

  it.each(seniorButNotCLevel)("recognises %s as senior", (title) => {
    expect(isSeniorTitle(title)).toBe(true);
  });

  it("keeps the documented Hebrew deputy exclusion for the C-level tier", () => {
    // סמנכ"ל contains מנכ"ל; the deputy is senior but not top-tier.
    expect(isCLevelTitle('סמנכ"ל כספים')).toBe(false);
    expect(isSeniorTitle('סמנכ"ל כספים')).toBe(true);
  });

  it("handles null, undefined and empty titles", () => {
    for (const t of [null, undefined, "", "   "]) {
      expect(isCLevelTitle(t)).toBe(false);
      expect(isSeniorTitle(t)).toBe(false);
    }
  });
});
