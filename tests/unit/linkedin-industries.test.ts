import { describe, it, expect } from "vitest";
import { LINKEDIN_INDUSTRIES, INDUSTRY_BY_ID } from "@/lib/prospecting/industries";

describe("LINKEDIN_INDUSTRIES", () => {
  it("contains the full V2 taxonomy", () => {
    expect(LINKEDIN_INDUSTRIES.length).toBeGreaterThanOrEqual(400);
  });

  it("has unique ids", () => {
    const ids = new Set(LINKEDIN_INDUSTRIES.map((i) => i.id));
    expect(ids.size).toBe(LINKEDIN_INDUSTRIES.length);
  });

  it("matches facet ids verified against the live LinkedIn UI", () => {
    expect(INDUSTRY_BY_ID.get("4")?.label).toBe("Software Development");
    expect(INDUSTRY_BY_ID.get("1594")?.label).toBe("Technology, Information and Media");
    expect(INDUSTRY_BY_ID.get("14")?.label).toBe("Hospitals and Health Care");
    expect(INDUSTRY_BY_ID.get("6")?.label).toBe("Technology, Information and Internet");
  });

  it("keeps the hierarchy path for sub-industries", () => {
    // 96 = IT Services and IT Consulting, child of Professional Services
    expect(INDUSTRY_BY_ID.get("96")?.path).toBe("Professional Services > IT Services and IT Consulting");
  });
});
