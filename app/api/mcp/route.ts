import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpUser } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/register";
import { McpError } from "@/lib/mcp/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await resolveMcpUser(req.headers.get("authorization"));
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
