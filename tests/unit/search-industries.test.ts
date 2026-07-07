import { describe, it, expect } from "vitest";
import { searchIndustries } from "@/lib/prospecting/search-industries";

describe("searchIndustries", () => {
  it("returns empty for a blank query", () => {
    expect(searchIndustries("   ")).toEqual([]);
  });

  it("matches case-insensitively and ranks label-prefix matches first", () => {
    const results = searchIndustries("health", 50);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].label.toLowerCase().startsWith("health")).toBe(true);
    expect(results.some((r) => r.label === "Hospitals and Health Care")).toBe(true);
  });

  it("matches on the hierarchy path too", () => {
    // "IT Services and IT Consulting" lives under Professional Services
    const results = searchIndustries("professional services", 50);
    expect(results.some((r) => r.id === "96")).toBe(true);
  });

  it("caps results at the limit", () => {
    expect(searchIndustries("a", 8).length).toBeLessThanOrEqual(8);
  });
});
