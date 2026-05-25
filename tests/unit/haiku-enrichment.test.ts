import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing the module under test
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { create: mockCreate };
    },
  };
});

import { enrichBatch, sizeRangeToMidpoint } from "@/lib/enrichment/haiku-enrichment";

function setupMockResponse(response: object[]) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify(response) }],
  });
}

describe("sizeRangeToMidpoint", () => {
  it("maps known ranges to midpoints", () => {
    expect(sizeRangeToMidpoint("1-50")).toBe(25);
    expect(sizeRangeToMidpoint("51-200")).toBe(125);
    expect(sizeRangeToMidpoint("201-1000")).toBe(600);
    expect(sizeRangeToMidpoint("1001-5000")).toBe(3000);
    expect(sizeRangeToMidpoint("5001+")).toBe(10000);
  });

  it("returns null for unknown range", () => {
    expect(sizeRangeToMidpoint("unknown")).toBeNull();
  });
});

describe("enrichBatch", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns Hebrew names and size ranges from Haiku", async () => {
    setupMockResponse([
      { id: "c1", hebrewFirstName: "דוד", companySizeRange: "51-200" },
      { id: "c2", hebrewFirstName: "שרה", companySizeRange: null },
    ]);

    const result = await enrichBatch([
      { id: "c1", firstName: "David", company: "Acme", needsHebrew: true, needsSize: true },
      { id: "c2", firstName: "Sarah", company: null, needsHebrew: true, needsSize: false },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "c1", hebrewFirstName: "דוד", companySizeRange: "51-200" });
    expect(result[1]).toEqual({ id: "c2", hebrewFirstName: "שרה", companySizeRange: null });
  });

  it("returns empty array on JSON parse failure without throwing", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json" }],
    });

    const result = await enrichBatch([
      { id: "c1", firstName: "David", company: "Acme", needsHebrew: true, needsSize: true },
    ]);

    expect(result).toEqual([]);
  });
});
