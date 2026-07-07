import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockContactCount = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    contact: { count: mockContactCount },
  },
}));

const ORG = { id: "org1", name: "Org", monthlyApolloBudget: 500 };
const USER = { id: "user1", orgId: "org1", email: "a@t.com", name: "A", role: "SALESPERSON", org: ORG };

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/contacts/enrich-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contacts/enrich-status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns counts scoped to the effective user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
    // Promise.all order: total, processed, withEmail, withPhone
    mockContactCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const { POST } = await import("@/app/api/contacts/enrich-status/route");
    const res = await POST(makeReq({ contactIds: ["a", "b", "c"], since: "2026-07-06T00:00:00.000Z" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, processed: 2, withEmail: 2, withPhone: 1 });
    for (const call of mockContactCount.mock.calls) {
      expect(call[0].where.ownerId).toBe("user1");
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/contacts/enrich-status/route");
    const res = await POST(makeReq({ contactIds: ["a"], since: "2026-07-06T00:00:00.000Z" }));
    expect(res.status).toBe(401);
  });
});
