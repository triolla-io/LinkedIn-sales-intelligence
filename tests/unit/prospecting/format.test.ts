import { describe, it, expect } from "vitest";
import { formatHebrewTime, ERROR_CODE_LABELS } from "@/lib/prospecting/format";

// 2026-07-02T09:00:00Z == 12:00 in Asia/Jerusalem (IDT, UTC+3)
const now = new Date("2026-07-02T09:00:00Z");

describe("formatHebrewTime", () => {
  it("under an hour away → relative minutes with absolute time", () => {
    expect(formatHebrewTime(new Date("2026-07-02T09:04:00Z"), now)).toBe("בעוד 4 דקות (12:04)");
  });
  it("under a minute away", () => {
    expect(formatHebrewTime(new Date("2026-07-02T09:00:20Z"), now)).toBe("בעוד פחות מדקה (12:00)");
  });
  it("later today → היום בשעה", () => {
    expect(formatHebrewTime(new Date("2026-07-02T12:00:00Z"), now)).toBe("היום בשעה 15:00");
  });
  it("tomorrow → מחר בשעה", () => {
    expect(formatHebrewTime(new Date("2026-07-03T06:00:00Z"), now)).toBe("מחר בשעה 09:00");
  });
  it("further out → date + time", () => {
    expect(formatHebrewTime(new Date("2026-07-05T06:00:00Z"), now)).toBe("ב-5.7 בשעה 09:00");
  });
  it("crosses the Jerusalem day boundary correctly (22:30Z tonight is tomorrow 01:30 local)", () => {
    expect(formatHebrewTime(new Date("2026-07-02T22:30:00Z"), now)).toBe("מחר בשעה 01:30");
  });
});

describe("ERROR_CODE_LABELS", () => {
  it("covers the codes surfaced in the failures panel", () => {
    expect(ERROR_CODE_LABELS.no_connect).toBeTruthy();
    expect(ERROR_CODE_LABELS.connect_button_not_found).toBeTruthy();
    expect(ERROR_CODE_LABELS.follow_only).toBeTruthy();
  });
});
