import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactFindUnique = vi.fn();
const mockPostFindMany = vi.fn();
const mockPostCreate = vi.fn();
const mockSend = vi.fn();

// Minimal stand-in for Prisma's error class so `instanceof` checks in ingest.ts work
// without pulling in the generated client. vi.mock factories are hoisted above imports,
// so the class must be created through vi.hoisted to be usable inside them.
const { FakePrismaClientKnownRequestError } = vi.hoisted(() => {
  class FakePrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { FakePrismaClientKnownRequestError };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findUnique: (...a: unknown[]) => mockContactFindUnique(...a) },
    linkedInPost: {
      findMany: (...a: unknown[]) => mockPostFindMany(...a),
      create: (...a: unknown[]) => mockPostCreate(...a),
    },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { send: (...a: unknown[]) => mockSend(...a) } }));
vi.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError },
}));

import { ingestScrapedPosts } from "@/lib/post-comments/ingest";

const CONTACT = { id: "c1", ownerId: "o1", postWatchEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockContactFindUnique.mockResolvedValue(CONTACT);
  mockPostFindMany.mockResolvedValue([]);
  mockPostCreate.mockImplementation(async ({ data }: { data: { activityUrn: string } }) => ({
    id: `row-${data.activityUrn}`,
    ...data,
  }));
});

function task(posts: unknown[], payload: unknown = { contactId: "c1" }) {
  return { id: "t1", payload, result: { posts } };
}

describe("ingestScrapedPosts", () => {
  it("persists new posts, skips already-known urns, and drafts only fresh ones", async () => {
    mockPostFindMany.mockResolvedValue([{ activityUrn: "urn:li:activity:1" }]);
    const res = await ingestScrapedPosts(
      task([
        { urn: "urn:li:activity:1", text: "already known", postedAgoText: "1d" },
        { urn: "urn:li:activity:2", text: "new + fresh", postedAgoText: "2d" },
        { urn: "urn:li:activity:3", text: "new + stale", postedAgoText: "3mo" },
      ])
    );

    expect(mockPostCreate).toHaveBeenCalledTimes(2); // urn 1 skipped, 2 and 3 created
    expect(res.created).toBe(2);
    expect(res.drafted).toBe(1); // only urn 2 is fresh
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith([
      { name: "post-comments.draft", data: { postId: "row-urn:li:activity:2" } },
    ]);
  });

  it("caps drafts at 3 per ingest while still persisting every fresh post", async () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({
      urn: `urn:li:activity:${i}`,
      text: `post ${i}`,
      postedAgoText: "1d", // all fresh
    }));
    const res = await ingestScrapedPosts(task(posts));

    expect(res.created).toBe(5);
    expect(res.drafted).toBe(3);
    expect(mockPostCreate).toHaveBeenCalledTimes(5); // cap limits drafts, not persistence
    const sentBatch = mockSend.mock.calls[0][0] as Array<{ data: { postId: string } }>;
    expect(sentBatch).toHaveLength(3);
    // Extension returns newest-first; cap keeps the first 3 qualifying, i.e. the most recent.
    expect(sentBatch.map((e) => e.data.postId)).toEqual([
      "row-urn:li:activity:0",
      "row-urn:li:activity:1",
      "row-urn:li:activity:2",
    ]);
  });

  it("persists posts but never drafts when the contact is no longer watched", async () => {
    mockContactFindUnique.mockResolvedValue({ ...CONTACT, postWatchEnabled: false });
    const res = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:1", text: "hello", postedAgoText: "1d" }])
    );

    expect(res.created).toBe(1);
    expect(res.drafted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns zero and does no work when the contact no longer exists", async () => {
    mockContactFindUnique.mockResolvedValue(null);
    const res = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:1", text: "hello", postedAgoText: "1d" }])
    );

    expect(res).toEqual({ created: 0, drafted: 0 });
    expect(mockPostFindMany).not.toHaveBeenCalled();
    expect(mockPostCreate).not.toHaveBeenCalled();
  });

  it("treats a P2002 unique-constraint race as already-ingested, not a hard failure", async () => {
    mockPostCreate.mockImplementation(async ({ data }: { data: { activityUrn: string } }) => {
      if (data.activityUrn === "urn:li:activity:1") {
        throw new FakePrismaClientKnownRequestError("duplicate", "P2002");
      }
      return { id: `row-${data.activityUrn}`, ...data };
    });

    const res = await ingestScrapedPosts(
      task([
        { urn: "urn:li:activity:1", text: "racing", postedAgoText: "1d" },
        { urn: "urn:li:activity:2", text: "fine", postedAgoText: "1d" },
      ])
    );

    expect(res.created).toBe(1); // only urn 2 counted
    expect(res.drafted).toBe(1);
    expect(mockSend).toHaveBeenCalledWith([
      { name: "post-comments.draft", data: { postId: "row-urn:li:activity:2" } },
    ]);
  });

  it("re-throws a non-P2002 error from create", async () => {
    mockPostCreate.mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      ingestScrapedPosts(task([{ urn: "urn:li:activity:1", text: "boom", postedAgoText: "1d" }]))
    ).rejects.toThrow("connection reset");
  });

  it("treats unparseable postedAgoText as unknown age and drafts it (unknown = fresh)", async () => {
    const res = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:1", text: "weird date", postedAgoText: "gibberish" }])
    );
    expect(res.created).toBe(1);
    expect(res.drafted).toBe(1);
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
