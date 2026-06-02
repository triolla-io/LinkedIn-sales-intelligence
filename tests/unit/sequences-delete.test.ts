import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "user1", orgId: null, role: "SALESPERSON", org: null }) },
    sequence: {
      findFirst: mockFindFirst,
      delete: mockDelete,
    },
  },
}));

function makeReq(method = "DELETE") {
  return new NextRequest("http://localhost/api/sequences/seq1", { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user1" } });
});

describe("DELETE /api/sequences/[id]", () => {
  it("returns 404 when sequence not found", async () => {
    mockFindFirst.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/sequences/[id]/route");
    const res = await DELETE(makeReq(), { params: Promise.resolve({ id: "seq1" }) });
    expect(res.status).toBe(404);
  });

  it("deletes and returns 204 when sequence belongs to user", async () => {
    mockFindFirst.mockResolvedValue({ id: "seq1", ownerId: "user1" });
    mockDelete.mockResolvedValue({});
    const { DELETE } = await import("@/app/api/sequences/[id]/route");
    const res = await DELETE(makeReq(), { params: Promise.resolve({ id: "seq1" }) });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "seq1" } });
    expect(res.status).toBe(204);
  });
});
