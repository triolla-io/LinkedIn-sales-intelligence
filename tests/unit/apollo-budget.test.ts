import { describe, it, expect } from "vitest";

// ── inline implementations for unit testing (no Prisma) ──────────────────────

interface MockSpend {
  credits: number;
}

function checkBudgetLogic(
  monthlyLimit: number,
  spend: MockSpend | null
): { allowed: boolean; creditsUsed: number; creditsRemaining: number } {
  const creditsUsed = spend?.credits ?? 0;
  const allowed = creditsUsed < monthlyLimit;
  return { allowed, creditsUsed, creditsRemaining: Math.max(0, monthlyLimit - creditsUsed) };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("checkBudget logic", () => {
  it("allows when no spend record exists", () => {
    const result = checkBudgetLogic(500, null);
    expect(result.allowed).toBe(true);
    expect(result.creditsUsed).toBe(0);
    expect(result.creditsRemaining).toBe(500);
  });

  it("allows when credits used is below limit", () => {
    const result = checkBudgetLogic(500, { credits: 100 });
    expect(result.allowed).toBe(true);
    expect(result.creditsRemaining).toBe(400);
  });

  it("allows when credits used is exactly one below limit", () => {
    const result = checkBudgetLogic(500, { credits: 499 });
    expect(result.allowed).toBe(true);
    expect(result.creditsRemaining).toBe(1);
  });

  it("blocks when credits used equals limit", () => {
    const result = checkBudgetLogic(500, { credits: 500 });
    expect(result.allowed).toBe(false);
    expect(result.creditsRemaining).toBe(0);
  });

  it("blocks when credits used exceeds limit", () => {
    const result = checkBudgetLogic(500, { credits: 600 });
    expect(result.allowed).toBe(false);
    expect(result.creditsRemaining).toBe(0);
  });

  it("handles zero budget", () => {
    const result = checkBudgetLogic(0, null);
    expect(result.allowed).toBe(false);
    expect(result.creditsRemaining).toBe(0);
  });

  it("handles zero credits used with non-zero limit", () => {
    const result = checkBudgetLogic(10, { credits: 0 });
    expect(result.allowed).toBe(true);
    expect(result.creditsRemaining).toBe(10);
  });
});
