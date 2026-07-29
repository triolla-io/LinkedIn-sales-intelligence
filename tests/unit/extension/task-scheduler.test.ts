import { describe, it, expect, beforeEach, vi } from "vitest";
import { computeNextScheduledFor, isWithinWindow } from "@/lib/extension/task-scheduler";

describe("computeNextScheduledFor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("within working hours and no prior send → schedules immediately", () => {
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
    expect(out.getTime()).toBe(Date.now());
  });

  it("before working hours on a working day → schedules TODAY at window start, not tomorrow", () => {
    vi.setSystemTime(new Date("2026-07-02T08:20:00Z")); // Thursday 08:20 UTC, window opens 09:00
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
    expect(out.toISOString()).toBe("2026-07-02T09:00:00.000Z");
  });

  it("Jerusalem Sun-Thu week: before hours on Thursday → same day 09:00 Jerusalem (06:00 UTC)", () => {
    vi.setSystemTime(new Date("2026-07-02T05:00:00Z")); // Thursday 08:00 Jerusalem
    const out = computeNextScheduledFor({
      timezone: "Asia/Jerusalem",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      workingWeekdays: [0, 1, 2, 3, 4],
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 15,
      hourlyCap: 3,
    });
    expect(out.toISOString()).toBe("2026-07-02T06:00:00.000Z");
  });

  it("Jerusalem Sun-Thu week: Friday → pushes to Sunday 09:00 Jerusalem (06:00 UTC)", () => {
    vi.setSystemTime(new Date("2026-07-03T10:00:00Z")); // Friday 13:00 Jerusalem
    const out = computeNextScheduledFor({
      timezone: "Asia/Jerusalem",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      workingWeekdays: [0, 1, 2, 3, 4],
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 15,
      hourlyCap: 3,
    });
    expect(out.toISOString()).toBe("2026-07-05T06:00:00.000Z");
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

  it("half-hour window end: 21:15 local is still inside a 9:00–21:30 window → schedules now-ish", () => {
    vi.setSystemTime(new Date("2026-07-27T18:15:00Z")); // Monday 21:15 Jerusalem (UTC+3)
    const out = computeNextScheduledFor({
      timezone: "Asia/Jerusalem",
      workingHoursStart: 9,
      workingHoursEnd: 21,
      workingMinutesEnd: 30,
      weekdaysOnly: true,
      workingWeekdays: [0, 1, 2, 3, 4],
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 15,
      hourlyCap: 3,
    });
    expect(out.getTime()).toBe(Date.now());
  });

  it("half-hour window end: 21:45 local is past a 21:30 close → pushes to next day 09:00", () => {
    vi.setSystemTime(new Date("2026-07-27T18:45:00Z")); // Monday 21:45 Jerusalem
    const out = computeNextScheduledFor({
      timezone: "Asia/Jerusalem",
      workingHoursStart: 9,
      workingHoursEnd: 21,
      workingMinutesEnd: 30,
      weekdaysOnly: true,
      workingWeekdays: [0, 1, 2, 3, 4],
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 15,
      hourlyCap: 3,
    });
    expect(out.toISOString()).toBe("2026-07-28T06:00:00.000Z"); // Tuesday 09:00 Jerusalem
  });

  it("half-hour window start: before a 9:30 open → schedules today at 09:30 sharp", () => {
    vi.setSystemTime(new Date("2026-07-27T05:00:00Z")); // Monday 08:00 Jerusalem
    const out = computeNextScheduledFor({
      timezone: "Asia/Jerusalem",
      workingHoursStart: 9,
      workingMinutesStart: 30,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      workingWeekdays: [0, 1, 2, 3, 4],
      lastSentAt: null,
      sentTodayCount: 0,
      sentLastHourCount: 0,
      dailyCap: 15,
      hourlyCap: 3,
    });
    expect(out.toISOString()).toBe("2026-07-27T06:30:00.000Z"); // 09:30 Jerusalem
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

describe("isWithinWindow", () => {
  // 2026-07-07T07:30:00Z is Tuesday (weekday 2) 10:30 in Asia/Jerusalem (UTC+3).
  const tueMorning = new Date("2026-07-07T07:30:00Z");
  const base = { timezone: "Asia/Jerusalem", workingHoursStart: 9, workingHoursEnd: 18, workingWeekdays: [0, 1, 2, 3, 4] };

  it("true inside day+hours", () => {
    expect(isWithinWindow(tueMorning, base)).toBe(true);
  });
  it("false when the weekday is excluded", () => {
    expect(isWithinWindow(tueMorning, { ...base, workingWeekdays: [5, 6] })).toBe(false);
  });
  it("false before opening hour", () => {
    expect(isWithinWindow(tueMorning, { ...base, workingHoursStart: 11 })).toBe(false);
  });
  it("false at/after closing hour (end is exclusive)", () => {
    expect(isWithinWindow(tueMorning, { ...base, workingHoursEnd: 10 })).toBe(false);
  });
  it("half-hour end: 10:30 local is inside end 10:00+30min? no — exclusive; 10:30 end excludes 10:30 itself", () => {
    // tueMorning is 10:30 Jerusalem — a window ending 10:30 excludes it, one ending 11:00 includes it.
    expect(isWithinWindow(tueMorning, { ...base, workingHoursEnd: 10, workingMinutesEnd: 30 })).toBe(false);
    expect(isWithinWindow(tueMorning, { ...base, workingHoursEnd: 11 })).toBe(true);
  });
  it("half-hour start: window opening 10:30 includes 10:30 sharp", () => {
    expect(isWithinWindow(tueMorning, { ...base, workingHoursStart: 10, workingMinutesStart: 30 })).toBe(true);
    expect(isWithinWindow(tueMorning, { ...base, workingHoursStart: 11 })).toBe(false);
  });
});

describe("computeNextScheduledFor — dynamic pacing (dailyTarget opt-in)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const baseWindow = {
    timezone: "UTC",
    workingHoursStart: 9,
    workingHoursEnd: 18,
    weekdaysOnly: true,
  } as const;

  it("gap ≈ remaining window ÷ remaining quota, jittered within ±35%", () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z")); // Monday 09:00, window 9-18 → 540 min left
    const out = computeNextScheduledFor({
      ...baseWindow,
      lastSentAt: new Date("2026-06-01T08:50:00Z"),
      sentTodayCount: 1,
      sentLastHourCount: 1,
      dailyCap: 12,
      hourlyCap: 3,
      dailyTarget: 10, // 9 remaining → target gap 60 min
      rng: () => 0.5,
    });
    const gapMin = (out.getTime() - Date.now()) / 60_000;
    expect(gapMin).toBeGreaterThanOrEqual(39); // 0.65 × 60
    expect(gapMin).toBeLessThanOrEqual(81); // 1.35 × 60
  });

  it("15-minute floor when the window is tight", () => {
    vi.setSystemTime(new Date("2026-06-01T17:30:00Z")); // 30 min left, 10 remaining → raw target 3 min
    const out = computeNextScheduledFor({
      ...baseWindow,
      lastSentAt: new Date("2026-06-01T17:20:00Z"),
      sentTodayCount: 2,
      sentLastHourCount: 1,
      dailyCap: 12,
      hourlyCap: 3,
      dailyTarget: 12,
      rng: () => 0.5,
    });
    const gapMin = (out.getTime() - Date.now()) / 60_000;
    expect(gapMin).toBeGreaterThanOrEqual(15);
    // 17:30 + ≥15min = ≥17:45 — still inside the window today, or clamped to next workday start
  });

  it("reaching dailyTarget (below dailyCap) defers to the next workday", () => {
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const out = computeNextScheduledFor({
      ...baseWindow,
      lastSentAt: new Date("2026-06-01T11:00:00Z"),
      sentTodayCount: 9,
      sentLastHourCount: 0,
      dailyCap: 12,
      hourlyCap: 3,
      dailyTarget: 9, // today's draw already met
      rng: () => 0,
    });
    // Tuesday 09:00 + soft offset (rng 0 → exactly +10 min)
    expect(out.toISOString()).toBe("2026-06-02T09:10:00.000Z");
  });

  it("soft day start: next-workday starts get a 10–45 min offset, never the boundary", () => {
    vi.setSystemTime(new Date("2026-06-01T19:00:00Z")); // after window close
    const at = (r: number) =>
      computeNextScheduledFor({
        ...baseWindow,
        lastSentAt: new Date("2026-06-01T17:00:00Z"),
        sentTodayCount: 3,
        sentLastHourCount: 0,
        dailyCap: 12,
        hourlyCap: 3,
        dailyTarget: 10,
        rng: () => r,
      });
    expect(at(0).toISOString()).toBe("2026-06-02T09:10:00.000Z"); // min offset 10
    expect(at(0.999999).getTime()).toBeLessThanOrEqual(new Date("2026-06-02T09:45:00.000Z").getTime()); // max offset 45
    expect(at(0.5).getTime()).toBeGreaterThan(new Date("2026-06-02T09:00:00.000Z").getTime()); // never the boundary
  });

  it("legacy mode untouched: without dailyTarget the gap stays 3–10 min", () => {
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const out = computeNextScheduledFor({
      ...baseWindow,
      lastSentAt: new Date("2026-06-01T09:55:00Z"),
      sentTodayCount: 3,
      sentLastHourCount: 2,
      dailyCap: 30,
      hourlyCap: 8,
      rng: () => 0.5,
    });
    const gapMin = (out.getTime() - Date.now()) / 60_000;
    expect(gapMin).toBeGreaterThanOrEqual(3);
    expect(gapMin).toBeLessThanOrEqual(10);
  });

  it("legacy mode untouched: next-workday start has NO soft offset", () => {
    vi.setSystemTime(new Date("2026-06-01T19:00:00Z"));
    const out = computeNextScheduledFor({
      ...baseWindow,
      lastSentAt: new Date("2026-06-01T17:00:00Z"),
      sentTodayCount: 3,
      sentLastHourCount: 0,
      dailyCap: 30,
      hourlyCap: 8,
      rng: () => 0.5,
    });
    expect(out.toISOString()).toBe("2026-06-02T09:00:00.000Z");
  });
});
