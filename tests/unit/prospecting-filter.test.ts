import { describe, it, expect } from "vitest";
import { computeSendPriority, decideCandidate, type ScrapedCard } from "@/lib/prospecting/filter";

const base: ScrapedCard = {
  urn: "ACoAA1",
  profileUrl: "https://www.linkedin.com/in/jane",
  name: "Jane",
  headline: null,
  title: "CTO",
  company: "Acme",
  location: "Tel Aviv, Israel",
  degree: "2nd",
};
const ctx = { existingContactUrns: new Set<string>(), existingRequestUrns: new Set<string>() };

describe("decideCandidate", () => {
  it("inserts a clean 2nd-degree card", () => {
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

  // Regression for the live-test bug: the search URL already constrains to 2nd-degree + Israel
  // (network=["S"] + geoUrn), but the extension's card parsing is unreliable — degree and location
  // frequently come back null/garbled. The filter must NOT reject on those brittle fields, or it
  // rejects every real candidate (observed: Tel Aviv / JFrog Israel people skipped as not_israel).
  it("inserts when degree could not be parsed (null) — trusts the search-side 2nd-degree filter", () => {
    expect(decideCandidate({ ...base, degree: null }, ctx)).toEqual({ action: "insert" });
  });
  it("inserts when location could not be parsed (null) — trusts the search-side geo filter", () => {
    expect(decideCandidate({ ...base, location: null }, ctx)).toEqual({ action: "insert" });
  });
  it("inserts a 3rd-degree card (search is 2nd-only; extension handles non-connectable at runtime)", () => {
    expect(decideCandidate({ ...base, degree: "3rd" }, ctx)).toEqual({ action: "insert" });
  });

  // The only positive degree signal worth acting on: a 1st-degree connection is already connected,
  // so a connection request is pointless. (The search shouldn't return these, but guard anyway.)
  it("skips a 1st-degree connection as already_connected", () => {
    expect(decideCandidate({ ...base, degree: "1st" }, ctx)).toEqual({ action: "skip", skipReason: "already_connected" });
  });

  // Card action button pre-detection: "Pending" is a positive signal that an invite is already out.
  it("skips a card whose action button shows Pending", () => {
    expect(decideCandidate({ ...base, cardAction: "pending" }, ctx)).toEqual({ action: "skip", skipReason: "pending_on_linkedin" });
  });
  it("still inserts Follow/Message cards (they may be connectable via the More menu)", () => {
    expect(decideCandidate({ ...base, cardAction: "follow" }, ctx)).toEqual({ action: "insert" });
    expect(decideCandidate({ ...base, cardAction: "message" }, ctx)).toEqual({ action: "insert" });
  });
  it("inserts when cardAction is missing (older extension builds)", () => {
    expect(decideCandidate({ ...base, cardAction: undefined }, ctx)).toEqual({ action: "insert" });
  });
});

describe("computeSendPriority", () => {
  it("Connect card / unknown action → normal priority", () => {
    expect(computeSendPriority({ ...base, cardAction: "connect" })).toBe(0);
    expect(computeSendPriority({ ...base, cardAction: null })).toBe(0);
    expect(computeSendPriority(base)).toBe(0);
  });
  it("Follow / Following / Message cards → tried last", () => {
    expect(computeSendPriority({ ...base, cardAction: "follow" })).toBe(1);
    expect(computeSendPriority({ ...base, cardAction: "following" })).toBe(1);
    expect(computeSendPriority({ ...base, cardAction: "message" })).toBe(1);
  });
});
