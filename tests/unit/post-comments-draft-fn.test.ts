import { describe, it, expect, vi, beforeEach } from "vitest";

// Same pattern as tests/unit/tech-radar-person-scan-retry.test.ts: mock inngest.createFunction
// to just capture the handler, and drive it with a fake `step` whose `run` calls straight
// through (no memoization needed here — these tests exercise one invocation at a time).
//
// Named "-fn" (not "post-comments-draft.test.ts") because that filename is already taken by
// Task 3's test of lib/post-comments/draft.ts's pure guard/parse helpers — this file tests
// the Inngest function's decision logic instead.

// FakePostCommentGuardError stands in for the real lib/post-comments/draft.ts export: the
// Inngest function does `e instanceof PostCommentGuardError`, so the mocked module must
// export the SAME class reference the function imports — a lookalike class or a message
// substring match would not exercise the real narrowing logic at all.
const { FakePrismaClientKnownRequestError, FakePostCommentGuardError } = vi.hoisted(() => {
  class FakePrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  class FakePostCommentGuardError extends Error {
    violations: string[];
    constructor(violations: string[]) {
      super(`post-comment draft failed guard: ${violations.join(",")}`);
      this.violations = violations;
    }
  }
  return { FakePrismaClientKnownRequestError, FakePostCommentGuardError };
});

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockDraftPostComment = vi.fn();

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    linkedInPost: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
    postCommentDraft: { create: (...a: unknown[]) => mockCreate(...a) },
  },
}));
vi.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));
vi.mock("@/lib/post-comments/draft", () => ({
  draftPostComment: (...a: unknown[]) => mockDraftPostComment(...a),
  PostCommentGuardError: FakePostCommentGuardError,
}));

const { postCommentsDraft } = await import("@/inngest/functions/post-comments-draft");
const handler = (postCommentsDraft as unknown as { handler: (a: unknown) => Promise<unknown> })
  .handler;

function fakeStep() {
  return { run: async (_id: string, fn: () => unknown) => fn() };
}

const POST = {
  id: "post1",
  text: "some post text",
  contactId: "c1",
  ownerId: "o1",
  contact: { fullName: "Dana Cohen" },
  drafts: [] as Array<{ id: string }>,
};

beforeEach(() => {
  mockFindUnique.mockReset();
  mockCreate.mockReset();
  mockDraftPostComment.mockReset();
});

describe("post-comments-draft handler", () => {
  it("skips when the post no longer exists, without calling the model", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await handler({ event: { data: { postId: "gone" } }, step: fakeStep() });

    expect(result).toEqual({ skipped: "post_gone" });
    expect(mockDraftPostComment).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("skips when the post already has a draft, without calling the model", async () => {
    mockFindUnique.mockResolvedValue({ ...POST, drafts: [{ id: "d1" }] });

    const result = await handler({ event: { data: { postId: "post1" } }, step: fakeStep() });

    expect(result).toEqual({ skipped: "already_drafted" });
    expect(mockDraftPostComment).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("drafts and stores a comment with the post's own ownerId/contactId, in PENDING_REVIEW", async () => {
    mockFindUnique.mockResolvedValue(POST);
    mockDraftPostComment.mockResolvedValue("סחטיין על הידיעה, נקודה מעניינת");
    mockCreate.mockResolvedValue({ id: "draft1" });

    const result = await handler({ event: { data: { postId: "post1" } }, step: fakeStep() });

    expect(mockDraftPostComment).toHaveBeenCalledWith({
      fullName: "Dana Cohen",
      postText: "some post text",
    });
    // `status` is intentionally omitted here — the schema default (PENDING_REVIEW) applies.
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        postId: "post1",
        contactId: "c1",
        ownerId: "o1",
        commentText: "סחטיין על הידיעה, נקודה מעניינת",
      },
    });
    expect(result).toEqual({ drafted: true });
  });

  it("treats a P2002 race on create as already-drafted rather than a hard failure", async () => {
    mockFindUnique.mockResolvedValue(POST);
    mockDraftPostComment.mockResolvedValue("תגובה תקינה כלשהי");
    mockCreate.mockRejectedValue(new FakePrismaClientKnownRequestError("duplicate", "P2002"));

    const result = await handler({ event: { data: { postId: "post1" } }, step: fakeStep() });

    expect(result).toEqual({ skipped: "already_drafted" });
  });

  it("re-throws a non-P2002 error from create", async () => {
    mockFindUnique.mockResolvedValue(POST);
    mockDraftPostComment.mockResolvedValue("תגובה תקינה כלשהי");
    mockCreate.mockRejectedValue(new Error("connection reset"));

    await expect(
      handler({ event: { data: { postId: "post1" } }, step: fakeStep() })
    ).rejects.toThrow("connection reset");
  });

  it("records a PostCommentGuardError as a DISMISSED row (draft_failed) instead of retrying", async () => {
    // The guard rejected the model's text even after its own internal repair retry — this
    // is permanent, so it must be recorded once and removed from Task 7's
    // `drafts: { none: {} }` candidate set, not left to be re-selected on every future
    // ingest for as long as the post stays inside the freshness window.
    mockFindUnique.mockResolvedValue(POST);
    mockDraftPostComment.mockRejectedValue(new FakePostCommentGuardError(["too_long"]));
    mockCreate.mockResolvedValue({ id: "draft1" });

    const result = await handler({ event: { data: { postId: "post1" } }, step: fakeStep() });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postId: "post1",
        contactId: "c1",
        ownerId: "o1",
        status: "DISMISSED",
        dismissReason: "draft_failed",
      }),
    });
    expect(result).toEqual({ skipped: "draft_failed" });
  });

  // Deliberately asserts BOTH halves (no row + does reject) so this fails loudly if a
  // future edit widens the catch beyond `instanceof PostCommentGuardError` — e.g. to catch
  // every Error — which would silently and permanently dismiss drafts during a transient
  // OpenRouter outage instead of letting Inngest retry them tomorrow.
  it("does NOT create a row for a plain Error (transient outage) and lets it propagate so Inngest retries", async () => {
    mockFindUnique.mockResolvedValue(POST);
    mockDraftPostComment.mockRejectedValue(
      new Error("post-comment draft failed: model returned nothing usable")
    );

    await expect(
      handler({ event: { data: { postId: "post1" } }, step: fakeStep() })
    ).rejects.toThrow("model returned nothing usable");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
