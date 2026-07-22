import { describe, it, expect } from "vitest";
import { buildCandidateWhere, CANDIDATE_CAP } from "@/lib/fintech-radar/match";

describe("buildCandidateWhere", () => {
  it("always scopes to the owner, non-removed, C-level", () => {
    const w = buildCandidateWhere("owner1", { topics: [], mentionedCompanies: [], relevantRoles: [] }) as any;
    expect(w.ownerId).toBe("owner1");
    expect(w.removedAt).toBeNull();
    expect(Array.isArray(w.OR)).toBe(true); // clevelTitleWhere OR terms
  });
  it("adds a company-name OR clause when companies are present", () => {
    const w = buildCandidateWhere("o", { topics: [], mentionedCompanies: ["Stripe"], relevantRoles: [] }) as any;
    const json = JSON.stringify(w);
    expect(json).toContain("Stripe");
  });
  it("caps candidates at 25", () => {
    expect(CANDIDATE_CAP).toBe(25);
  });
});
