import { describe, it, expect } from "vitest";
import { SAFE_GAP_MIN, spacedSlotMs, assignWindowIndices } from "@/lib/sequences/spacing";

describe("SAFE_GAP_MIN", () => {
  it("is 5 minutes", () => {
    expect(SAFE_GAP_MIN).toBe(5);
  });
});

describe("spacedSlotMs", () => {
  const start = Date.UTC(2026, 0, 15, 8, 0, 0); // arbitrary window start in ms
  const end = start + 60 * 60_000; // one hour window

  it("places index 0 exactly at window start", () => {
    expect(spacedSlotMs(start, end, 0)).toBe(start);
  });

  it("spaces consecutive indices 5 minutes apart", () => {
    expect(spacedSlotMs(start, end, 1)).toBe(start + 5 * 60_000);
    expect(spacedSlotMs(start, end, 2)).toBe(start + 10 * 60_000);
  });

  it("respects a custom gap", () => {
    expect(spacedSlotMs(start, end, 2, 3)).toBe(start + 6 * 60_000);
  });

  it("clamps to window end on overflow (graceful overflow)", () => {
    // index 20 * 5min = 100min > 60min window
    expect(spacedSlotMs(start, end, 20)).toBe(end);
  });

  it("does not clamp when there is no window end", () => {
    expect(spacedSlotMs(start, null, 20)).toBe(start + 100 * 60_000);
  });
});

describe("assignWindowIndices", () => {
  it("assigns 0,1,2 to steps sharing the same day+window", () => {
    const steps = [
      { id: "a", dayOffset: 0, sendHour: 10, sendHourEnd: 11 },
      { id: "b", dayOffset: 0, sendHour: 10, sendHourEnd: 11 },
      { id: "c", dayOffset: 0, sendHour: 10, sendHourEnd: 11 },
    ];
    expect(assignWindowIndices(steps).map((s) => s.indexInWindow)).toEqual([0, 1, 2]);
  });

  it("resets the index per distinct (dayOffset, sendHour, sendHourEnd) group", () => {
    const steps = [
      { id: "a", dayOffset: 0, sendHour: 10, sendHourEnd: 11 }, // group A -> 0
      { id: "b", dayOffset: 1, sendHour: 10, sendHourEnd: 11 }, // group B -> 0
      { id: "c", dayOffset: 1, sendHour: 10, sendHourEnd: 11 }, // group B -> 1
      { id: "d", dayOffset: 0, sendHour: 14, sendHourEnd: 15 }, // group C -> 0
    ];
    expect(assignWindowIndices(steps).map((s) => s.indexInWindow)).toEqual([0, 0, 1, 0]);
  });

  it("treats null sendHourEnd as its own window key", () => {
    const steps = [
      { id: "a", dayOffset: 0, sendHour: 10, sendHourEnd: null },
      { id: "b", dayOffset: 0, sendHour: 10, sendHourEnd: null },
    ];
    expect(assignWindowIndices(steps).map((s) => s.indexInWindow)).toEqual([0, 1]);
  });
});
