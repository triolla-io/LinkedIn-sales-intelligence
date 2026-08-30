import { describe, expect, it } from "vitest";
import { COMMENT_SYSTEM, enforceCommentRules, parseCommentJson } from "@/lib/post-comments/draft";

describe("enforceCommentRules", () => {
  it("accepts a short casual hebrew comment", () => {
    expect(
      enforceCommentRules("סחטיין על השקיפות, לא מובן מאליו לשתף גם את הכשלים")
    ).toEqual([]);
  });
  it("rejects emojis", () => {
    expect(enforceCommentRules("מעולה 🚀")).toContain("emoji");
  });
  it("rejects over-length comments", () => {
    expect(enforceCommentRules("א".repeat(221))).toContain("too_long");
  });
  it("rejects more than one exclamation mark", () => {
    expect(enforceCommentRules("וואו! מדהים!")).toContain("exclamations");
  });
  it("rejects banned corporate/hype words", () => {
    expect(enforceCommentRules("ברצוני לציין שזה פוסט חשוב")).toContain("banned_word");
    expect(enforceCommentRules("פוסט מדהים ומרגש")).toContain("banned_word");
  });
  it("rejects urls and pitches", () => {
    expect(enforceCommentRules("מזכיר את מה שעשינו ב https://triolla.io")).toContain("url");
  });
});

describe("parseCommentJson", () => {
  it("parses a plain json object", () => {
    expect(parseCommentJson('{"comment":"יפה מאוד"}')).toBe("יפה מאוד");
  });
  it("strips markdown fences", () => {
    expect(parseCommentJson('```json\n{"comment":"יפה"}\n```')).toBe("יפה");
  });
  it("returns null on garbage", () => {
    expect(parseCommentJson("not json")).toBeNull();
    expect(parseCommentJson('{"other":1}')).toBeNull();
  });
});

describe("COMMENT_SYSTEM", () => {
  it("carries the non-negotiable public-comment rules", () => {
    for (const marker of ["אימוג", "ציבורית", "comment", "משפט"]) {
      expect(COMMENT_SYSTEM.toLowerCase()).toContain(marker.toLowerCase());
    }
  });

  it("interpolates MAX_COMMENT_CHARS as a real number, not a literal placeholder", () => {
    expect(COMMENT_SYSTEM).toContain("עד 220 תווים");
    expect(COMMENT_SYSTEM).not.toContain("${MAX_COMMENT_CHARS}");
  });
});
