import { describe, it, expect } from "vitest";
import {
  HARD_DAILY_CAP,
  HARD_WEEKLY_CAP,
  CONNECT_HOURLY_CAP,
  warmupWeek,
  effectiveCaps,
  dailyTargetFor,
  clampRunCaps,
  localDateKey,
} from "@/lib/prospecting/gentle-policy";

const NOW = new Date("2026-07-29T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("constants", () => {
  it("hard caps match the spec", () => {
    expect(HARD_DAILY_CAP).toBe(12);
    expect(HARD_WEEKLY_CAP).toBe(60);
    expect(CONNECT_HOURLY_CAP).toBe(3);
  });
});

describe("warmupWeek", () => {
  it("null start (no successful send yet) → week 1, most conservative", () => {
    expect(warmupWeek(null, NOW)).toBe(1);
  });
  it("day 0 and day 6 → week 1; day 7 → week 2", () => {
    expect(warmupWeek(daysAgo(0), NOW)).toBe(1);
    expect(warmupWeek(daysAgo(6), NOW)).toBe(1);
    expect(warmupWeek(daysAgo(7), NOW)).toBe(2);
  });
  it("far past → keeps counting (clamped later by the ladder)", () => {
    expect(warmupWeek(daysAgo(365), NOW)).toBeGreaterThanOrEqual(4);
  });
});

describe("effectiveCaps", () => {
  it("mature account: run caps above hard caps get clamped", () => {
    const caps = effectiveCaps({ runDailyCap: 15, runWeeklyCap: 100, warmupStartedAt: daysAgo(60), now: NOW });
    expect(caps).toMatchObject({ dailyCap: 12, weeklyCap: 60, warming: false });
  });
  it("week-1 account: warm-up ladder wins over run caps", () => {
    const caps = effectiveCaps({ runDailyCap: 15, runWeeklyCap: 100, warmupStartedAt: daysAgo(2), now: NOW });
    expect(caps).toMatchObject({ dailyCap: 3, weeklyCap: 15, week: 1, warming: true });
  });
  it("week-2 and week-3 ladder rungs", () => {
    expect(effectiveCaps({ runDailyCap: 15, runWeeklyCap: 100, warmupStartedAt: daysAgo(8), now: NOW }).dailyCap).toBe(5);
    expect(effectiveCaps({ runDailyCap: 15, runWeeklyCap: 100, warmupStartedAt: daysAgo(15), now: NOW }).dailyCap).toBe(8);
  });
  it("run cap below every ladder rung wins (customer set 2/day)", () => {
    const caps = effectiveCaps({ runDailyCap: 2, runWeeklyCap: 100, warmupStartedAt: daysAgo(60), now: NOW });
    expect(caps.dailyCap).toBe(2);
  });
});

describe("dailyTargetFor", () => {
  const base = { userId: "user_abc", timezone: "Asia/Jerusalem", now: NOW, effectiveDailyCap: 12 };
  it("deterministic for the same (user, day)", () => {
    expect(dailyTargetFor(base)).toBe(dailyTargetFor({ ...base, now: new Date("2026-07-29T18:00:00Z") }));
  });
  it("within 70%–100% of the cap", () => {
    for (const userId of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const t = dailyTargetFor({ ...base, userId });
      expect(t).toBeGreaterThanOrEqual(8); // round(12 * 0.7)
      expect(t).toBeLessThanOrEqual(12);
    }
  });
  it("never below 1", () => {
    expect(dailyTargetFor({ ...base, effectiveDailyCap: 1 })).toBe(1);
  });
  it("different days can differ (not a constant function)", () => {
    const days = Array.from({ length: 14 }, (_, i) =>
      dailyTargetFor({ ...base, now: new Date(NOW.getTime() + i * 24 * 60 * 60 * 1000) })
    );
    expect(new Set(days).size).toBeGreaterThan(1);
  });
});

describe("clampRunCaps", () => {
  it("clamps above-hard-cap values, passes through undefined", () => {
    expect(clampRunCaps({ dailyCap: 50, weeklyCap: 200 })).toEqual({ dailyCap: 12, weeklyCap: 60 });
    expect(clampRunCaps({ dailyCap: 5 })).toEqual({ dailyCap: 5, weeklyCap: undefined });
    expect(clampRunCaps({})).toEqual({ dailyCap: undefined, weeklyCap: undefined });
  });
});

describe("localDateKey", () => {
  it("uses the local calendar day, not UTC", () => {
    // 22:30 UTC = 01:30 next day in Asia/Jerusalem (UTC+3 in July)
    expect(localDateKey(new Date("2026-07-29T22:30:00Z"), "Asia/Jerusalem")).toBe("2026-07-30");
    expect(localDateKey(new Date("2026-07-29T22:30:00Z"), "UTC")).toBe("2026-07-29");
  });
});
