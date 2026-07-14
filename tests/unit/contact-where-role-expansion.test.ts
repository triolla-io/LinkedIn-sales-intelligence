import { describe, it, expect } from "vitest";
import { titleCondition, buildContactWhere } from "@/lib/contacts/contact-where";

// Collect every `contains` string used anywhere in a Prisma condition tree.
function containsTerms(node: any): string[] {
  if (!node || typeof node !== "object") return [];
  const terms: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "contains" && typeof value === "string") terms.push(value.toLowerCase());
    else terms.push(...containsTerms(value));
  }
  return terms;
}

describe("titleCondition role expansion", () => {
  it("expands a role pill to its whole family", () => {
    const terms = containsTerms(titleCondition("CPO"));
    expect(terms).toContain("chief product officer");
    expect(terms).toContain("head of product");
    expect(terms).toContain('סמנכ"ל מוצר');
    expect(terms).toContain("cpo"); // literal always kept
  });

  it("keeps plain substring behavior for unknown titles", () => {
    const cond = titleCondition("Underwater Basket Weaver");
    expect(cond.OR).toHaveLength(2); // currentTitle + headline only
    expect(containsTerms(cond)).toEqual([
      "underwater basket weaver",
      "underwater basket weaver",
    ]);
  });
});

describe("buildContactWhere q expansion", () => {
  it("widens a role-like q with family patterns on title/headline", () => {
    const where = buildContactWhere("u1", { q: "CPO" });
    const qOr = where.AND[0].OR;
    const terms = containsTerms(qOr);
    expect(terms).toContain("chief product officer");
    // literal clauses stay: name + company still match the raw query
    expect(qOr[0]).toEqual({ fullName: { contains: "CPO", mode: "insensitive" } });
    expect(qOr[2]).toEqual({ currentCompany: { contains: "CPO", mode: "insensitive" } });
  });

  it("expands Hebrew role queries", () => {
    const where = buildContactWhere("u1", { q: "סמנכ״ל מוצר" });
    expect(containsTerms(where.AND[0].OR)).toContain("chief product officer");
  });

  it("leaves non-role queries exactly as before", () => {
    const where = buildContactWhere("u1", { q: "acme" });
    expect(where.AND[0].OR).toHaveLength(4); // fullName, headline, company, title
  });

  it("always scopes by ownerId", () => {
    expect(buildContactWhere("u1", { q: "CPO" }).ownerId).toBe("u1");
  });
});
