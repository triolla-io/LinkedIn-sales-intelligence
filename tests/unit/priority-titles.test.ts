import { describe, it, expect } from "vitest";
import { isPriorityTitle, priorityTitleWhere, PRIORITY_TITLE_TERMS } from "@/lib/job-check/priority-titles";

describe("priority titles", () => {
  it("matches known priority titles case-insensitively and as substrings", () => {
    expect(isPriorityTitle("VP Product")).toBe(true);
    expect(isPriorityTitle("Global VP Product, EMEA")).toBe(true);
    expect(isPriorityTitle("head of design")).toBe(true);
    expect(isPriorityTitle("Product Director")).toBe(true);
  });

  it("rejects non-priority titles", () => {
    expect(isPriorityTitle("Software Engineer")).toBe(false);
    expect(isPriorityTitle(null)).toBe(false);
    expect(isPriorityTitle(undefined)).toBe(false);
  });

  it("builds an OR of insensitive contains for Prisma", () => {
    const w = priorityTitleWhere();
    expect(w.OR).toHaveLength(PRIORITY_TITLE_TERMS.length);
    expect(w.OR[0]).toEqual({ currentTitle: { contains: PRIORITY_TITLE_TERMS[0], mode: "insensitive" } });
  });
});
