import { describe, expect, it } from "vitest";
import { parsePublishedAt, ageInDays, freshnessSpread } from "@/lib/news/published-at";

/**
 * serper reports dates as RELATIVE STRINGS — "2 months ago" — and nothing parsed them.
 * Two failures followed from that one gap in the 2026-08-26 scan:
 *
 *  1. `new Date("2 months ago")` is an Invalid Date, and tech-radar's persist layer
 *     handed it straight to Prisma, which rejected the write and lost the item.
 *  2. No stage could ask how old an item was, so the 30-day window went unenforced and
 *     every one of the eleven items written was older than it — the freshest by 56 days.
 *
 * One parser, used by both the age gate and the persist layer, so they cannot disagree.
 */
const NOW = new Date("2026-08-26T12:00:00Z");

describe("parsePublishedAt", () => {
  it("reads an ISO date", () => {
    expect(parsePublishedAt("2026-06-21T00:00:00Z", NOW)?.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });

  it("reads serper's relative strings", () => {
    expect(ageInDays(parsePublishedAt("3 days ago", NOW), NOW)).toBe(3);
    expect(ageInDays(parsePublishedAt("1 day ago", NOW), NOW)).toBe(1);
    expect(ageInDays(parsePublishedAt("2 weeks ago", NOW), NOW)).toBe(14);
    expect(ageInDays(parsePublishedAt("2 months ago", NOW), NOW)).toBe(60);
    expect(ageInDays(parsePublishedAt("1 year ago", NOW), NOW)).toBe(365);
  });

  it("treats hours and minutes as today", () => {
    expect(ageInDays(parsePublishedAt("14 hours ago", NOW), NOW)).toBe(0);
    expect(ageInDays(parsePublishedAt("45 mins ago", NOW), NOW)).toBe(0);
  });

  it("reads an absolute human date", () => {
    expect(ageInDays(parsePublishedAt("Jun 21, 2026", NOW), NOW)).toBe(66);
  });

  /**
   * A date that cannot be read is NOT evidence of freshness. Returning null here is what
   * lets the age gate reject it instead of writing an Invalid Date to the database.
   */
  it("returns null for junk, empty and null — never an Invalid Date", () => {
    for (const bad of ["", "   ", "sometime", null, undefined]) {
      const d = parsePublishedAt(bad as string | null, NOW);
      expect(d).toBeNull();
    }
  });

  it("never returns a Date whose time is NaN", () => {
    const d = parsePublishedAt("2 months ago", NOW);
    expect(d).not.toBeNull();
    expect(Number.isNaN(d!.getTime())).toBe(false);
  });
});

describe("freshnessSpread", () => {
  it("reports freshest, median and oldest in days", () => {
    const s = freshnessSpread(["1 day ago", "10 days ago", "2 months ago"], NOW);
    expect(s).toEqual({ freshest: 1, median: 10, oldest: 60, unknown: 0, counted: 3 });
  });

  it("counts unreadable dates separately instead of hiding them", () => {
    // The 66-day-old story reached an executive because nothing counted anything.
    const s = freshnessSpread(["1 day ago", "sometime", null], NOW);
    expect(s.unknown).toBe(2);
    expect(s.counted).toBe(1);
    expect(s.oldest).toBe(1);
  });

  it("is all-null on an empty list rather than zero, which would read as 'all fresh'", () => {
    expect(freshnessSpread([], NOW)).toEqual({ freshest: null, median: null, oldest: null, unknown: 0, counted: 0 });
  });
});
