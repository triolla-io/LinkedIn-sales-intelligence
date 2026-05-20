import { describe, it, expect } from "vitest";
import { slugifyCompany } from "@/lib/utils/slug-utils";

describe("slugifyCompany", () => {
  it.each([
    ["Microsoft", "microsoft"],
    ["Google LLC", "google-llc"],
    ["Deloitte & Touche", "deloitte-touche"],
    ["Acme Corp.", "acme-corp"],
    ["  Spaces  Around  ", "spaces-around"],
    ["McKinsey & Company", "mckinsey-company"],
    ["Y Combinator", "y-combinator"],
    ["3M", "3m"],
    ["", ""],
  ])("slugifies %s → %s", (input, expected) => {
    expect(slugifyCompany(input)).toBe(expected);
  });
});
