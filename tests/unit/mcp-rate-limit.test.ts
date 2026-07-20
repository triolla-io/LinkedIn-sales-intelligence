import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const resolveMcpUser = vi.hoisted(() => vi.fn());
const buildMcpServer = vi.hoisted(() => vi.fn());
const checkMcpRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mcp/auth", () => ({ resolveMcpUser }));
vi.mock("@/lib/mcp/register", () => ({ buildMcpServer }));
vi.mock("@/lib/mcp/rate-limit", () => ({ checkMcpRateLimit }));

beforeEach(() => vi.clearAllMocks());

function post(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
}

describe("POST /api/mcp — rate limiting", () => {
  it("returns 429 and never calls resolveMcpUser when the limiter rejects", async () => {
    checkMcpRateLimit.mockResolvedValue({ ok: false, retryAfterSec: 30 });
    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post({ Authorization: "Bearer mcp_x" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body).toEqual({
      jsonrpc: "2.0",
      error: { code: expect.any(Number), message: expect.any(String) },
      id: null,
    });
    expect(resolveMcpUser).not.toHaveBeenCalled();
    expect(checkMcpRateLimit).toHaveBeenCalledWith("mcp_x");
  });

  it("proceeds to auth when the limiter allows the request", async () => {
    checkMcpRateLimit.mockResolvedValue({ ok: true });
    resolveMcpUser.mockResolvedValue({ userId: "u1", orgId: "o1", email: "ariel@triolla.io" });
    const connect = vi.fn().mockResolvedValue(undefined);
    buildMcpServer.mockReturnValue({ connect });

    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post({ Authorization: "Bearer mcp_x" }));

    expect(resolveMcpUser).toHaveBeenCalledWith("Bearer mcp_x");
    expect(connect).toHaveBeenCalled();
    expect(res).toBeInstanceOf(Response);
  });

  it("skips the limiter and lets auth 401 when there is no authorization header", async () => {
    const { McpError } = await import("@/lib/mcp/errors");
    resolveMcpUser.mockRejectedValue(new McpError("unauthorized", "Missing Bearer token"));

    const { POST } = await import("@/app/api/mcp/route");
    const res = await POST(post());

    expect(checkMcpRateLimit).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });
});

describe("checkMcpRateLimit — no-op when Redis env vars are absent", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("always allows when UPSTASH env vars are unset", async () => {
    // Bypass the file-level vi.mock("@/lib/mcp/rate-limit", ...) above to
    // exercise the real implementation.
    const { checkMcpRateLimit: realCheckMcpRateLimit } =
      await vi.importActual<typeof import("@/lib/mcp/rate-limit")>("@/lib/mcp/rate-limit");

    const result = await realCheckMcpRateLimit("mcp_some_raw_token");

    expect(result).toEqual({ ok: true });
  });
});
