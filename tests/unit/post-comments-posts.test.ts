import { describe, it, expect } from "vitest";
import {
  buildActivityUrl,
  normalizeUrn,
  parsePostedAgo,
  postUrlFromUrn,
  validateScrapedPosts,
} from "@/lib/post-comments/posts";

const NOW = new Date("2026-08-30T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("normalizeUrn", () => {
  it("extracts the activity urn from a data-urn attribute", () => {
    expect(normalizeUrn("urn:li:activity:7365000000000000000")).toBe(
      "urn:li:activity:7365000000000000000"
    );
    expect(
      normalizeUrn("urn:li:aggregate:(urn:li:activity:7365000000000000001)")
    ).toBe("urn:li:activity:7365000000000000001");
  });
  it("returns null when there is no activity urn", () => {
    expect(normalizeUrn("urn:li:comment:123")).toBeNull();
    expect(normalizeUrn("")).toBeNull();
  });
});

describe("urls", () => {
  it("builds the recent-activity url from a profile url", () => {
    expect(buildActivityUrl("https://www.linkedin.com/in/somebody/")).toBe(
      "https://www.linkedin.com/in/somebody/recent-activity/all/"
    );
    expect(buildActivityUrl("https://www.linkedin.com/in/somebody")).toBe(
      "https://www.linkedin.com/in/somebody/recent-activity/all/"
    );
  });
  it("builds a post permalink from an urn", () => {
    expect(postUrlFromUrn("urn:li:activity:7365000000000000000")).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:7365000000000000000/"
    );
  });
});

describe("parsePostedAgo", () => {
  it("parses english relative times", () => {
    expect(parsePostedAgo("3d", NOW)).toEqual(days(3));
    expect(parsePostedAgo("2w", NOW)).toEqual(days(14));
    expect(parsePostedAgo("5h", NOW)).toEqual(
      new Date(NOW.getTime() - 5 * 3600_000)
    );
    expect(parsePostedAgo("1mo", NOW)).toEqual(days(30));
    expect(parsePostedAgo("2yr", NOW)).toEqual(days(2 * 365));
    expect(parsePostedAgo("3d • Edited", NOW)).toEqual(days(3));
  });
  it("parses hebrew relative times", () => {
    expect(parsePostedAgo("לפני 3 ימים", NOW)).toEqual(days(3));
    expect(parsePostedAgo("יומיים", NOW)).toEqual(days(2));
    expect(parsePostedAgo("שבוע", NOW)).toEqual(days(7));
    expect(parsePostedAgo("שבועיים", NOW)).toEqual(days(14));
    expect(parsePostedAgo("לפני שעה", NOW)).toEqual(
      new Date(NOW.getTime() - 3600_000)
    );
    expect(parsePostedAgo("חודש", NOW)).toEqual(days(30));
  });
  it("returns null for unparseable strings", () => {
    expect(parsePostedAgo("", NOW)).toBeNull();
    expect(parsePostedAgo("Promoted", NOW)).toBeNull();
  });
});

describe("validateScrapedPosts", () => {
  it("keeps valid entries, drops junk, dedupes by urn", () => {
    const out = validateScrapedPosts([
      { urn: "urn:li:activity:1", text: "פוסט ראשון", postedAgoText: "3d" },
      { urn: "urn:li:activity:1", text: "duplicate", postedAgoText: null },
      { urn: "urn:li:activity:2", text: "  ", postedAgoText: "1w" }, // empty text
      { urn: "not-an-urn", text: "junk", postedAgoText: null },
      "garbage",
    ]);
    expect(out).toEqual([
      { urn: "urn:li:activity:1", text: "פוסט ראשון", postedAgoText: "3d" },
    ]);
  });
  it("returns [] for non-arrays", () => {
    expect(validateScrapedPosts(undefined)).toEqual([]);
    expect(validateScrapedPosts({})).toEqual([]);
  });
});
