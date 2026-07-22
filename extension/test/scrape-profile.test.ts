import { describe, it, expect } from "vitest";
import { parseProfileRole } from "../src/lib/scrape-profile";

describe("parseProfileRole", () => {
  it("picks the newest current role, not a stale current (Paz case)", () => {
    const entries = [
      { title: "Co-Founder", company: "Stealth AI Startup", current: true, startDate: "2025-01" },
      { title: "Instructor", company: "Sea-Gal", current: true, startDate: "2015-05" },
    ];
    expect(parseProfileRole(entries, null)).toEqual({ title: "Co-Founder", company: "Stealth AI Startup" });
  });
  it("falls back to the headline 'Title at Company' when no experience", () => {
    expect(parseProfileRole([], "VP Eng at Acme")).toEqual({ title: "VP Eng", company: "Acme" });
  });
  it("uses headline as title when there is no 'at'", () => {
    expect(parseProfileRole([], "Open to work")).toEqual({ title: "Open to work", company: null });
  });
});
