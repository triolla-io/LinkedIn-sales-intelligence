import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockContactFindUnique = vi.fn();
const mockPostFindMany = vi.fn();
const mockPostCreate = vi.fn();
const mockSend = vi.fn();

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

// --- A tiny in-memory stand-in for the LinkedInPost table --------------------------------
// The fix under test derives the draft set from committed DB state (`drafts: { none: {} }`
// + a freshness filter) rather than from an in-memory list built during the persist loop.
// Asserting that requires the mock to actually behave like a filtered/sorted/paginated
// query — a plain `mockResolvedValue` can't distinguish "known urns" lookups from
// "undrafted + fresh" candidate lookups, or honor `orderBy`/`take`. So `findMany` is
// backed by a real filter+sort over a small fake table instead.

type FakePost = {
  id: string;
  contactId: string;
  ownerId: string;
  activityUrn: string;
  postUrl: string;
  text: string;
  postedAgoText: string | null;
  postedAt: Date | null;
  createdAt: Date;
  hasDraft: boolean;
};

type WhereArg = {
  ownerId?: string;
  contactId?: string;
  activityUrn?: { in?: string[] };
  drafts?: { none?: unknown };
  OR?: Array<{ postedAt?: null | { gte?: Date } }>;
};
type OrderArg = { postedAt?: string | { sort: string; nulls?: string }; createdAt?: string };

let postsTable: FakePost[] = [];
let idCounter = 0;
const BASE_TIME = new Date("2026-08-01T00:00:00Z").getTime();

function matchesWhere(row: FakePost, where: WhereArg): boolean {
  if (where.ownerId !== undefined && row.ownerId !== where.ownerId) return false;
  if (where.contactId !== undefined && row.contactId !== where.contactId) return false;
  if (where.activityUrn?.in && !where.activityUrn.in.includes(row.activityUrn)) return false;
  if (where.drafts?.none !== undefined && row.hasDraft) return false;
  if (where.OR) {
    const matches = where.OR.some((cond) => {
      if (!cond || !("postedAt" in cond)) return false;
      if (cond.postedAt === null) return row.postedAt === null;
      if (cond.postedAt && typeof cond.postedAt === "object" && cond.postedAt.gte) {
        return row.postedAt !== null && row.postedAt.getTime() >= cond.postedAt.gte.getTime();
      }
      return false;
    });
    if (!matches) return false;
  }
  return true;
}

function compareByOrder(a: FakePost, b: FakePost, orderBy: OrderArg[]): number {
  for (const ord of orderBy) {
    if (ord.postedAt) {
      const spec = ord.postedAt;
      const sort = typeof spec === "string" ? spec : spec.sort;
      const nulls = typeof spec === "string" ? undefined : spec.nulls;
      const av = a.postedAt;
      const bv = b.postedAt;
      if (av === null || bv === null) {
        if (av === null && bv === null) continue;
        if (nulls === "last") return av === null ? 1 : -1;
        if (nulls === "first") return av === null ? -1 : 1;
        continue; // no explicit nulls handling requested — treat as a tie, fall through
      }
      const diff = sort === "asc" ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
      if (diff !== 0) return diff;
    } else if (ord.createdAt) {
      const diff =
        ord.createdAt === "asc"
          ? a.createdAt.getTime() - b.createdAt.getTime()
          : b.createdAt.getTime() - a.createdAt.getTime();
      if (diff !== 0) return diff;
    }
  }
  return 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  postsTable = [];
  idCounter = 0;
  mockContactFindUnique.mockResolvedValue(CONTACT);

  mockPostFindMany.mockImplementation(
    async (args: { where?: WhereArg; orderBy?: OrderArg | OrderArg[]; take?: number; select?: Record<string, boolean> }) => {
      let rows = postsTable.filter((r) => matchesWhere(r, args.where ?? {}));
      if (args.orderBy) {
        const orderBy = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
        rows = [...rows].sort((a, b) => compareByOrder(a, b, orderBy));
      }
      if (typeof args.take === "number") rows = rows.slice(0, args.take);
      if (args.select) {
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(args.select!)) out[key] = (r as unknown as Record<string, unknown>)[key];
          return out;
        });
      }
      return rows;
    }
  );

  mockPostCreate.mockImplementation(async ({ data }: { data: Omit<FakePost, "id" | "createdAt" | "hasDraft"> }) => {
    if (postsTable.some((r) => r.ownerId === data.ownerId && r.activityUrn === data.activityUrn)) {
      throw new FakePrismaClientKnownRequestError("duplicate", "P2002");
    }
    idCounter += 1;
    const row: FakePost = {
      id: `row-${data.activityUrn}`,
      ...data,
      createdAt: new Date(BASE_TIME + idCounter * 1000),
      hasDraft: false,
    };
    postsTable.push(row);
    return { ...row };
  });
});

function seedPost(overrides: Partial<FakePost>): FakePost {
  idCounter += 1;
  const row: FakePost = {
    id: `row-${overrides.activityUrn ?? `urn:li:activity:${9000 + idCounter}`}`,
    contactId: "c1",
    ownerId: "o1",
    // normalizeUrn requires a numeric suffix — default falls back to one so seedPost()
    // calls that don't override the urn still produce a realistic id.
    activityUrn: `urn:li:activity:${9000 + idCounter}`,
    postUrl: "https://www.linkedin.com/feed/update/seed/",
    text: "seed text",
    postedAgoText: "1d",
    postedAt: new Date(),
    createdAt: new Date(BASE_TIME + idCounter * 1000),
    hasDraft: false,
    ...overrides,
  };
  postsTable.push(row);
  return row;
}

function task(posts: unknown[], payload: unknown = { contactId: "c1" }) {
  return { id: "t1", payload, result: { posts } };
}

function sentPostIds(): string[] {
  if (mockSend.mock.calls.length === 0) return [];
  const batch = mockSend.mock.calls[mockSend.mock.calls.length - 1][0] as Array<{
    data: { postId: string };
  }>;
  return batch.map((e) => e.data.postId);
}

describe("ingestScrapedPosts", () => {
  it("persists new posts, skips already-known urns, and drafts only fresh + undrafted ones", async () => {
    // Simulates a normal re-scrape: urn 1 was ingested (and already drafted) previously.
    seedPost({ activityUrn: "urn:li:activity:1", postedAt: new Date(), hasDraft: true });

    const res = await ingestScrapedPosts(
      task([
        { urn: "urn:li:activity:1", text: "already known", postedAgoText: "1d" },
        { urn: "urn:li:activity:2", text: "new + fresh", postedAgoText: "2d" },
        { urn: "urn:li:activity:3", text: "new + stale", postedAgoText: "3mo" },
      ])
    );

    expect(mockPostCreate).toHaveBeenCalledTimes(2); // urn 1 skipped, 2 and 3 created
    expect(res.created).toBe(2);
    expect(res.drafted).toBe(1); // only urn 2 is fresh and undrafted
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(sentPostIds()).toEqual(["row-urn:li:activity:2"]);
  });

  it("caps drafts at 3 per ingest while still persisting every fresh post", async () => {
    // Distinct, strictly decreasing recency so ranking is unambiguous (no postedAt ties).
    const offsets = ["1h", "3h", "6h", "12h", "20h"];
    const posts = offsets.map((postedAgoText, i) => ({
      urn: `urn:li:activity:${i}`,
      text: `post ${i}`,
      postedAgoText,
    }));
    const res = await ingestScrapedPosts(task(posts));

    expect(res.created).toBe(5);
    expect(res.drafted).toBe(3);
    expect(mockPostCreate).toHaveBeenCalledTimes(5); // cap limits drafts, not persistence
    // The 3 most-recently-posted (smallest offset) win the capped slots.
    expect(sentPostIds()).toEqual([
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
    // The gate short-circuits before the candidate query — only the "known urns" lookup ran.
    expect(mockPostFindMany).toHaveBeenCalledTimes(1);
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
    mockPostCreate.mockImplementationOnce(async () => {
      throw new FakePrismaClientKnownRequestError("duplicate", "P2002");
    });

    const res = await ingestScrapedPosts(
      task([
        { urn: "urn:li:activity:1", text: "racing", postedAgoText: "1d" },
        { urn: "urn:li:activity:2", text: "fine", postedAgoText: "1d" },
      ])
    );

    expect(res.created).toBe(1); // only urn 2 counted
    expect(res.drafted).toBe(1);
    expect(sentPostIds()).toEqual(["row-urn:li:activity:2"]);
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

  // --- Regression coverage for the "silent loss on retry" finding --------------------

  it("is idempotent: re-ingesting the same payload after downstream drafting has caught up creates and sends nothing new", async () => {
    const posts = [
      { urn: "urn:li:activity:1", text: "fresh", postedAgoText: "1d" },
      { urn: "urn:li:activity:2", text: "stale", postedAgoText: "3mo" },
    ];

    const first = await ingestScrapedPosts(task(posts));
    expect(first.created).toBe(2);
    expect(first.drafted).toBe(1);

    // Model the real pipeline: post-comments.draft is handled almost immediately by a
    // downstream function (not this one) that creates the PostCommentDraft row. By the
    // time a second scrape of the same profile happens (next day), that has completed.
    const drafted = postsTable.find((p) => p.activityUrn === "urn:li:activity:1");
    if (drafted) drafted.hasDraft = true;

    mockSend.mockClear();
    const second = await ingestScrapedPosts(task(posts));

    expect(second.created).toBe(0); // both urns are now known — nothing re-persisted
    expect(second.drafted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockPostCreate).toHaveBeenCalledTimes(2); // unchanged since the first run
  });

  it("self-heals a post that was persisted but never drafted (the crash-before-send case) — would fail against the old in-memory design", async () => {
    // Simulate a prior run that persisted the post and then died before it could collect
    // it into an in-memory draft list / send the event: the row exists, is fresh, has no
    // draft. Under the OLD implementation, re-running ingestScrapedPosts with this urn
    // already `known` would `continue` past it in the loop and never re-add it to
    // `toDraft` — permanently losing the draft. The DB-derived candidate query must
    // still pick it up.
    seedPost({
      activityUrn: "urn:li:activity:9001",
      postedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day old — fresh
      hasDraft: false,
    });

    const res = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:9001", text: "orphaned by a crash", postedAgoText: "1d" }])
    );

    expect(res.created).toBe(0); // already persisted — the loop skips it via `known`
    expect(res.drafted).toBe(1); // but the candidate query still finds it and drafts it
    expect(sentPostIds()).toEqual(["row-urn:li:activity:9001"]);
  });

  it("does not re-draft a post that already has a PostCommentDraft", async () => {
    seedPost({
      activityUrn: "urn:li:activity:9002",
      postedAt: new Date(),
      hasDraft: true,
    });

    const res = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:9002", text: "seen it", postedAgoText: "1d" }])
    );

    expect(res.created).toBe(0);
    expect(res.drafted).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("orders confirmed-recent posts ahead of unknown-age ones so nulls cannot monopolize the capped slots, and the bumped null is not lost", async () => {
    seedPost({ activityUrn: "urn:li:activity:9101", postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    seedPost({ activityUrn: "urn:li:activity:9102", postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) });
    seedPost({ activityUrn: "urn:li:activity:9103", postedAt: new Date(Date.now() - 9 * 60 * 60 * 1000) });
    seedPost({ activityUrn: "urn:li:activity:9104", postedAt: null }); // unknown age = fresh

    // 4 fresh, undrafted candidates for a cap of 3 — the null-postedAt one must lose out
    // to the 3 dated ones rather than crowd them out (which nulls-first ordering would do).
    // "9199" is an unrelated filler post (stale, so it can never itself be a candidate) —
    // it exists only so this ingest's own posts array isn't empty (an empty scraped list
    // short-circuits before the candidate query even runs).
    const res = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:9199", text: "irrelevant", postedAgoText: "3mo" }])
    );
    expect(res.drafted).toBe(3);
    expect(sentPostIds()).toEqual([
      "row-urn:li:activity:9101",
      "row-urn:li:activity:9102",
      "row-urn:li:activity:9103",
    ]);

    // Once the dated posts are drafted (simulating downstream catching up), the
    // previously-bumped null-postedAt post is not lost — it surfaces on the next run.
    for (const urn of ["urn:li:activity:9101", "urn:li:activity:9102", "urn:li:activity:9103"]) {
      const row = postsTable.find((p) => p.activityUrn === urn);
      if (row) row.hasDraft = true;
    }
    mockSend.mockClear();
    const second = await ingestScrapedPosts(
      task([{ urn: "urn:li:activity:9199", text: "irrelevant", postedAgoText: "3mo" }])
    );
    expect(second.drafted).toBe(1);
    expect(sentPostIds()).toEqual(["row-urn:li:activity:9104"]);
  });
});
