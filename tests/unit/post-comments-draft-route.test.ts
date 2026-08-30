import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockDraftFindFirst = vi.fn();
const mockDraftUpdate = vi.fn();
const mockDraftUpdateMany = vi.fn();
const mockTaskCreate = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    postCommentDraft: {
      findFirst: mockDraftFindFirst,
      update: mockDraftUpdate,
      updateMany: mockDraftUpdateMany,
    },
    extensionTask: { create: mockTaskCreate },
  },
}));

const ORG = { id: "org1", name: "Org", postCommentsEnabled: true };
const USER = { id: "user1", orgId: "org1", email: "a@t.com", name: "A", role: "SALESPERSON", org: ORG };

const DRAFT = {
  id: "draft1",
  post: { postUrl: "https://linkedin.com/feed/update/urn:li:activity:1" },
  contact: { fullName: "דנה כהן" },
};

function patchReq(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/post-comments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/post-comments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
  });

  it("404s when the draft belongs to another owner (tenancy)", async () => {
    // findFirst is scoped by ownerId in the route's WHERE — a foreign draft's id
    // matches nothing, which is exactly what this mock simulates.
    mockDraftFindFirst.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("someone-elses-draft", { action: "sent" }));

    expect(res.status).toBe(404);
    expect(mockDraftUpdateMany).not.toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("rejects a comment with an emoji at 422 and writes nothing", async () => {
    mockDraftFindFirst.mockResolvedValue(DRAFT);

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("draft1", { action: "save", comment: "יפה מאוד 🎉" }));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.violations).toContain("emoji");
    expect(mockDraftUpdate).not.toHaveBeenCalled();
  });

  it("rejects a prepare with a banned word at 422 and never queues a task", async () => {
    mockDraftFindFirst.mockResolvedValue(DRAFT);

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("draft1", { action: "prepare", comment: "אנו שמחים לשתף" }));

    expect(res.status).toBe(422);
    expect(mockDraftUpdateMany).not.toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("prepares a clean comment: flips status via a guarded updateMany, then queues PREPARE_COMMENT", async () => {
    mockDraftFindFirst.mockResolvedValue(DRAFT);
    mockDraftUpdateMany.mockResolvedValue({ count: 1 });

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("draft1", { action: "prepare", comment: "לגמרי נכון, ראיתי דבר דומה השבוע" }));

    expect(res.status).toBe(200);
    expect(mockDraftUpdateMany).toHaveBeenCalledWith({
      where: { id: "draft1", status: "PENDING_REVIEW" },
      data: { status: "PREPARING", commentText: "לגמרי נכון, ראיתי דבר דומה השבוע" },
    });
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);
    const call = mockTaskCreate.mock.calls[0][0];
    expect(call.data.kind).toBe("PREPARE_COMMENT");
    expect(call.data.postCommentDraftId).toBe("draft1");
    expect(call.data.payload).toEqual({
      postUrl: DRAFT.post.postUrl,
      text: "לגמרי נכון, ראיתי דבר דומה השבוע",
      recipientName: "דנה כהן",
    });
  });

  it("409s on prepare when the draft is not PENDING_REVIEW (double-click guard) and never queues a second task", async () => {
    mockDraftFindFirst.mockResolvedValue(DRAFT);
    // Simulates a second concurrent PATCH: the first request already flipped the row to
    // PREPARING, so this updateMany's status-scoped WHERE matches nothing.
    mockDraftUpdateMany.mockResolvedValue({ count: 0 });

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("draft1", { action: "prepare", comment: "תגובה תקינה לגמרי" }));

    expect(res.status).toBe(409);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("409s on sent when the draft is not PREPARED/PREPARING", async () => {
    mockDraftFindFirst.mockResolvedValue(DRAFT);
    mockDraftUpdateMany.mockResolvedValue({ count: 0 });

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("draft1", { action: "sent" }));

    expect(res.status).toBe(409);
    expect(mockDraftUpdateMany).toHaveBeenCalledWith({
      where: { id: "draft1", status: { in: ["PREPARED", "PREPARING"] } },
      data: expect.objectContaining({ status: "SENT" }),
    });
  });

  it("dismisses regardless of current status and records the reason", async () => {
    mockDraftFindFirst.mockResolvedValue(DRAFT);

    const { PATCH } = await import("@/app/api/post-comments/[id]/route");
    const res = await PATCH(patchReq("draft1", { action: "dismiss", reason: "not_relevant" }));

    expect(res.status).toBe(200);
    expect(mockDraftUpdate).toHaveBeenCalledWith({
      where: { id: "draft1" },
      data: { status: "DISMISSED", dismissReason: "not_relevant" },
    });
  });
});
