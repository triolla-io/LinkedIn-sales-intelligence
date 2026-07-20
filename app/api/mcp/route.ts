import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpUser } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/register";
import { McpError } from "@/lib/mcp/errors";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");

  // Rate-limit BEFORE auth, keyed on the raw Bearer token, so a leaked or
  // guessed token can't be brute-forced against resolveMcpUser. If there's no
  // Authorization header at all, there's nothing to key on — skip the
  // limiter and let auth return its 401.
  if (authHeader?.startsWith("Bearer ")) {
    const rawToken = authHeader.slice("Bearer ".length).trim();
    const rl = await checkMcpRateLimit(rawToken);
    if (!rl.ok) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32029, message: "Too many requests" },
          id: null,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": String(rl.retryAfterSec),
          },
        }
      );
    }
  }

  let ctx;
  try {
    ctx = await resolveMcpUser(authHeader);
  } catch (err) {
    const status = err instanceof McpError && err.code === "forbidden" ? 403 : 401;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: err instanceof McpError ? err.message : "Unauthorized" },
        id: null,
      }),
      { status, headers: { "content-type": "application/json" } }
    );
  }

  // Stateless: a fresh server + transport per request, bound to this user.
  const server = buildMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
