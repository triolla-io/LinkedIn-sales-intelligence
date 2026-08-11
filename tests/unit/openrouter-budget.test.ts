import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  evaluateBudget,
  openrouterChat,
  DEFAULT_DAILY_BUDGET_USD,
  OpenRouterBlockedError,
} from "@/lib/openrouter/client";

describe("evaluateBudget", () => {
  it("allows a normal call under the default budget", () => {
    const d = evaluateBudget({ enabledEnv: undefined, budgetEnv: undefined, spentTodayUsd: 0.5 });
    expect(d.blocked).toBe(false);
  });

  it("blocks when the kill-switch is off", () => {
    const d = evaluateBudget({ enabledEnv: "false", budgetEnv: undefined, spentTodayUsd: 0 });
    expect(d.blocked).toBe(true);
    if (d.blocked) expect(d.reason).toContain("OPENROUTER_ENABLED");
  });

  it("blocks once today's spend reaches the budget", () => {
    const d = evaluateBudget({ enabledEnv: undefined, budgetEnv: "2", spentTodayUsd: 2.0 });
    expect(d.blocked).toBe(true);
    if (d.blocked) expect(d.reason).toContain("budget");
  });

  it("allows spend just under a custom budget", () => {
    const d = evaluateBudget({ enabledEnv: "true", budgetEnv: "5", spentTodayUsd: 4.99 });
    expect(d.blocked).toBe(false);
  });

  it("falls back to the default budget on an unparseable env value", () => {
    const under = evaluateBudget({ enabledEnv: undefined, budgetEnv: "abc", spentTodayUsd: DEFAULT_DAILY_BUDGET_USD - 0.01 });
    expect(under.blocked).toBe(false);
    const over = evaluateBudget({ enabledEnv: undefined, budgetEnv: "abc", spentTodayUsd: DEFAULT_DAILY_BUDGET_USD });
    expect(over.blocked).toBe(true);
  });

  it("treats a zero or negative budget as fully blocked", () => {
    const d = evaluateBudget({ enabledEnv: undefined, budgetEnv: "0", spentTodayUsd: 0 });
    expect(d.blocked).toBe(true);
  });
});

describe("openrouterChat", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_ENABLED;
    delete process.env.OPENROUTER_DAILY_BUDGET_USD;
  });

  it("throws OpenRouterBlockedError on the kill-switch without spending", async () => {
    process.env.OPENROUTER_ENABLED = "false";
    await expect(openrouterChat("test-feature", { model: "m", messages: [] })).rejects.toThrow(
      OpenRouterBlockedError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws OpenRouterBlockedError when the daily budget is exhausted", async () => {
    process.env.OPENROUTER_DAILY_BUDGET_USD = "0";
    await expect(openrouterChat("test-feature", { model: "m", messages: [] })).rejects.toThrow(
      OpenRouterBlockedError
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes the body through with usage accounting and returns the data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: "hi" } }], usage: { cost: 0.001 } }),
    });
    const res = await openrouterChat("test-feature", { model: "m", messages: [{ role: "user", content: "x" }] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.choices?.[0]?.message?.content).toBe("hi");
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sent.usage).toEqual({ include: true });
    expect(sent.model).toBe("m");
  });

  it("returns ok:false with the body detail on an HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: () => Promise.resolve("Insufficient credits"),
    });
    const res = await openrouterChat("test-feature", { model: "m", messages: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(402);
      expect(res.detail).toContain("Insufficient credits");
    }
  });
});
