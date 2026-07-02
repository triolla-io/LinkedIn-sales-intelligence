# MCP POC — local sales-intelligence server

A read-only, stdio MCP server that lets Claude query this app's DB in natural
language. Proof of concept — 3 tools, single-user, filtered by owner.

## What it exposes

| Tool | Args | Returns |
|---|---|---|
| `search_contacts` | `query`, `limit` | Contacts matching name/title/company + enrichment status |
| `get_run_status` | `run_id` | A prospecting run's status, request breakdown, and SKIPPED reasons |
| `connection_stats` | `days` | Sent/accepted/failed/skipped totals + acceptance rate across all runs |

## Tenancy

Every query filters by `ownerId`, resolved once from `MCP_OWNER_EMAIL`. This is
the stdio-local stand-in for `ctx.effectiveUserId`. A multi-user/remote server
would resolve the owner from an auth token instead of an env var.

## Run standalone (for testing)

```bash
MCP_OWNER_EMAIL=ariel@triolla.io npx tsx --env-file=.env lib/mcp/server.ts
```

## Wire into Claude Code

Add to `~/.claude/mcp.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "triolla-sales": {
      "command": "npx",
      "args": [
        "tsx",
        "--env-file=.env",
        "/Users/ariellunenfeld/linkedin-sales-intelligence/lib/mcp/server.ts"
      ],
      "env": { "MCP_OWNER_EMAIL": "ariel@triolla.io" }
    }
  }
}
```

Restart Claude Code. The tools appear as `mcp__triolla-sales__*`. Then just ask:
- "Search my contacts for VP of Sales"
- "What's the status of prospecting run <id>?"
- "What's my connection acceptance rate over the last 30 days?"

## Next steps (not built)

- Write tools (pause a run, enroll contacts in a sequence) — guarded, with confirmation
- Remote HTTP transport + real auth so the sales team can use it
- Analytics tools (campaign performance, Apollo spend vs. budget)
