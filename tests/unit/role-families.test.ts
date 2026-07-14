import { describe, it, expect } from "vitest";
import { expandRoleQuery, normalizeRoleQuery } from "@/lib/roles/families";
import { ROLE_PILLS } from "@/lib/contacts/filter-options";

describe("normalizeRoleQuery", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeRoleQuery("  VP   Product ")).toBe("vp product");
  });

  it("strips ASCII quotes and Hebrew gershayim/geresh", () => {
    expect(normalizeRoleQuery('סמנכ"ל מוצר')).toBe("סמנכל מוצר");
    expect(normalizeRoleQuery("סמנכ״ל מוצר")).toBe("סמנכל מוצר");
  });
});

describe("expandRoleQuery", () => {
  it("expands CPO to the product-leadership family", () => {
    const patterns = expandRoleQuery("CPO");
    expect(patterns).not.toBeNull();
    expect(patterns).toContain("chief product officer");
    expect(patterns).toContain("head of product");
    expect(patterns).toContain('סמנכ"ל מוצר');
  });

  it("expands 'vp product' to the same family as CPO", () => {
    expect(expandRoleQuery("vp product")).toEqual(expandRoleQuery("CPO"));
  });

  it("matches Hebrew triggers with either quote style", () => {
    expect(expandRoleQuery('סמנכ"ל מוצר')).not.toBeNull();
    expect(expandRoleQuery("סמנכ״ל מוצר")).not.toBeNull();
  });

  it("emits gershayim variants so DB text in either style matches", () => {
    const patterns = expandRoleQuery("CPO")!;
    expect(patterns).toContain('סמנכ"ל מוצר'); // ASCII quote
    expect(patterns).toContain("סמנכ״ל מוצר"); // U+05F4 gershayim
    expect(patterns).toContain("סמנכל מוצר"); // no quote at all
  });

  it("returns null for non-role queries", () => {
    expect(expandRoleQuery("john smith")).toBeNull();
    expect(expandRoleQuery("acme")).toBeNull();
    expect(expandRoleQuery("")).toBeNull();
  });

  it("covers every titleSearch pill value", () => {
    for (const pill of ROLE_PILLS.filter((p) => p.filterKey === "titleSearch")) {
      expect(expandRoleQuery(pill.value), `pill ${pill.label}`).not.toBeNull();
    }
  });

  it("expands CEO family with Hebrew variants", () => {
    const patterns = expandRoleQuery("CEO")!;
    expect(patterns).toContain("chief executive officer");
    expect(patterns).toContain('מנכ"ל');
  });
});
