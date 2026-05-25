import { describe, it, expect } from "vitest";
import { lookupHebrew } from "@/lib/enrichment/name-lookup";

describe("lookupHebrew", () => {
  it("returns Hebrew for known names (case-insensitive)", () => {
    expect(lookupHebrew("David")).toBe("דוד");
    expect(lookupHebrew("david")).toBe("דוד");
    expect(lookupHebrew("DAVID")).toBe("דוד");
    expect(lookupHebrew("Sarah")).toBe("שרה");
    expect(lookupHebrew("Michael")).toBe("מיכאל");
    expect(lookupHebrew("Daniel")).toBe("דניאל");
    expect(lookupHebrew("Jonathan")).toBe("יונתן");
    expect(lookupHebrew("Rachel")).toBe("רחל");
  });

  it("returns null for unknown names", () => {
    expect(lookupHebrew("Zzzyxq")).toBeNull();
    expect(lookupHebrew("")).toBeNull();
  });
});
