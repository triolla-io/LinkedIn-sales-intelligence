import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * A timeout is an answer, not an exception.
 *
 * openrouterChat wrapped its fetch in try/finally with no catch, so an AbortError from the
 * timeout — or any network failure — propagated out. Every caller checks `res.ok` and none
 * expects a throw, so on 2026-08-26 one slow call took down a whole preview run after the
 * three employer-research calls before it had already been paid for. The brain's prompt had
 * grown to five stages and 5000 max_tokens and simply needed longer than 30 seconds.
 *
 * OpenRouterBlockedError is deliberately NOT swallowed: the kill-switch and the daily cap
 * throw before the request, and they have to keep failing loudly.
 */
describe("openrouterChat on a timeout", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.OPENROUTER_ENABLED;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false instead of throwing when the request aborts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })));
    const { openrouterChat } = await import("@/lib/openrouter/client");
    const r = await openrouterChat("tech-radar-person-profile", { model: "m", messages: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/abort/i);
  });

  it("returns ok:false on an ordinary network failure too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const { openrouterChat } = await import("@/lib/openrouter/client");
    const r = await openrouterChat("tech-radar-triage", { model: "m", messages: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("ECONNRESET");
  });

  it("still THROWS when the kill-switch blocks the call", async () => {
    process.env.OPENROUTER_ENABLED = "false";
    vi.stubGlobal("fetch", vi.fn());
    const { openrouterChat, OpenRouterBlockedError } = await import("@/lib/openrouter/client");
    await expect(openrouterChat("f", { model: "m", messages: [] })).rejects.toBeInstanceOf(OpenRouterBlockedError);
  });
});
