import { describe, it, expect } from "vitest";
import { parseFeedFilter, matchesFilter } from "@/lib/job-check/feed-filter";

describe("parseFeedFilter", () => {
  it("passes through known values", () => {
    expect(parseFeedFilter("company")).toBe("company");
    expect(parseFeedFilter("role")).toBe("role");
    expect(parseFeedFilter("pending")).toBe("pending");
    expect(parseFeedFilter("all")).toBe("all");
  });
  it("defaults unknown/empty to 'all'", () => {
    expect(parseFeedFilter(null)).toBe("all");
    expect(parseFeedFilter(undefined)).toBe("all");
    expect(parseFeedFilter("garbage")).toBe("all");
  });
});

describe("matchesFilter", () => {
  const company = { changeType: "COMPANY_MOVE", status: "PENDING_REVIEW" } as const;
  const promotion = { changeType: "PROMOTION", status: "SENT" } as const;
  const titleChange = { changeType: "TITLE_CHANGE", status: "APPROVED" } as const;

  it("all matches everything", () => {
    expect(matchesFilter(company, "all")).toBe(true);
    expect(matchesFilter(promotion, "all")).toBe(true);
  });
  it("company matches only COMPANY_MOVE", () => {
    expect(matchesFilter(company, "company")).toBe(true);
    expect(matchesFilter(promotion, "company")).toBe(false);
  });
  it("role matches PROMOTION and TITLE_CHANGE", () => {
    expect(matchesFilter(promotion, "role")).toBe(true);
    expect(matchesFilter(titleChange, "role")).toBe(true);
    expect(matchesFilter(company, "role")).toBe(false);
  });
  it("pending matches only PENDING_REVIEW status", () => {
    expect(matchesFilter(company, "pending")).toBe(true);
    expect(matchesFilter(promotion, "pending")).toBe(false);
  });
});
