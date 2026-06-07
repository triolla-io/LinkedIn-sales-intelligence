import { describe, it, expect } from "vitest";
import { decideCandidate, type ScrapedCard } from "@/lib/prospecting/filter";

const base: ScrapedCard = {
  urn: "ACoAA1",
  profileUrl: "https://www.linkedin.com/in/jane",
  name: "Jane",
  title: "CTO",
  company: "Acme",
  location: "Tel Aviv, Israel",
  degree: "2nd",
};
const ctx = { existingContactUrns: new Set<string>(), existingRequestUrns: new Set<string>() };

describe("decideCandidate", () => {
  it("inserts a clean 2nd-degree Israel card", () => {
    expect(decideCandidate(base, ctx)).toEqual({ action: "insert" });
  });
  it("skips an existing contact", () => {
    const c = { ...ctx, existingContactUrns: new Set(["ACoAA1"]) };
    expect(decideCandidate(base, c)).toEqual({ action: "skip", skipReason: "already_contact" });
  });
  it("skips someone already requested (idempotent re-scrape)", () => {
    const c = { ...ctx, existingRequestUrns: new Set(["ACoAA1"]) };
    expect(decideCandidate(base, c)).toEqual({ action: "skip", skipReason: "already_pending" });
  });
  it("skips a non-2nd-degree card", () => {
    expect(decideCandidate({ ...base, degree: "3rd" }, ctx)).toEqual({ action: "skip", skipReason: "not_2nd" });
  });
  it("skips a card not located in Israel", () => {
    expect(decideCandidate({ ...base, location: "Berlin, Germany" }, ctx)).toEqual({ action: "skip", skipReason: "not_israel" });
  });
  it("accepts Hebrew location text for Israel", () => {
    expect(decideCandidate({ ...base, location: "תל אביב, ישראל" }, ctx)).toEqual({ action: "insert" });
  });
});
