import { describe, it, expect } from "vitest";
import { pilotHoldEnabled, pilotReviewers, isPilotReviewer } from "@/lib/tech-radar/pilot-gate";

/**
 * The pilot gate is default-ON: nobody can set an env var on the production container
 * tonight, and the requirement is that tonight's drafts are held. RADAR_PILOT_HOLD=off
 * is the only release valve — every other value (unset, garbage, "on", "1") holds.
 */

// Next augments NodeJS.ProcessEnv with a required NODE_ENV, so a bare `{}` test
// fixture doesn't structurally satisfy it — this is a test-only cast, not a runtime
// concern (the real process.env always has NODE_ENV).
function fakeEnv(vars: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("pilotHoldEnabled", () => {
  it("is true when RADAR_PILOT_HOLD is unset", () => {
    expect(pilotHoldEnabled(fakeEnv())).toBe(true);
  });

  it.each(["on", "1", "yes", "garbage", "true", "TRUE"])("is true for %s", (v) => {
    expect(pilotHoldEnabled(fakeEnv({ RADAR_PILOT_HOLD: v }))).toBe(true);
  });

  it.each(["off", "OFF", "Off", "0", "false", "FALSE", "False"])("is false for %s", (v) => {
    expect(pilotHoldEnabled(fakeEnv({ RADAR_PILOT_HOLD: v }))).toBe(false);
  });
});

describe("pilotReviewers", () => {
  it("defaults to ariel@triolla.io when RADAR_PILOT_REVIEWERS is unset", () => {
    expect(pilotReviewers(fakeEnv())).toEqual(["ariel@triolla.io"]);
  });

  it("splits a comma-separated list and trims whitespace", () => {
    expect(pilotReviewers(fakeEnv({ RADAR_PILOT_REVIEWERS: "a@x.com, b@y.com" }))).toEqual(["a@x.com", "b@y.com"]);
  });
});

describe("isPilotReviewer", () => {
  it("matches case-insensitively", () => {
    expect(isPilotReviewer("ARIEL@TRIOLLA.IO", fakeEnv())).toBe(true);
    expect(isPilotReviewer("Ariel@Triolla.Io", fakeEnv())).toBe(true);
  });

  it("trims whitespace before matching", () => {
    expect(isPilotReviewer("  ariel@triolla.io  ", fakeEnv())).toBe(true);
  });

  it("is false for null/undefined/empty", () => {
    expect(isPilotReviewer(null, fakeEnv())).toBe(false);
    expect(isPilotReviewer(undefined, fakeEnv())).toBe(false);
    expect(isPilotReviewer("", fakeEnv())).toBe(false);
  });

  it("is false for a non-reviewer email", () => {
    expect(isPilotReviewer("yuval@triolla.io", fakeEnv())).toBe(false);
  });

  it("honours a multi-value RADAR_PILOT_REVIEWERS list", () => {
    const env = fakeEnv({ RADAR_PILOT_REVIEWERS: "a@x.com, b@y.com" });
    expect(isPilotReviewer("a@x.com", env)).toBe(true);
    expect(isPilotReviewer("B@Y.COM", env)).toBe(true);
    expect(isPilotReviewer("ariel@triolla.io", env)).toBe(false);
  });
});
