import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * No test spends money. Twice on 2026-08-26 a suite billed the account unannounced: the
 * build-profiles integration test mocked four modules but not the rationale gate, so
 * `gateRationales` called OpenRouter on every run; and the v2 acceptance file called live
 * models by design, with a 120-second timeout, on a plain `npm test`.
 *
 * The enforcement is in the client and not in a list of required mocks, because a list is
 * the thing you forget when you add the next test.
 *
 * The predicate is "would this reach the real network", not "are we in a test": a suite
 * that stubs `fetch` with a vitest mock is already safe, and there are four such files
 * whose subject IS a module that calls openrouterChat. Only an unstubbed call is refused.
 */
const REAL_FETCH = globalThis.fetch;

describe("the test-money guard", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.RADAR_LIVE_LLM;
  });

  afterEach(() => {
    delete process.env.RADAR_LIVE_LLM;
    vi.unstubAllGlobals();
    globalThis.fetch = REAL_FETCH;
  });

  it("refuses a call that would reach the real network, before any request", async () => {
    const { openrouterChat } = await import("@/lib/openrouter/client");
    await expect(openrouterChat("some-feature", { model: "m", messages: [] })).rejects.toThrow(
      /RADAR_LIVE_LLM/
    );
  });

  it("names the feature, so the offending test is findable from the failure alone", async () => {
    const { openrouterChat } = await import("@/lib/openrouter/client");
    await expect(openrouterChat("tech-radar-rationale-gate", { model: "m", messages: [] })).rejects.toThrow(
      /tech-radar-rationale-gate/
    );
  });

  it("allows the call when fetch is stubbed — nothing leaves the process", async () => {
    const stub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} }),
    });
    vi.stubGlobal("fetch", stub);
    const { openrouterChat } = await import("@/lib/openrouter/client");
    const r = await openrouterChat("some-feature", { model: "m", messages: [] });
    expect(r.ok).toBe(true);
    expect(stub).toHaveBeenCalled();
  });

  it("allows a real call only when the environment explicitly asks to spend money", async () => {
    // A PLAIN function, not vi.fn(): it has no `.mock`, so the stubbed-fetch exemption does
    // not apply and the flag is genuinely what decides. It never reaches the network.
    let reached = false;
    globalThis.fetch = (async () => {
      reached = true;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const { openrouterChat } = await import("@/lib/openrouter/client");

    // The refusal THROWS rather than returning ok:false: a forgotten mock is a defect in the
    // test, not a runtime condition the caller should handle.
    await expect(openrouterChat("some-feature", { model: "m", messages: [] })).rejects.toThrow(
      /RADAR_LIVE_LLM/
    );
    expect(reached).toBe(false);

    process.env.RADAR_LIVE_LLM = "1";
    vi.resetModules();
    const { openrouterChat: allowed } = await import("@/lib/openrouter/client");
    const r = await allowed("some-feature", { model: "m", messages: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("ECONNREFUSED");
    expect(reached).toBe(true);
  });
});
