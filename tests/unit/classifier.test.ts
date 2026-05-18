import { describe, it, expect } from "vitest";
import { classify } from "@/lib/classifier/seniority";

describe("classify — seniority", () => {
  it.each([
    ["CEO", "C_LEVEL"],
    ["Chief Executive Officer", "C_LEVEL"],
    ["CTO", "C_LEVEL"],
    ["Founder & CEO", "C_LEVEL"],
    ["Co-Founder", "C_LEVEL"],
    ["VP Engineering", "VP"],
    ["VP of Sales", "VP"],
    ["Vice President, Marketing", "VP"],
    ["Director of Engineering", "DIRECTOR"],
    ["Head of Product", "DIRECTOR"],
    ["Engineering Manager", "MANAGER"],
    ["Senior Software Engineer", "MANAGER"],
    ["Lead Developer", "MANAGER"],
    ["Principal Engineer", "MANAGER"],
    ["Software Engineer III", "IC"],
    ["Account Executive", "IC"],
    ["Sales Development Representative", "IC"],
    ["", "IC"],
  ])("%s → %s", (title, expected) => {
    expect(classify(title).seniority).toBe(expected);
  });
});

describe("classify — function", () => {
  it.each([
    ["Senior Software Engineer", "ENGINEERING"],
    ["Director of Engineering", "ENGINEERING"],
    ["Frontend Developer", "ENGINEERING"],
    ["DevOps Engineer", "ENGINEERING"],
    ["VP Sales", "SALES"],
    ["Account Executive", "SALES"],
    ["SDR", "SALES"],
    ["Head of Marketing", "MARKETING"],
    ["Growth Manager", "MARKETING"],
    ["Product Manager", "PRODUCT"],
    ["Head of Product", "PRODUCT"],
    ["HR Manager", "HR"],
    ["Talent Acquisition Specialist", "HR"],
    ["CFO", "FINANCE"],
    ["FP&A Analyst", "FINANCE"],
    ["Director of Operations", "OPERATIONS"],
    ["General Counsel", "LEGAL"],
    ["Barista", "OTHER"],
  ])("%s → %s", (title, expected) => {
    expect(classify(title).function).toBe(expected);
  });
});

describe("classify — compound titles", () => {
  it("VP Sales → VP + SALES", () => {
    const r = classify("VP Sales");
    expect(r.seniority).toBe("VP");
    expect(r.function).toBe("SALES");
  });

  it("Director of Engineering → DIRECTOR + ENGINEERING", () => {
    const r = classify("Director of Engineering");
    expect(r.seniority).toBe("DIRECTOR");
    expect(r.function).toBe("ENGINEERING");
  });

  it("CEO → C_LEVEL + OTHER (no function keyword)", () => {
    const r = classify("CEO");
    expect(r.seniority).toBe("C_LEVEL");
    expect(r.function).toBe("OTHER");
  });
});
