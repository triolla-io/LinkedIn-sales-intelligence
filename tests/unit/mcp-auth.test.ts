import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: { mcpAccessToken: { findFirst, update } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
});

async function resolve(header: string | null) {
  const { resolveMcpUser } = await import("@/lib/mcp/auth");
  return resolveMcpUser(header);
}

describe("resolveMcpUser", () => {
  it("rejects a missing/malformed header", async () => {
    await expect(resolve(null)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(resolve("Basic xyz")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects an unknown/revoked token", async () => {
    findFirst.mockResolvedValue(null);
    await expect(resolve("Bearer mcp_nope")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a non-triolla owner", async () => {
    findFirst.mockResolvedValue({
      id: "t1",
      user: { id: "u1", orgId: "o1", email: "someone@gmail.com" },
    });
    await expect(resolve("Bearer mcp_x")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("resolves a valid triolla token and touches lastUsedAt", async () => {
    findFirst.mockResolvedValue({
      id: "t1",
      user: { id: "u1", orgId: "o1", email: "ariel@triolla.io" },
    });
    const ctx = await resolve("Bearer mcp_good");
    expect(ctx).toEqual({ userId: "u1", orgId: "o1", email: "ariel@triolla.io" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
