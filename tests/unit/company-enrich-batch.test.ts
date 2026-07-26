import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { enrichCompaniesViaOpenRouter } from "@/lib/enrichment/openrouter-search";

function orResponse(companies: Array<Record<string, unknown>>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      choices: [{ message: { content: JSON.stringify({ companies }) } }],
    }),
  });
}

describe("enrichCompaniesViaOpenRouter", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("makes ONE call for many companies and keys results by id", async () => {
    mockFetch.mockReturnValueOnce(orResponse([
      { id: "a", staffCount: 4500, industry: "Cybersecurity", vertical: "Cybersecurity", confidence: "high" },
      { id: "b", staffCount: null, industry: "Fintech", vertical: "Fintech", confidence: "low" },
    ]));

    const out = await enrichCompaniesViaOpenRouter([
      { id: "a", name: "Acme" },
      { id: "b", name: "Beta" },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1); // batched, not one-per-company
    expect(out.get("a")?.staffCount).toBe(4500);
    expect(out.get("a")?.confidence).toBe("high");
    expect(out.get("b")?.industry).toBe("Fintech");
  });

  it("omits companies the model did not return", async () => {
    mockFetch.mockReturnValueOnce(orResponse([
      { id: "a", industry: "SaaS", confidence: "high" },
    ]));
    const out = await enrichCompaniesViaOpenRouter([
      { id: "a", name: "Acme" },
      { id: "b", name: "Ghost" },
    ]);
    expect(out.has("a")).toBe(true);
    expect(out.has("b")).toBe(false); // caller marks these attempted
  });

  it("makes no call for empty input", async () => {
    const out = await enrichCompaniesViaOpenRouter([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(out.size).toBe(0);
  });

  it("throws on 429 so the caller can retry the step", async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 429 }));
    await expect(
      enrichCompaniesViaOpenRouter([{ id: "a", name: "Acme" }]),
    ).rejects.toThrow(/429/);
  });

  it("returns an empty map on unparseable output without throwing", async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "not json" } }] }),
    }));
    const out = await enrichCompaniesViaOpenRouter([{ id: "a", name: "Acme" }]);
    expect(out.size).toBe(0);
  });

  it("returns an empty map when OPENROUTER_API_KEY is unset", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const out = await enrichCompaniesViaOpenRouter([{ id: "a", name: "Acme" }]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(out.size).toBe(0);
  });
});
