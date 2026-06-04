import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { translateNames } from "@/lib/enrichment/gemini-names";

function orResponse(names: { id: string; hebrewFirstName: string }[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify(names) } }],
    }),
  });
}

describe("translateNames", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("returns Hebrew names from OpenRouter", async () => {
    mockFetch.mockReturnValueOnce(orResponse([
      { id: "c1", hebrewFirstName: "ג'ון" },
      { id: "c2", hebrewFirstName: "רוברט" },
    ]));

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
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("returns empty array on JSON parse failure without throwing", async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "not json" } }] }),
    }));
    const result = await translateNames([{ id: "c1", firstName: "John" }]);
    expect(result).toEqual([]);
  });

  it("returns empty array when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await translateNames([{ id: "c1", firstName: "John" }]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
