/**
 * POC MCP server — local (stdio) read-only access to the sales-intelligence DB.
 *
 * Run:   MCP_OWNER_EMAIL=ariel@triolla.io tsx lib/mcp/server.ts
 * Wire:  add to ~/.claude/mcp.json (see docs/mcp-poc.md)
 *
 * Tenancy: every query is filtered by `ownerId`, resolved once from
 * MCP_OWNER_EMAIL. This is the stdio-local equivalent of ctx.effectiveUserId —
 * a remote/multi-user server would resolve the owner from an auth token instead.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const OWNER_EMAIL = process.env.MCP_OWNER_EMAIL;
if (!OWNER_EMAIL) {
  console.error("MCP_OWNER_EMAIL env var is required");
  process.exit(1);
}

/** Resolve and cache the effective owner id — the tenancy boundary for every tool. */
let ownerIdCache: string | null = null;
async function ownerId(): Promise<string> {
  if (ownerIdCache) return ownerIdCache;
  const user = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true },
  });
  if (!user) throw new Error(`No user found for MCP_OWNER_EMAIL=${OWNER_EMAIL}`);
  ownerIdCache = user.id;
  return user.id;
}

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({
  name: "triolla-sales-intelligence",
  version: "0.1.0",
});

// ── Tool 1: search contacts ──────────────────────────────────────────────
server.tool(
  "search_contacts",
  "Search the user's contacts by free-text (matches name, title, or company). Returns up to `limit` contacts with enrichment status.",
  {
    query: z.string().describe("Free-text search across name, title, company"),
    limit: z.number().int().min(1).max(100).default(20),
  },
  async ({ query, limit }) => {
    const oid = await ownerId();
    const contacts = await prisma.contact.findMany({
      where: {
        ownerId: oid,
        removedAt: null,
        OR: [
          { fullName: { contains: query, mode: "insensitive" } },
          { currentTitle: { contains: query, mode: "insensitive" } },
          { currentCompany: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { lastSyncedAt: "desc" },
      select: {
        id: true,
        fullName: true,
        currentTitle: true,
        currentCompany: true,
        location: true,
        email: true,
        phone: true,
        enrichedAt: true,
        linkedinUrl: true,
      },
    });
    return json({ count: contacts.length, contacts });
  },
);

// ── Tool 2: prospecting run status ───────────────────────────────────────
server.tool(
  "get_run_status",
  "Get a prospecting run's status with a breakdown of its connection requests by status, and the reasons for any SKIPPED profiles.",
  {
    run_id: z.string().describe("ProspectingRun id"),
  },
  async ({ run_id }) => {
    const oid = await ownerId();
    const run = await prisma.prospectingRun.findFirst({
      where: { id: run_id, ownerId: oid },
      select: {
        id: true,
        name: true,
        keywords: true,
        status: true,
        dailyCap: true,
        totalDiscovered: true,
        totalSent: true,
        nextDiscoveryAt: true,
        startedAt: true,
      },
    });
    if (!run) return json({ error: `No run ${run_id} owned by you` });

    const byStatus = await prisma.connectionRequest.groupBy({
      by: ["status"],
      where: { runId: run_id, ownerId: oid },
      _count: true,
    });

    const skipped = await prisma.connectionRequest.findMany({
      where: { runId: run_id, ownerId: oid, status: "SKIPPED" },
      select: { fullName: true, currentTitle: true, skipReason: true },
      take: 25,
    });

    return json({ run, breakdown: byStatus, skipped });
  },
);

// ── Tool 3: connection stats over a window ───────────────────────────────
server.tool(
  "connection_stats",
  "Aggregate connection-request stats across ALL your prospecting runs over the last N days: totals sent, accepted, failed, skipped, and acceptance rate.",
  {
    days: z.number().int().min(1).max(365).default(7),
  },
  async ({ days }) => {
    const oid = await ownerId();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await prisma.connectionRequest.groupBy({
      by: ["status"],
      where: { ownerId: oid, createdAt: { gte: since } },
      _count: true,
    });
    const counts = Object.fromEntries(rows.map((r) => [r.status, r._count]));
    const sent = counts.SENT ?? 0;
    const accepted = counts.ACCEPTED ?? 0;
    return json({
      windowDays: days,
      since: since.toISOString(),
      counts,
      acceptanceRate:
        sent + accepted > 0
          ? +(accepted / (sent + accepted) * 100).toFixed(1)
          : null,
    });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("triolla-sales-intelligence MCP server running on stdio");
}

main().catch((err) => {
  console.error("MCP server fatal error:", err);
  process.exit(1);
});
