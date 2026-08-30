import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockContactUpdateMany = vi.fn();
const mockDispatchPostScrapes = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    contact: { updateMany: mockContactUpdateMany, findMany: vi.fn() },
  },
}));
vi.mock("@/lib/post-comments/dispatch", () => ({
  dispatchPostScrapes: mockDispatchPostScrapes,
}));

const ORG = { id: "org1", name: "Org", postCommentsEnabled: true };
const USER = { id: "user1", orgId: "org1", email: "a@t.com", name: "A", role: "SALESPERSON", org: ORG };

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/post-comments/people", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/post-comments/people", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
  });

  it("404s when the contact does not belong to this owner (tenancy)", async () => {
    // updateMany's WHERE is scoped to ownerId — a foreign contact's id matches zero rows.
    mockContactUpdateMany.mockResolvedValue({ count: 0 });

    const { PATCH } = await import("@/app/api/post-comments/people/route");
    const res = await PATCH(patchReq({ contactId: "someone-elses-contact", value: true }));

    expect(res.status).toBe(404);
    expect(mockContactUpdateMany).toHaveBeenCalledWith({
      where: { id: "someone-elses-contact", ownerId: "user1", removedAt: null },
      data: expect.objectContaining({ postWatchEnabled: true }),
    });
    expect(mockDispatchPostScrapes).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean value at 400 without touching the database", async () => {
    const { PATCH } = await import("@/app/api/post-comments/people/route");
    const res = await PATCH(patchReq({ contactId: "c1", value: "yes" }));

    expect(res.status).toBe(400);
    expect(mockContactUpdateMany).not.toHaveBeenCalled();
  });

  it("following (value: true) dispatches a scrape scoped to just that contact", async () => {
    mockContactUpdateMany.mockResolvedValue({ count: 1 });

    const { PATCH } = await import("@/app/api/post-comments/people/route");
    const res = await PATCH(patchReq({ contactId: "c1", value: true }));

    expect(res.status).toBe(200);
    expect(mockDispatchPostScrapes).toHaveBeenCalledWith({ contactIds: ["c1"] });
  });

  it("unfollowing (value: false) does not dispatch a scrape", async () => {
    mockContactUpdateMany.mockResolvedValue({ count: 1 });

    const { PATCH } = await import("@/app/api/post-comments/people/route");
    const res = await PATCH(patchReq({ contactId: "c1", value: false }));

    expect(res.status).toBe(200);
    expect(mockDispatchPostScrapes).not.toHaveBeenCalled();
  });
});
