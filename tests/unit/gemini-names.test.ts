import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    this.models = { generateContent: mockGenerateContent };
  }),
}));

import { translateNames } from "@/lib/enrichment/gemini-names";

describe("translateNames", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("returns Hebrew names from Gemini", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify([
        { id: "c1", hebrewFirstName: "ג'ון" },
        { id: "c2", hebrewFirstName: "רוברט" },
      ]),
    });

    const result = await translateNames([
      { id: "c1", firstName: "John" },
      { id: "c2", firstName: "Robert" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "c1", hebrewFirstName: "ג'ון" });
    expect(result[1]).toEqual({ id: "c2", hebrewFirstName: "רוברט" });
  });

  it("returns empty array for empty input", async () => {
    const result = await translateNames([]);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("returns empty array on JSON parse failure without throwing", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "not json" });
    const result = await translateNames([{ id: "c1", firstName: "John" }]);
    expect(result).toEqual([]);
  });

  it("returns empty array when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await translateNames([{ id: "c1", firstName: "John" }]);
    expect(result).toEqual([]);
  });
});
