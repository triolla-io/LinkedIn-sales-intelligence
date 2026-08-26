import { describe, expect, it } from "vitest";
import { serperDateToIso } from "@/lib/news/serper";

const NOW = new Date("2026-08-26T12:00:00Z");

describe("serperDateToIso", () => {
  it("converts relative day strings", () => {
    expect(serperDateToIso("2 days ago", NOW)).toBe("2026-08-24T12:00:00.000Z");
  });
  it("converts hours, weeks and months", () => {
    expect(serperDateToIso("3 hours ago", NOW)).toBe("2026-08-26T09:00:00.000Z");
    expect(serperDateToIso("1 week ago", NOW)).toBe("2026-08-19T12:00:00.000Z");
    expect(serperDateToIso("1 month ago", NOW)).toBe("2026-07-27T12:00:00.000Z");
  });
  it("passes absolute dates through as ISO", () => {
    expect(serperDateToIso("2026-08-20T00:00:00Z", NOW)).toBe("2026-08-20T00:00:00.000Z");
  });
  it("returns null for garbage — null means the freshness gate rejects it", () => {
    expect(serperDateToIso("yesterday-ish", NOW)).toBeNull();
    expect(serperDateToIso(undefined, NOW)).toBeNull();
    expect(serperDateToIso("", NOW)).toBeNull();
  });
});
