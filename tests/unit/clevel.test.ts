import { describe, it, expect } from "vitest";
import { isCLevelTitle, clevelTitleWhere } from "@/lib/company-signals/clevel";

describe("isCLevelTitle", () => {
  it("matches English C-level titles", () => {
    expect(isCLevelTitle("Chief Executive Officer")).toBe(true);
    expect(isCLevelTitle("CTO & Co-Founder")).toBe(true);
    expect(isCLevelTitle("VP Finance")).toBe(true);
    expect(isCLevelTitle("Head of Product")).toBe(true);
  });
  it("matches Hebrew C-level titles", () => {
    expect(isCLevelTitle('סמנכ"ל כספים')).toBe(true);
    expect(isCLevelTitle("מייסד")).toBe(true);
  });
  it("rejects non-exec titles and empty", () => {
    expect(isCLevelTitle("Software Engineer")).toBe(false);
    expect(isCLevelTitle(null)).toBe(false);
    expect(isCLevelTitle("")).toBe(false);
  });
  it("clevelTitleWhere returns a Prisma OR clause", () => {
    const w = clevelTitleWhere();
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.OR[0]).toHaveProperty("currentTitle.mode", "insensitive");
  });
});
