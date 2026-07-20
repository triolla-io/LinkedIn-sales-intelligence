import { describe, it, expect, vi, beforeEach } from "vitest";

const createMany = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const updateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: { mcpAccessToken: { create, findMany, updateMany } },
}));

beforeEach(() => vi.clearAllMocks());

describe("mcp tokens", () => {
  it("generateRawToken is prefixed and unique", async () => {
    const { generateRawToken } = await import("@/lib/mcp/tokens");
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a.startsWith("mcp_")).toBe(true);
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(40);
  });

  it("hashToken is stable sha256 hex", async () => {
    const { hashToken } = await import("@/lib/mcp/tokens");
    expect(hashToken("mcp_abc")).toEqual(hashToken("mcp_abc"));
    expect(hashToken("mcp_abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createToken stores only the hash and returns the raw once", async () => {
    create.mockResolvedValue({ id: "t1" });
    const { createToken, hashToken } = await import("@/lib/mcp/tokens");
    const { id, raw } = await createToken("user1", "laptop");
    expect(id).toBe("t1");
    expect(raw.startsWith("mcp_")).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { userId: "user1", label: "laptop", tokenHash: hashToken(raw) },
      select: { id: true },
    });
  });

  it("revokeToken scopes by userId and reports whether a row changed", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const { revokeToken } = await import("@/lib/mcp/tokens");
    const ok = await revokeToken("user1", "t1");
    expect(ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "t1", userId: "user1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
