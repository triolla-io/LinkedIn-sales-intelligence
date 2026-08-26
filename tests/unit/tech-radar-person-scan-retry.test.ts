import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The 2026-08-26 incident: one approved person-scan became four full executions
 * (07:43, 07:46, 07:48, 07:51 — 156 provider calls instead of 39) because an Inngest
 * step failed or timed out and Inngest retried the function. The old function opened
 * its RadarScanRun row and re-fetched every query INSIDE the same "person-scan" step,
 * so a retry started from scratch every time.
 *
 * The fix splits row-opening into its own step, `step.run("open-run", ...)`, BEFORE the
 * scan step. Inngest memoizes a completed step: on a retry, the function replays from
 * the same execution history, and step.run for a step id that already finished returns
 * its prior result instead of calling the callback again — so "open-run" runs once and
 * every subsequent attempt (real or retried) hands the SAME run id into personScan.
 *
 * This fake step reproduces that memoization with an in-memory cache keyed by step id,
 * reused across two separate handler() invocations to simulate a retry. Only a step
 * that RESOLVES gets memoized — a step that throws is not memoized (that is precisely
 * why Inngest retries the function), so the fake must not cache a rejection either.
 */

const openScanRun = vi.fn();
const personScan = vi.fn();
vi.mock("@/lib/tech-radar/person-scan", () => ({
  openScanRun: (...a: unknown[]) => openScanRun(...a),
  personScan: (...a: unknown[]) => personScan(...a),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) },
}));

const { techRadarPersonScan } = await import("@/inngest/functions/tech-radar-person-scan");
const handler = (techRadarPersonScan as unknown as { handler: (a: unknown) => Promise<unknown> }).handler;

function fakeStep() {
  const memo = new Map<string, unknown>();
  return {
    run: async (id: string, fn: () => unknown) => {
      if (!memo.has(id)) memo.set(id, await fn());
      return memo.get(id);
    },
  };
}

beforeEach(() => {
  openScanRun.mockReset();
  personScan.mockReset();
  openScanRun.mockResolvedValue({ id: "run-123" });
  personScan.mockResolvedValue({ axes: 0, queriesRun: 0 });
});

describe("tech-radar-person-scan retry resumes the run it was already writing", () => {
  it("a retried invocation (same memoized step) reuses one run id and opens the row once", async () => {
    const step = fakeStep();
    const event = { data: { orgId: "org1" } };

    // Model the 2026-08-26 incident precisely: "open-run" succeeds and is memoized by
    // Inngest, but the "person-scan" step is what fails or times out — that failure is
    // WHY Inngest retries the whole function. A failed step is never memoized, so the
    // retried invocation replays "open-run" from history (free) and actually re-runs
    // "person-scan" (real work, real cost) — with the run id "open-run" already minted.
    personScan.mockRejectedValueOnce(new Error("step timed out"));
    await expect(handler({ event, step })).rejects.toThrow("step timed out");

    personScan.mockResolvedValueOnce({ axes: 0, queriesRun: 0 });
    // Simulated retry: Inngest re-invokes the function with the SAME execution history,
    // so this fake step reuses its memo — "open-run" is replayed, not re-run.
    await handler({ event, step });

    expect(openScanRun).toHaveBeenCalledTimes(1);
    expect(personScan).toHaveBeenCalledTimes(2);

    const runIdsPassed = personScan.mock.calls.map(
      (call) => (call[1] as { runId?: string } | undefined)?.runId
    );
    expect(runIdsPassed).toEqual(["run-123", "run-123"]);
  });

  it("a fresh invocation (no prior memoized step) opens the row exactly once and passes its id through", async () => {
    const step = fakeStep();
    await handler({ event: { data: { orgId: "org1" } }, step });

    expect(openScanRun).toHaveBeenCalledTimes(1);
    expect(openScanRun).toHaveBeenCalledWith("org1");
    expect(personScan).toHaveBeenCalledWith("org1", { runId: "run-123" });
  });
});
