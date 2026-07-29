import { describe, it, expect } from "vitest";
import {
  expandRoleQuery,
  normalizeRoleQuery,
  ROLE_FAMILIES,
  resolveRoleFamily,
  expandTitleToSearchTerms,
  familyHeadlineMatches,
} from "@/lib/roles/families";
import { ROLE_PILLS } from "@/lib/contacts/filter-options";

describe("normalizeRoleQuery", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeRoleQuery("  VP   Product ")).toBe("vp product");
  });

  it("strips ASCII quotes and Hebrew gershayim/geresh", () => {
    expect(normalizeRoleQuery('סמנכ"ל מוצר')).toBe("סמנכל מוצר");
    expect(normalizeRoleQuery("סמנכ״ל מוצר")).toBe("סמנכל מוצר");
  });

  it("strips curly double quote U+201D", () => {
    expect(normalizeRoleQuery("סמנכ”ל מוצר")).toBe("סמנכל מוצר");
  });

  it("strips curly apostrophe U+2019", () => {
    expect(normalizeRoleQuery("מנכ’ל")).toBe("מנכל");
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

describe("ROLE_FAMILIES integrity", () => {
  it("no two families share a normalized trigger", () => {
    const allNormalized = ROLE_FAMILIES.flatMap((f) =>
      f.triggers.map((t) => normalizeRoleQuery(t))
    );
    const unique = new Set(allNormalized);
    const duplicates = allNormalized.filter(
      (t, i) => allNormalized.indexOf(t) !== i
    );
    expect(
      allNormalized.length,
      `Duplicate normalized triggers found: ${[...new Set(duplicates)].join(", ")}`
    ).toBe(unique.size);
  });
});

describe("resolveRoleFamily", () => {
  it("resolves an acronym to its family", () => {
    expect(resolveRoleFamily("CFO")?.key).toBe("FINANCE_LEADERSHIP");
  });
  it("resolves a VP/Head-of search term to the same family", () => {
    expect(resolveRoleFamily("VP Finance")?.key).toBe("FINANCE_LEADERSHIP");
    expect(resolveRoleFamily("Head of Finance")?.key).toBe("FINANCE_LEADERSHIP");
  });
  it("resolves a Hebrew title (any quote style) to its family", () => {
    expect(resolveRoleFamily('מנכ"ל')?.key).toBe("CEO_FOUNDER");
    expect(resolveRoleFamily("מנכ״ל")?.key).toBe("CEO_FOUNDER");
  });
  it("returns null for an unknown title", () => {
    expect(resolveRoleFamily("Growth Hacker")).toBeNull();
    expect(resolveRoleFamily("")).toBeNull();
  });
});

describe("expandTitleToSearchTerms", () => {
  it("expands a C-level title to its family's curated search terms", () => {
    expect(expandTitleToSearchTerms("CFO")).toEqual([
      "CFO",
      "VP Finance",
      "Head of Finance",
    ]);
  });
  it("expands Hebrew input to English search terms instead of dropping it", () => {
    expect(expandTitleToSearchTerms('מנכ"ל')).toEqual(["CEO", "Founder"]);
  });
  it("returns null for an unknown title", () => {
    expect(expandTitleToSearchTerms("Growth Hacker")).toBeNull();
  });
});

describe("familyHeadlineMatches", () => {
  const finance = ROLE_FAMILIES.find((f) => f.key === "FINANCE_LEADERSHIP")!;
  const ops = ROLE_FAMILIES.find((f) => f.key === "OPERATIONS_LEADERSHIP")!;

  it("accepts the exact acronym in a headline", () => {
    expect(familyHeadlineMatches(finance, "CFO at Acme")).toBe(true);
  });
  it("accepts a VP/Head-of variant of the same function", () => {
    expect(familyHeadlineMatches(finance, "VP Finance, Acme")).toBe(true);
    expect(familyHeadlineMatches(finance, "Head of Finance")).toBe(true);
  });
  it("accepts a Hebrew variant of the same function", () => {
    expect(familyHeadlineMatches(finance, 'סמנכ"ל כספים בחברת אקמי')).toBe(true);
    expect(familyHeadlineMatches(finance, "סמנכ״ל כספים")).toBe(true);
  });
  it("does NOT match a short acronym inside an unrelated word", () => {
    // OPS family has the "coo" pattern; it must not fire on "cool".
    expect(familyHeadlineMatches(ops, "Founder of a cool startup")).toBe(false);
  });
  it("rejects an unrelated headline", () => {
    expect(familyHeadlineMatches(finance, "Software Engineer")).toBe(false);
    expect(familyHeadlineMatches(finance, "")).toBe(false);
  });
});

describe("ROLE_FAMILIES searchTerms invariant", () => {
  it("every searchTerm resolves back to its own family", () => {
    for (const family of ROLE_FAMILIES) {
      expect(family.searchTerms.length, `${family.key} has searchTerms`).toBeGreaterThan(0);
      for (const term of family.searchTerms) {
        expect(resolveRoleFamily(term)?.key, `${family.key}: "${term}"`).toBe(family.key);
      }
    }
  });
  it("every searchTerm is pure ASCII (LinkedIn URL search is Latin-only)", () => {
    for (const family of ROLE_FAMILIES) {
      for (const term of family.searchTerms) {
        for (const ch of term) {
          expect(ch.charCodeAt(0), `${family.key}: "${term}"`).toBeLessThanOrEqual(127);
        }
      }
    }
  });
});
