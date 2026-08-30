import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockContactUpdateMany = vi.fn();
const mockContactFindMany = vi.fn();
const mockDispatchPostScrapes = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    contact: { updateMany: mockContactUpdateMany, findMany: mockContactFindMany },
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

function getReq(q?: string) {
  const url = q ? `http://localhost/api/post-comments/people?q=${encodeURIComponent(q)}` : "http://localhost/api/post-comments/people";
  return new NextRequest(url);
}

describe("GET /api/post-comments/people", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
    mockContactFindMany.mockResolvedValue([]);
  });

  it("scopes the `marked` query to this owner", async () => {
    const { GET } = await import("@/app/api/post-comments/people/route");
    await GET(getReq());

    expect(mockContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "user1" }) })
    );
  });

  // 2026-08-30 measured regression: `NOT: { postWatchEnabled: true }` matched 0 of
  // 16,250 dev-DB contacts because Prisma's NOT excludes NULLs, and postWatchEnabled is
  // Boolean? with no default — every never-toggled contact is null. That silently made
  // the picker's search return nothing, forever. This pins the query shape so a future
  // "simplification" back to NOT fails loudly here instead of shipping silently broken.
  it("scopes the `matches` search query to this owner AND includes null postWatchEnabled via OR, not NOT", async () => {
    const { GET } = await import("@/app/api/post-comments/people/route");
    await GET(getReq("dana"));

    // marked call first, matches call second
    expect(mockContactFindMany).toHaveBeenCalledTimes(2);
    const matchesCall = mockContactFindMany.mock.calls[1][0];
    expect(matchesCall.where.ownerId).toBe("user1");
    expect(matchesCall.where.OR).toEqual([{ postWatchEnabled: false }, { postWatchEnabled: null }]);
    expect(matchesCall.where.NOT).toBeUndefined();
  });

  it("does not run the matches query at all when q is empty", async () => {
    const { GET } = await import("@/app/api/post-comments/people/route");
    await GET(getReq());

    expect(mockContactFindMany).toHaveBeenCalledTimes(1);
  });
});

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
