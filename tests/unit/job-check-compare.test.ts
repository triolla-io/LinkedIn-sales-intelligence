import { describe, it, expect } from "vitest";
import { normalizeCompany, normalizeTitle } from "@/lib/job-check/compare";

describe("normalizeCompany", () => {
  it("equates casing variants", () => {
    expect(normalizeCompany("AQUATIS")).toBe(normalizeCompany("Aquatis"));
    expect(normalizeCompany("DYNAMIC INFRASTRUCTURE")).toBe(
      normalizeCompany("Dynamic Infrastructure")
    );
  });

  it("strips legal suffixes", () => {
    expect(normalizeCompany("Aquatis Ltd.")).toBe("aquatis");
    expect(normalizeCompany("Acme Company Ltd")).toBe("acme");
    expect(normalizeCompany("Foo, Inc.")).toBe("foo");
  });

  it("strips Hebrew בע\"מ", () => {
    expect(normalizeCompany('אגד בע"מ')).toBe(normalizeCompany("אגד"));
  });

  it("unifies & with 'and'", () => {
    expect(normalizeCompany("Johnson & Johnson")).toBe(
      normalizeCompany("Johnson and Johnson")
    );
  });

  it("keeps genuinely different names different (these go to the LLM judge)", () => {
    expect(normalizeCompany("Egged Israel Transport Cooperative Society Ltd")).not.toBe(
      normalizeCompany("Egged Transportation Company Ltd")
    );
    expect(normalizeCompany("Bank Hapoalim")).not.toBe(normalizeCompany("Bank Leumi"));
  });

  it("never strips a name down to nothing", () => {
    expect(normalizeCompany("Company Ltd")).toBe("company");
  });

  it("returns empty string for null/blank", () => {
    expect(normalizeCompany(null)).toBe("");
    expect(normalizeCompany("   ")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("equates casing/punctuation variants", () => {
    expect(normalizeTitle("VP, R&D")).toBe(normalizeTitle("VP R and D"));
    expect(normalizeTitle("CEO")).toBe(normalizeTitle("ceo"));
  });

  it("keeps different titles different (LLM decides)", () => {
    expect(normalizeTitle("CEO")).not.toBe(normalizeTitle("Chief Executive Officer"));
  });
});
