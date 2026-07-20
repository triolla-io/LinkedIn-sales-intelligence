import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMcpUser = vi.hoisted(() => vi.fn());
const buildMcpServer = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mcp/auth", () => ({ resolveMcpUser }));
vi.mock("@/lib/mcp/register", () => ({ buildMcpServer }));

beforeEach(() => vi.clearAllMocks());

function post(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
}

describe("POST /api/mcp", () => {
  it("returns 401 without a valid token", async () => {
    const { McpError } = await import("@/lib/mcp/errors");
    resolveMcpUser.mockRejectedValue(new McpError("unauthorized", "Missing Bearer token"));
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post());
    expect(res.status).toBe(401);
  });

  it("delegates to the transport for an authenticated request", async () => {
    resolveMcpUser.mockResolvedValue({ userId: "u1", orgId: "o1", email: "ariel@triolla.io" });
    const connect = vi.fn().mockResolvedValue(undefined);
    buildMcpServer.mockReturnValue({ connect });
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post({ Authorization: "Bearer mcp_x" }));
    expect(connect).toHaveBeenCalled();
    expect(res).toBeInstanceOf(Response);
  });
});
