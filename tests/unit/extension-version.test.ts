import { describe, it, expect } from "vitest";
import { compareVersions, isExtensionOutdated } from "@/lib/extension/version";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("0.4.3", "0.5.0")).toBeLessThan(0);
    expect(compareVersions("0.5.0", "0.4.3")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.5.1", "0.5.0")).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareVersions("0.5.0", "0.5.0")).toBe(0);
  });

  it("pads missing components with zero", () => {
    expect(compareVersions("0.5", "0.5.0")).toBe(0);
    expect(compareVersions("1", "0.9.9")).toBeGreaterThan(0);
  });

  it("returns null when either side is not a version", () => {
    expect(compareVersions("abc", "0.5.0")).toBeNull();
    expect(compareVersions("0.5.0", "")).toBeNull();
  });
});

describe("isExtensionOutdated", () => {
  it("flags adi's real case: 0.4.3 installed against a 0.5.0 build", () => {
    expect(isExtensionOutdated("0.4.3", "0.5.0")).toBe(true);
  });

  it("does not flag an up-to-date extension", () => {
    expect(isExtensionOutdated("0.5.0", "0.5.0")).toBe(false);
  });

  it("does not flag a local build that is ahead of the served one", () => {
    expect(isExtensionOutdated("0.6.0", "0.5.0")).toBe(false);
  });

  it("stays quiet when the installed version is unknown", () => {
    // A null version means the extension never reported one — the connection badge
    // covers that case, so nagging about an update would be a false alarm.
    expect(isExtensionOutdated(null, "0.5.0")).toBe(false);
    expect(isExtensionOutdated("nightly", "0.5.0")).toBe(false);
  });

  it("stays quiet when the served build version is unreadable", () => {
    expect(isExtensionOutdated("0.4.3", null)).toBe(false);
  });
});
