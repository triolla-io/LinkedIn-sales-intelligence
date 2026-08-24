import { describe, it, expect } from "vitest";
import { derivePrepStatus, PREP_STALL_MINUTES } from "@/lib/tech-radar/prep-status";

/**
 * The rule the design demands: a preparation that stops has to SAY it stopped. An
 * indefinite spinner is the failure mode being ruled out here — every path that cannot
 * progress must end in failed:true with something the user can act on.
 */

const NOW = new Date("2026-08-24T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const base = {
  radarAddedAt: minsAgo(1),
  hasEmployer: true,
  employerStatus: "PENDING_RESEARCH" as const,
  employerError: null,
  axisCount: 0,
  hasProfile: false,
  nextScanLabel: "ראשון בבוקר",
  now: NOW,
};

const stage = (s: ReturnType<typeof derivePrepStatus>, key: string) =>
  s.stages.find((x) => x.key === key)!;

describe("derivePrepStatus", () => {
  it("a fresh add is running, not failed", () => {
    const s = derivePrepStatus(base);
    expect(s.failed).toBe(false);
    expect(s.ready).toBe(false);
    expect(stage(s, "company").state).toBe("running");
  });

  it("research that never lands becomes a failure with retry, not an eternal spinner", () => {
    const s = derivePrepStatus({ ...base, radarAddedAt: minsAgo(PREP_STALL_MINUTES + 1) });
    expect(s.failed).toBe(true);
    expect(stage(s, "company").detail).toContain("נתקע");
  });

  it("a failed company research surfaces its own reason", () => {
    const s = derivePrepStatus({ ...base, employerStatus: "RESEARCH_FAILED", employerError: "אין אתר" });
    expect(s.failed).toBe(true);
    expect(stage(s, "company").detail).toContain("אין אתר");
  });

  it("no matched employer is a failure the user can act on", () => {
    const s = derivePrepStatus({ ...base, hasEmployer: false, employerStatus: null });
    expect(s.failed).toBe(true);
    expect(stage(s, "company").detail).toContain("לא זוהתה חברה");
  });

  it("a researched company with no profile yet is still building axes", () => {
    const s = derivePrepStatus({ ...base, employerStatus: "ACTIVE" });
    expect(s.failed).toBe(false);
    expect(stage(s, "company").state).toBe("done");
    expect(stage(s, "axes").state).toBe("running");
  });

  it("axis-building that stalls fails rather than waiting forever", () => {
    const s = derivePrepStatus({
      ...base,
      employerStatus: "ACTIVE",
      radarAddedAt: minsAgo(PREP_STALL_MINUTES + 1),
    });
    expect(s.failed).toBe(true);
    expect(stage(s, "axes").state).toBe("failed");
  });

  it("a profile that exists but produced no axes is a failure, not readiness", () => {
    const s = derivePrepStatus({
      ...base,
      employerStatus: "ACTIVE",
      hasProfile: true,
      axisCount: 0,
      radarAddedAt: minsAgo(PREP_STALL_MINUTES + 1),
    });
    expect(s.ready).toBe(false);
    expect(s.failed).toBe(true);
  });

  it("a profile with axes is ready and names the next scan", () => {
    const s = derivePrepStatus({ ...base, employerStatus: "ACTIVE", hasProfile: true, axisCount: 3 });
    expect(s.ready).toBe(true);
    expect(s.failed).toBe(false);
    expect(stage(s, "scan").detail).toContain("ראשון בבוקר");
  });

  it("a person added before this field existed is not reported as stuck", () => {
    const s = derivePrepStatus({ ...base, radarAddedAt: null, employerStatus: "ACTIVE" });
    expect(s.failed).toBe(false);
  });

  it("always reports all four stages, in order", () => {
    expect(derivePrepStatus(base).stages.map((s) => s.key)).toEqual([
      "added",
      "company",
      "axes",
      "scan",
    ]);
  });
});
