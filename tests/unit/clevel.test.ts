import { describe, it, expect } from "vitest";
import {
  isCLevelTitle,
  clevelTitleWhere,
  seniorTitleWhere,
  CLEVEL_TITLE_TERMS,
  SENIOR_TITLE_TERMS,
} from "@/lib/company-signals/clevel";

describe("isCLevelTitle", () => {
  it("matches top-rank English titles", () => {
    expect(isCLevelTitle("Chief Executive Officer")).toBe(true);
    expect(isCLevelTitle("CTO & Co-Founder")).toBe(true);
    expect(isCLevelTitle("Managing Director")).toBe(true);
    expect(isCLevelTitle("Owner")).toBe(true);
  });
  it("matches top-rank Hebrew titles", () => {
    expect(isCLevelTitle('מנכ"ל')).toBe(true);
    expect(isCLevelTitle("מייסד")).toBe(true);
    expect(isCLevelTitle('משנה למנכ"ל')).toBe(true);
  });
  it("rejects VP / head-of level (top ranks only — 2026-08-10 decision)", () => {
    expect(isCLevelTitle("VP Finance")).toBe(false);
    expect(isCLevelTitle("Head of Product")).toBe(false);
    expect(isCLevelTitle("SVP Engineering")).toBe(false);
    expect(isCLevelTitle('סמנכ"ל כספים')).toBe(false);
  });
  it("rejects non-exec titles and empty", () => {
    expect(isCLevelTitle("Software Engineer")).toBe(false);
    expect(isCLevelTitle(null)).toBe(false);
    expect(isCLevelTitle("")).toBe(false);
  });
});

describe("title where clauses", () => {
  it("clevelTitleWhere returns a Prisma OR clause over top ranks only", () => {
    const w = clevelTitleWhere();
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.OR).toHaveLength(CLEVEL_TITLE_TERMS.length);
    expect(w.OR[0]).toHaveProperty("currentTitle.mode", "insensitive");
    const terms = w.OR.flatMap((c) =>
      "currentTitle" in c ? [c.currentTitle.contains] : []
    );
    expect(terms).not.toContain("vp ");
    expect(terms).not.toContain("head of");
  });
  it('clevelTitleWhere guards מנכ"ל against matching סמנכ"ל', () => {
    const w = clevelTitleWhere();
    const guarded = w.OR.find((c) => "AND" in c);
    expect(guarded).toBeDefined();
    if (guarded && "AND" in guarded) {
      expect(guarded.AND[0].currentTitle.contains).toBe('מנכ"ל');
      expect(guarded.AND[1].NOT.currentTitle.contains).toBe("סמנכ");
    }
  });
  it("seniorTitleWhere additionally covers VP / head-of level (fintech radar)", () => {
    const w = seniorTitleWhere();
    expect(w.OR).toHaveLength(SENIOR_TITLE_TERMS.length);
    const terms = w.OR.map((c) => c.currentTitle.contains);
    expect(terms).toContain("vp ");
    expect(terms).toContain("head of");
    expect(terms).toContain('סמנכ"ל');
  });
});
