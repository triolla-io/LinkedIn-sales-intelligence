import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());
const createToken = vi.hoisted(() => vi.fn());
const listTokens = vi.hoisted(() => vi.fn());
const revokeToken = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: userFindUnique } } }));
vi.mock("@/lib/mcp/tokens", () => ({ createToken, listTokens, revokeToken }));

function req(body?: unknown) {
  return new NextRequest("http://localhost/api/mcp/tokens", {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1" } });
  userFindUnique.mockResolvedValue({
    id: "u1",
    role: "SALESPERSON",
    email: "ariel@triolla.io",
    org: { id: "o1" },
    orgId: "o1",
  });
});

describe("mcp tokens API", () => {
  it("POST creates a token for a triolla user", async () => {
    createToken.mockResolvedValue({ id: "t1", raw: "mcp_secret" });
    const { POST } = await import("@/app/api/mcp/tokens/route");
    const res = await POST(req({ label: "laptop" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", token: "mcp_secret" });
    expect(createToken).toHaveBeenCalledWith("u1", "laptop");
  });

  it("POST is forbidden for a non-triolla user", async () => {
    userFindUnique.mockResolvedValue({
      id: "u1", role: "SALESPERSON", email: "x@gmail.com", org: { id: "o1" }, orgId: "o1",
    });
    const { POST } = await import("@/app/api/mcp/tokens/route");
    const res = await POST(req({ label: "laptop" }));
    expect(res.status).toBe(403);
    expect(createToken).not.toHaveBeenCalled();
  });

  it("GET lists tokens", async () => {
    listTokens.mockResolvedValue([{ id: "t1", label: "laptop" }]);
    const { GET } = await import("@/app/api/mcp/tokens/route");
    const res = await GET(req());
    expect(await res.json()).toEqual({ tokens: [{ id: "t1", label: "laptop" }] });
  });

  it("DELETE revokes and 404s when nothing changed", async () => {
    revokeToken.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { DELETE } = await import("@/app/api/mcp/tokens/[id]/route");
    const ok = await DELETE(req(), { params: Promise.resolve({ id: "t1" }) });
    expect(ok.status).toBe(200);
    const missing = await DELETE(req(), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);
  });
});
