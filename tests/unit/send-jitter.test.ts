import { describe, it, expect } from "vitest";
import {
  resolveJitterConfig,
  sampleJitterSeconds,
  computeJitteredScheduledFor,
} from "@/lib/extension/send-jitter";

describe("resolveJitterConfig", () => {
  it("returns 45/180 defaults when env vars are absent", () => {
    const cfg = resolveJitterConfig({});
    expect(cfg).toEqual({ minSeconds: 45, maxSeconds: 180, source: "default" });
  });

  it("uses valid env values", () => {
    const cfg = resolveJitterConfig({ MIN_DELAY_SECONDS: "30", MAX_DELAY_SECONDS: "90" });
    expect(cfg).toEqual({ minSeconds: 30, maxSeconds: 90, source: "env" });
  });

  it("falls back to defaults when min >= max", () => {
    const cfg = resolveJitterConfig({ MIN_DELAY_SECONDS: "200", MAX_DELAY_SECONDS: "100" });
    expect(cfg).toEqual({ minSeconds: 45, maxSeconds: 180, source: "default" });
  });

  it("falls back to defaults when a value is not a positive number", () => {
    for (const bad of [
      { MIN_DELAY_SECONDS: "abc", MAX_DELAY_SECONDS: "90" },
      { MIN_DELAY_SECONDS: "-5", MAX_DELAY_SECONDS: "90" },
      { MIN_DELAY_SECONDS: "0", MAX_DELAY_SECONDS: "90" },
      { MIN_DELAY_SECONDS: "30", MAX_DELAY_SECONDS: "" },
    ]) {
      expect(resolveJitterConfig(bad)).toEqual({ minSeconds: 45, maxSeconds: 180, source: "default" });
    }
  });

  it("falls back to defaults when only one var is set", () => {
    expect(resolveJitterConfig({ MIN_DELAY_SECONDS: "30" })).toEqual({
      minSeconds: 45,
      maxSeconds: 180,
      source: "default",
    });
  });
});

describe("sampleJitterSeconds", () => {
  const cfg = { minSeconds: 45, maxSeconds: 180, source: "default" as const };

  it("always samples within [min, max]", () => {
    for (let i = 0; i < 1000; i++) {
      const d = sampleJitterSeconds(cfg);
      expect(d).toBeGreaterThanOrEqual(45);
      expect(d).toBeLessThanOrEqual(180);
    }
  });

  it("produces no two identical values across 10 consecutive samples", () => {
    const draws = Array.from({ length: 10 }, () => sampleJitterSeconds(cfg));
    expect(new Set(draws).size).toBe(10);
  });

  it("clusters around the window center (Gaussian mean)", () => {
    const n = 2000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sampleJitterSeconds(cfg);
    const mean = sum / n;
    // center is 112.5; sd of the sample mean is ~0.5s, so ±5s is generous
    expect(mean).toBeGreaterThan(107.5);
    expect(mean).toBeLessThan(117.5);
  });

  it("is deterministic given an injected rng", () => {
    let calls = 0;
    const rng = () => {
      // avoid returning exactly 0 (Box-Muller takes log of the first draw)
      calls++;
      return ((calls * 7919) % 104729) / 104729 || 0.5;
    };
    const a = sampleJitterSeconds(cfg, rng);
    calls = 0;
    const b = sampleJitterSeconds(cfg, rng);
    expect(a).toBe(b);
  });
});

describe("computeJitteredScheduledFor", () => {
  const now = new Date("2026-07-23T10:00:00.000Z");

  it("bases off now when there is no prior send activity", () => {
    const out = computeJitteredScheduledFor({
      now,
      latestPendingScheduledFor: null,
      latestCompletedAt: null,
      delaySeconds: 60,
    });
    expect(out.getTime()).toBe(now.getTime() + 60_000);
  });

  it("chains after the latest pending SEND so consecutive approvals stack", () => {
    const pending = new Date("2026-07-23T10:05:00.000Z");
    const out = computeJitteredScheduledFor({
      now,
      latestPendingScheduledFor: pending,
      latestCompletedAt: null,
      delaySeconds: 90,
    });
    expect(out.getTime()).toBe(pending.getTime() + 90_000);
  });

  it("spaces off a just-completed send when nothing is pending", () => {
    const completed = new Date("2026-07-23T09:59:30.000Z");
    const out = computeJitteredScheduledFor({
      now,
      latestPendingScheduledFor: null,
      latestCompletedAt: completed,
      delaySeconds: 50,
    });
    // completed is in the past relative to now, but now wins as the base
    expect(out.getTime()).toBe(now.getTime() + 50_000);
  });

  it("uses the max of all bases", () => {
    const pending = new Date("2026-07-23T10:03:00.000Z");
    const completed = new Date("2026-07-23T10:07:00.000Z");
    const out = computeJitteredScheduledFor({
      now,
      latestPendingScheduledFor: pending,
      latestCompletedAt: completed,
      delaySeconds: 45,
    });
    expect(out.getTime()).toBe(completed.getTime() + 45_000);
  });
});
