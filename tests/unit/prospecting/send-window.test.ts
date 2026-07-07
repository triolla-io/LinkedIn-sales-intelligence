import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  normalizeSendDays,
  resolveSendWindow,
  sendWindowFields,
  sendWindowRefine,
  formatSendDaysHe,
  formatSendWindowHe,
} from "@/lib/prospecting/send-window";

const Schema = z.object(sendWindowFields).refine(sendWindowRefine);

describe("normalizeSendDays", () => {
  it("dedupes and sorts", () => {
    expect(normalizeSendDays([4, 0, 4, 2])).toEqual([0, 2, 4]);
  });
});

describe("sendWindow zod fields", () => {
  it("accepts a full valid window", () => {
    expect(Schema.safeParse({ sendDays: [0, 1, 2], sendHoursStart: 9, sendHoursEnd: 18 }).success).toBe(true);
  });
  it("accepts an empty object (all optional)", () => {
    expect(Schema.safeParse({}).success).toBe(true);
  });
  it("rejects empty sendDays", () => {
    expect(Schema.safeParse({ sendDays: [] }).success).toBe(false);
  });
  it("rejects day 7", () => {
    expect(Schema.safeParse({ sendDays: [7] }).success).toBe(false);
  });
  it("rejects end <= start", () => {
    expect(Schema.safeParse({ sendHoursStart: 10, sendHoursEnd: 10 }).success).toBe(false);
  });
  it("rejects a lone hour bound (must send both)", () => {
    expect(Schema.safeParse({ sendHoursStart: 10 }).success).toBe(false);
    expect(Schema.safeParse({ sendHoursEnd: 20 }).success).toBe(false);
  });
  it("accepts boundary hours 0 and 24", () => {
    expect(Schema.safeParse({ sendHoursStart: 0, sendHoursEnd: 24 }).success).toBe(true);
  });
});

describe("resolveSendWindow", () => {
  it("uses the run's own values when sendDays is set", () => {
    expect(resolveSendWindow({ sendDays: [5, 6], sendHoursStart: 10, sendHoursEnd: 14 }, "Asia/Jerusalem")).toEqual({
      workingWeekdays: [5, 6],
      workingHoursStart: 10,
      workingHoursEnd: 14,
    });
  });
  it("falls back to Sun-Thu for empty sendDays in Israel (legacy rows)", () => {
    expect(resolveSendWindow({ sendDays: [], sendHoursStart: 9, sendHoursEnd: 18 }, "Asia/Jerusalem").workingWeekdays).toEqual([0, 1, 2, 3, 4]);
  });
  it("falls back to Mon-Fri for empty sendDays elsewhere", () => {
    expect(resolveSendWindow({ sendDays: [], sendHoursStart: 9, sendHoursEnd: 18 }, "America/New_York").workingWeekdays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("formatSendDaysHe", () => {
  it("collapses a consecutive range", () => {
    expect(formatSendDaysHe([0, 1, 2, 3, 4])).toBe("א׳–ה׳");
  });
  it("lists non-consecutive days", () => {
    expect(formatSendDaysHe([0, 2, 4])).toBe("א׳, ג׳, ה׳");
  });
  it("does not use a dash for a 2-day run", () => {
    expect(formatSendDaysHe([0, 1])).toBe("א׳, ב׳");
  });
  it("mixes ranges and singles", () => {
    expect(formatSendDaysHe([0, 1, 2, 5])).toBe("א׳–ג׳, ו׳");
  });
  it("says all week for 7 days", () => {
    expect(formatSendDaysHe([0, 1, 2, 3, 4, 5, 6])).toBe("כל השבוע");
  });
  it("handles unsorted input", () => {
    expect(formatSendDaysHe([4, 0, 2])).toBe("א׳, ג׳, ה׳");
  });
});

describe("formatSendWindowHe", () => {
  it("builds the full sentence", () => {
    expect(formatSendWindowHe([0, 1, 2, 3, 4], 9, 18)).toBe("יישלח בימים א׳–ה׳, בין 09:00 ל־18:00 (שעון ישראל)");
  });
  it("phrases all-week without the days prefix", () => {
    expect(formatSendWindowHe([0, 1, 2, 3, 4, 5, 6], 8, 22)).toBe("יישלח כל השבוע, בין 08:00 ל־22:00 (שעון ישראל)");
  });
});
