import { describe, it, expect } from "vitest";
import { computeRunStatusSummary } from "@/lib/prospecting/run-status";

const base = { status: "RUNNING", pausedUntil: null, nextScheduledFor: null, nextDiscoveryAt: null, sentToday: 0, dailyCap: 8, sentThisWeek: 0, weeklyCap: 100, now: new Date("2026-06-30T10:00:00Z") };

describe("computeRunStatusSummary", () => {
  it("reports frozen when pausedUntil is in the future", () => {
    const r = computeRunStatusSummary({ ...base, pausedUntil: new Date("2026-06-30T20:00:00Z") });
    expect(r.state).toBe("frozen");
  });
  it("reports completed for a completed run", () => {
    expect(computeRunStatusSummary({ ...base, status: "COMPLETED" }).state).toBe("completed");
  });
  it("reports daily_cap when today's sends hit the cap", () => {
    expect(computeRunStatusSummary({ ...base, sentToday: 8, dailyCap: 8 }).state).toBe("daily_cap");
  });
  it("reports weekly_cap when the week's sends hit the cap", () => {
    expect(computeRunStatusSummary({ ...base, sentThisWeek: 100, weeklyCap: 100 }).state).toBe("weekly_cap");
  });
  it("reports waiting with nextAt when a send is scheduled", () => {
    const next = new Date("2026-06-30T14:30:00Z");
    const r = computeRunStatusSummary({ ...base, nextScheduledFor: next });
    expect(r.state).toBe("waiting");
    expect(r.nextAt).toBe(next.toISOString());
  });
  it("reports idle for a running run with nothing scheduled and no caps hit", () => {
    expect(computeRunStatusSummary(base).state).toBe("idle");
  });
  it("reports waiting_discovery (still active, NOT completed) when the pool is done and a re-scan is scheduled", () => {
    const next = new Date("2026-07-01T10:00:00Z");
    const r = computeRunStatusSummary({ ...base, nextDiscoveryAt: next });
    expect(r.state).toBe("waiting_discovery");
    expect(r.nextAt).toBe(next.toISOString());
  });
  it("prioritises a scheduled send over the re-discovery wait", () => {
    const send = new Date("2026-06-30T14:30:00Z");
    const disc = new Date("2026-07-01T10:00:00Z");
    expect(computeRunStatusSummary({ ...base, nextScheduledFor: send, nextDiscoveryAt: disc }).state).toBe("waiting");
  });
});
