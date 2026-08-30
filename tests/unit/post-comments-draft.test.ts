import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  COMMENT_SYSTEM,
  enforceCommentRules,
  parseCommentJson,
  draftPostComment,
  PostCommentGuardError,
} from "@/lib/post-comments/draft";

// draftPostComment goes through openrouterChat — mock the central client directly rather
// than stubbing fetch, so these tests exercise draftPostComment's own guard/retry branching
// without also re-testing the client's kill-switch/budget/network plumbing.
const mockOpenrouterChat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({
  openrouterChat: (...a: unknown[]) => mockOpenrouterChat(...a),
}));

function chatResponse(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}
function chatFailure() {
  return { ok: false, status: 500, detail: "boom" };
}

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
  it("does not flag a banned word inside an unrelated word (substring false positive)", () => {
    expect(enforceCommentRules("כואב לי לרגליים אחרי הריצה")).not.toContain("banned_word");
  });
  it("still catches the real idiom as a whole word", () => {
    expect(enforceCommentRules("לרגל השקת המוצר")).toContain("banned_word");
  });
  it("catches a banned word at end of string with punctuation or nothing after it", () => {
    expect(enforceCommentRules("אנו.")).toContain("banned_word");
    expect(enforceCommentRules("אנו")).toContain("banned_word");
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

describe("draftPostComment", () => {
  beforeEach(() => {
    mockOpenrouterChat.mockReset();
  });

  it("throws PostCommentGuardError (not a plain Error) when the model's text never passes the guard, even after the repair retry", async () => {
    // Both the first attempt and the repair attempt return parseable text that violates
    // the guard (an emoji) — this is the "model answered, guard said no" path.
    mockOpenrouterChat
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ comment: "מעולה 🚀" })))
      .mockResolvedValueOnce(chatResponse(JSON.stringify({ comment: "עדיין מעולה 🚀" })));

    const err: unknown = await draftPostComment({ fullName: "Dana", postText: "post" }).catch(
      (e) => e
    );

    expect(err).toBeInstanceOf(PostCommentGuardError);
    expect(err).toBeInstanceOf(Error);
    expect((err as PostCommentGuardError).violations).toContain("emoji");
    expect(mockOpenrouterChat).toHaveBeenCalledTimes(2);
  });

  it("throws a plain Error, NOT a PostCommentGuardError, when no usable response arrives at all", async () => {
    // Both attempts fail to produce anything parseable at all (timeout/5xx/ok:false) —
    // this is the transient "no usable response" path, which must stay retriable.
    mockOpenrouterChat.mockResolvedValueOnce(chatFailure()).mockResolvedValueOnce(chatFailure());

    const err: unknown = await draftPostComment({ fullName: "Dana", postText: "post" }).catch(
      (e) => e
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PostCommentGuardError);
    expect(mockOpenrouterChat).toHaveBeenCalledTimes(2);
  });

  it("returns the comment on a clean first pass without needing a repair call", async () => {
    mockOpenrouterChat.mockResolvedValueOnce(
      chatResponse(JSON.stringify({ comment: "סחטיין על הנקודה הזאת" }))
    );

    const comment = await draftPostComment({ fullName: "Dana", postText: "post" });

    expect(comment).toBe("סחטיין על הנקודה הזאת");
    expect(mockOpenrouterChat).toHaveBeenCalledTimes(1);
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
