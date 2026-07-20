import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/mcp/tokens";
import { McpError } from "@/lib/mcp/errors";
import type { McpCtx } from "@/lib/mcp/context";

const ALLOWED_DOMAIN = "@triolla.io";

/** Verify a Bearer token → the owning user. The MCP stand-in for withTenant(). */
export async function resolveMcpUser(authHeader: string | null): Promise<McpCtx> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new McpError("unauthorized", "Missing Bearer token");
  }
  const raw = authHeader.slice("Bearer ".length).trim();
  if (!raw.startsWith("mcp_")) throw new McpError("unauthorized", "Invalid token");

  const row = await prisma.mcpAccessToken.findFirst({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    select: { id: true, user: { select: { id: true, orgId: true, email: true } } },
  });
  if (!row) throw new McpError("unauthorized", "Invalid or revoked token");

  if (!row.user.email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    throw new McpError("forbidden", "MCP access is limited to triolla.io accounts");
  }

  // Best-effort last-used tracking; never block the request on it.
  await prisma.mcpAccessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.user.id, orgId: row.user.orgId, email: row.user.email };
}
