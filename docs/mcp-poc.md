# Remote MCP server

A hosted MCP server that lets Claude query and control your Triolla sales data over the network. Token-authenticated HTTP transport with 9 read tools and 8 action tools.

## Endpoint

```
https://sales.triolla.io/api/mcp
```

## Generate an access token

1. Open [Settings → Claude / MCP](https://sales.triolla.io/settings/mcp)
2. Enter a label (e.g. "Ariel's laptop")
3. Click "Generate token"
4. **Copy it immediately** — it is shown only once

## Connect from Claude Code or Desktop

Add this to your MCP config file (`~/.claude/mcp.json` for Code, `~/Library/Application Support/Claude/claude_desktop_config.json` for Desktop), replacing `<YOUR_TOKEN>` with the token you just generated:

```json
{
  "mcpServers": {
    "triolla-sales": {
      "type": "http",
      "url": "https://sales.triolla.io/api/mcp",
      "headers": { "Authorization": "Bearer <YOUR_TOKEN>" }
    }
  }
}
```

Restart Claude Code / Desktop. Tools appear as `mcp__triolla-sales__*` and you can ask naturally:
- "Search my contacts for VP of Sales"
- "What's the status of prospecting run abc123?"
- "What's my connection acceptance rate over the last 30 days?"
- "Enrich these contacts: contact1, contact2, contact3"
- "Enroll my top 10 prospects in sequence xyz"

## Read tools (9)

1. **search_contacts** — Search your contacts by free text (name, title, or company). Returns up to `limit` contacts with enrichment status.
2. **get_contact** — Full detail for one of your contacts: enrichment status + recent message history.
3. **list_prospecting_runs** — List your prospecting runs with status and totals.
4. **get_run_status** — A prospecting run's status, request breakdown, and SKIPPED reasons.
5. **connection_stats** — Connection-request stats across all your runs over the last N days (sent/accepted/… + acceptance rate).
6. **list_sequences** — List your sequences with status and step/enrollment counts.
7. **get_sequence_status** — A sequence's steps and its execution breakdown by status.
8. **list_campaigns** — List your campaigns with channel, status, and recipient counts.
9. **get_campaign_status** — A campaign's status and recipient breakdown by status.

## Action tools (8)

1. **enrich_contacts** — Queue background enrichment for specific contacts. Provide an explicit list of contact IDs (max 200); get IDs first via a read tool. Will enrich up to the org's remaining monthly credits.
2. **enroll_in_sequence** — Enroll specific contacts into an existing sequence. Provide contact IDs (max 200).
3. **prospecting_pause** — Pause a RUNNING prospecting run (cancels pending connection tasks).
4. **prospecting_resume** — Resume a DRAFT or PAUSED prospecting run.
5. **sequence_pause** — Pause an ACTIVE sequence.
6. **sequence_resume** — Resume a PAUSED sequence.
7. **campaign_start** — Start a DRAFT campaign (checks WhatsApp/Gmail connection where relevant). Sends only through the guarded pipeline.
8. **campaign_pause** — Pause a RUNNING campaign.

## Access control

- Token auth resolves the user from the token's owning User row (which carries the orgId)
- **@triolla.io members only** — external email domains are rejected at token generation time
- Rate-limited: 120 requests per minute per token
- Mass actions (enrich_contacts, enroll_in_sequence) accept max 200 contact IDs per call
- No direct message-send tool; sequences and campaigns send through the guarded pipeline

## Revoke a token

Return to [Settings → Claude / MCP](https://sales.triolla.io/settings/mcp) and click "Revoke" next to the token label. It takes effect immediately.
