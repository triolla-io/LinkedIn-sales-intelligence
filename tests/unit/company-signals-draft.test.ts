import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDraftJson } from "@/lib/company-signals/draft";

describe("parseDraftJson", () => {
  it("extracts message, strips fences", () => {
    expect(parseDraftJson('```json\n{"draftMessage":"מזל טוב!"}\n```')).toBe("מזל טוב!");
  });
  it("returns null for empty/missing", () => {
    expect(parseDraftJson('{"draftMessage":""}')).toBe(null);
    expect(parseDraftJson("garbage")).toBe(null);
  });
});

describe("draftCongrats", () => {
  const realFetch = global.fetch;
  beforeEach(() => { delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => { global.fetch = realFetch; });

  const input = {
    contactFullName: "Dana Cohen", hebrewFirstName: "דנה", contactTitle: "CEO",
    companyName: "Acme", signalType: "FUNDING", signalTitle: "Raised $10M", signalSummary: "Series A",
  };

  it("throws when OPENROUTER_API_KEY missing", async () => {
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    await expect(draftCongrats(input)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("returns the drafted message on success", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"draftMessage":"דנה, מזל טוב על הגיוס!"}' } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    expect(await draftCongrats(input)).toContain("מזל טוב");
  });
});
