import { describe, it, expect } from "vitest";
import { startOfDayInZone } from "@/lib/extension/task-scheduler";

describe("startOfDayInZone", () => {
  it("returns the UTC instant of local midnight in Asia/Jerusalem (IDT, UTC+3)", () => {
    // 2026-07-27 13:41 UTC = 16:41 Israel → local midnight was 2026-07-27 00:00 IDT = 2026-07-26 21:00 UTC
    const now = new Date("2026-07-27T13:41:00Z");
    expect(startOfDayInZone(now, "Asia/Jerusalem").toISOString()).toBe("2026-07-26T21:00:00.000Z");
  });

  it("excludes yesterday-afternoon sends from a 'sent today' window", () => {
    const now = new Date("2026-07-27T13:41:00Z");
    const sentYesterday = new Date("2026-07-26T14:07:00Z"); // 17:07 Israel, yesterday
    expect(sentYesterday >= startOfDayInZone(now, "Asia/Jerusalem")).toBe(false);
  });

  it("handles a UTC time that is already the previous local day", () => {
    // 2026-07-27 22:30 UTC = 2026-07-28 01:30 Israel → local midnight is 2026-07-27 21:00 UTC
    const now = new Date("2026-07-27T22:30:00Z");
    expect(startOfDayInZone(now, "Asia/Jerusalem").toISOString()).toBe("2026-07-27T21:00:00.000Z");
  });

  it("works for standard time (IST, UTC+2)", () => {
    const now = new Date("2026-01-15T10:00:00Z"); // 12:00 Israel, winter
    expect(startOfDayInZone(now, "Asia/Jerusalem").toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });
});
