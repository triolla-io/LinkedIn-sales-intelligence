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
