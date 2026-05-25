import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the logic by mocking fetch — no real HubSpot calls

function makeSearchResponse(email?: string, phone?: string) {
  return {
    ok: true,
    json: async () => ({
      results: email || phone
        ? [{ properties: { email: email ?? null, phone: phone ?? null } }]
        : [],
    }),
  };
}

function makeEmptyResponse() {
  return {
    ok: true,
    json: async () => ({ results: [] }),
  };
}

function makeErrorResponse() {
  return { ok: false, json: async () => ({}) };
}

describe("lookupContact", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.HUBSPOT_API_KEY;
    process.env.HUBSPOT_API_KEY = "test-token";
  });

  afterEach(() => {
    process.env.HUBSPOT_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("returns null immediately when HUBSPOT_API_KEY is not set", async () => {
    delete process.env.HUBSPOT_API_KEY;
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/test",
      fullName: "John Doe",
    });
    expect(result).toBeNull();
  });

  it("returns email and phone when found by LinkedIn URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeSearchResponse("john@example.com", "+972501234567"))
    );
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/john",
      fullName: "John Doe",
      company: "Acme",
    });
    expect(result).toEqual({ email: "john@example.com", phone: "+972501234567" });
  });

  it("falls back to name+company search when LinkedIn URL returns no match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeEmptyResponse()) // LinkedIn URL search
        .mockResolvedValueOnce(makeSearchResponse("jane@example.com", undefined)) // name+company
    );
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/jane",
      fullName: "Jane Smith",
      company: "Corp",
    });
    expect(result).toEqual({ email: "jane@example.com", phone: undefined });
  });

  it("returns null when both searches return no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeEmptyResponse())
    );
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/nobody",
      fullName: "Nobody Here",
    });
    expect(result).toBeNull();
  });

  it("returns null when contact found but has no email or phone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeSearchResponse(undefined, undefined))
    );
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/empty",
      fullName: "Empty Person",
    });
    expect(result).toBeNull();
  });

  it("returns null silently when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/error",
      fullName: "Error Person",
    });
    expect(result).toBeNull();
  });

  it("returns null silently when HubSpot returns non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse()));
    const { lookupContact } = await import("@/lib/hubspot/client");
    const result = await lookupContact({
      linkedinUrl: "https://linkedin.com/in/bad",
      fullName: "Bad Response",
    });
    expect(result).toBeNull();
  });
});
