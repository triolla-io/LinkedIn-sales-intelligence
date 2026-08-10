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

  describe("extension_offline", () => {
    it("reports extension_offline when the extension is quiet for over 15 minutes", () => {
      const r = computeRunStatusSummary({
        ...base,
        extensionLastSeenAt: new Date(base.now.getTime() - 16 * 60 * 1000),
      });
      expect(r.state).toBe("extension_offline");
    });
    it("reports extension_offline (never connected) for a null lastSeenAt", () => {
      const r = computeRunStatusSummary({ ...base, extensionLastSeenAt: null });
      expect(r.state).toBe("extension_offline");
      expect(r.message).toContain("מעולם לא התחבר");
    });
    it("stays normal when the extension polled recently", () => {
      const r = computeRunStatusSummary({
        ...base,
        extensionLastSeenAt: new Date(base.now.getTime() - 2 * 60 * 1000),
      });
      expect(r.state).toBe("idle");
    });
    it("beats a scheduled send — an offline extension will never send it", () => {
      const r = computeRunStatusSummary({
        ...base,
        nextScheduledFor: new Date("2026-06-30T14:30:00Z"),
        extensionLastSeenAt: null,
      });
      expect(r.state).toBe("extension_offline");
    });
    it("does not fire for PAUSED runs or when the caller didn't check", () => {
      expect(computeRunStatusSummary({ ...base, status: "PAUSED", extensionLastSeenAt: null }).state).toBe("paused");
      expect(computeRunStatusSummary(base).state).toBe("idle"); // extensionLastSeenAt undefined
    });
  });
});
