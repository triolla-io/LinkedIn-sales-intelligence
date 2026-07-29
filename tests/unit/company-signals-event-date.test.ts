import { describe, it, expect } from "vitest";
import { resolveEventDate, formatEventDate } from "@/lib/company-signals/event-date";

describe("resolveEventDate", () => {
  it("prefers eventDate when present", () => {
    expect(
      resolveEventDate("2026-07-10", [{ publishedAt: "2026-07-01" }])
    ).toBe("2026-07-10");
  });
  it("trims a full ISO timestamp to YYYY-MM-DD", () => {
    expect(resolveEventDate("2026-07-10T00:00:00.000Z", [])).toBe("2026-07-10");
  });
  it("falls back to the earliest source publishedAt", () => {
    expect(
      resolveEventDate(null, [
        { publishedAt: "2026-07-20" },
        { publishedAt: "2026-07-03" },
        { publishedAt: null },
      ])
    ).toBe("2026-07-03");
  });
  it("ignores unparseable publishedAt values", () => {
    expect(
      resolveEventDate(null, [{ publishedAt: "last week" }, { publishedAt: "2026-06-30" }])
    ).toBe("2026-06-30");
  });
  it("returns null when nothing is available", () => {
    expect(resolveEventDate(null, [{ publishedAt: null }])).toBe(null);
    expect(resolveEventDate(null, [])).toBe(null);
  });
});

describe("formatEventDate", () => {
  it("formats to day.month.year without zero-padding", () => {
    expect(formatEventDate("2026-07-05")).toBe("5.7.2026");
    expect(formatEventDate("2026-12-31")).toBe("31.12.2026");
  });
  it("returns null for null or garbage", () => {
    expect(formatEventDate(null)).toBe(null);
    expect(formatEventDate("garbage")).toBe(null);
  });
});
