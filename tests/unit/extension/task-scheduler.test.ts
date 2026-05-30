import { describe, it, expect, beforeEach, vi } from "vitest";
import { computeNextScheduledFor } from "@/lib/extension/task-scheduler";

describe("computeNextScheduledFor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("within working hours and no prior send → returns ~3-10 min in future", () => {
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z")); // Monday 10:00 UTC
    const out = computeNextScheduledFor({
      timezone: "UTC",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 30,
      hourlyCap: 8,
    });
    const deltaMin = (out.getTime() - Date.now()) / 60_000;
    expect(deltaMin).toBeGreaterThanOrEqual(3);
    expect(deltaMin).toBeLessThanOrEqual(10);
  });

  it("outside working hours → pushes to next 09:00 in user TZ", () => {
    vi.setSystemTime(new Date("2026-06-01T20:00:00Z")); // Monday 20:00 UTC
    const out = computeNextScheduledFor({
      timezone: "UTC",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 30,
      hourlyCap: 8,
    });
    expect(out.toISOString()).toMatch(/^2026-06-02T09:/);
  });

  it("Saturday → pushes to Monday 09:00 when weekdaysOnly", () => {
    vi.setSystemTime(new Date("2026-06-06T10:00:00Z")); // Saturday
    const out = computeNextScheduledFor({
      timezone: "UTC",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 30,
      hourlyCap: 8,
    });
    expect(out.toISOString()).toMatch(/^2026-06-08T09:/);
  });

  it("at daily cap → pushes to next workday 09:00", () => {
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const out = computeNextScheduledFor({
      timezone: "UTC",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt: null,
      sentTodayCount: 30,
      sentLastHourCount: 0,
      dailyCap: 30,
      hourlyCap: 8,
    });
    expect(out.toISOString()).toMatch(/^2026-06-02T09:/);
  });

  it("Jerusalem timezone: outside hours pushes to next day 09:00 Jerusalem time (06:00 UTC)", () => {
    vi.setSystemTime(new Date("2026-06-01T20:00:00Z")); // Monday 23:00 Jerusalem (outside 9-18)
    const out = computeNextScheduledFor({
      timezone: "Asia/Jerusalem",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 30,
      hourlyCap: 8,
    });
    // 09:00 Jerusalem on 2026-06-02 = 06:00 UTC (Jerusalem is UTC+3)
    expect(out.toISOString()).toBe("2026-06-02T06:00:00.000Z");
  });

  it("at hourly cap → pushes to next hour", () => {
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const out = computeNextScheduledFor({
      timezone: "UTC",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 8,
      dailyCap: 30,
      hourlyCap: 8,
    });
    const deltaMin = (out.getTime() - Date.now()) / 60_000;
    expect(deltaMin).toBeGreaterThanOrEqual(60);
    expect(deltaMin).toBeLessThan(75);
  });
});
