import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpCtx } from "@/lib/mcp/context";
import { json, toolError } from "@/lib/mcp/errors";
import * as q from "@/lib/mcp/queries";
import * as a from "@/lib/mcp/actions";

/** Wrap a handler so thrown McpErrors become structured tool errors. */
function wrap<T>(fn: () => Promise<T>) {
  return fn().then(json).catch(toolError);
}

export function buildMcpServer(ctx: McpCtx): McpServer {
  const server = new McpServer({ name: "triolla-sales-intelligence", version: "1.0.0" });

  // ── Read tools ──────────────────────────────────────────────
  server.registerTool("search_contacts", {
    description: "Search your contacts by free text (name, title, or company). Returns up to `limit` contacts with enrichment status.",
    inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).default(20) },
  }, ({ query, limit }) => wrap(() => q.searchContacts(ctx, { query, limit })));

  server.registerTool("get_contact", {
    description: "Full detail for one of your contacts: enrichment status + recent message history.",
    inputSchema: { contactId: z.string() },
  }, ({ contactId }) => wrap(() => q.getContact(ctx, { contactId })));

  server.registerTool("list_prospecting_runs", {
    description: "List your prospecting runs with status and totals.",
    inputSchema: {},
  }, () => wrap(() => q.listProspectingRuns(ctx)));

  server.registerTool("get_run_status", {
    description: "A prospecting run's status, request breakdown, and SKIPPED reasons.",
    inputSchema: { runId: z.string() },
  }, ({ runId }) => wrap(() => q.getRunStatus(ctx, { runId })));

  server.registerTool("connection_stats", {
    description: "Connection-request stats across all your runs over the last N days (sent/accepted/… + acceptance rate).",
    inputSchema: { days: z.number().int().min(1).max(365).default(7) },
  }, ({ days }) => wrap(() => q.connectionStats(ctx, { days })));

  server.registerTool("list_sequences", {
    description: "List your sequences with status and step/enrollment counts.",
    inputSchema: {},
  }, () => wrap(() => q.listSequences(ctx)));

  server.registerTool("get_sequence_status", {
    description: "A sequence's steps and its execution breakdown by status.",
    inputSchema: { sequenceId: z.string() },
  }, ({ sequenceId }) => wrap(() => q.getSequenceStatus(ctx, { sequenceId })));

  server.registerTool("list_campaigns", {
    description: "List your campaigns with channel, status, and recipient counts.",
    inputSchema: {},
  }, () => wrap(() => q.listCampaigns(ctx)));

  server.registerTool("get_campaign_status", {
    description: "A campaign's status and recipient breakdown by status.",
    inputSchema: { campaignId: z.string() },
  }, ({ campaignId }) => wrap(() => q.getCampaignStatus(ctx, { campaignId })));

  // ── Action tools ────────────────────────────────────────────
  const capNote = `Provide an explicit list of contact IDs (max ${a.MAX_BULK}); get IDs first via a read tool.`;

  server.registerTool("enrich_contacts", {
    description: `Queue background enrichment for specific contacts. ${capNote} Will enrich up to the org's remaining monthly credits.`,
    inputSchema: { contactIds: z.array(z.string()).min(1).max(a.MAX_BULK) },
    annotations: { destructiveHint: false },
  }, ({ contactIds }) => wrap(() => a.enrichContacts(ctx, { contactIds })));

  server.registerTool("enroll_in_sequence", {
    description: `Enroll specific contacts into an existing sequence. ${capNote}`,
    inputSchema: { sequenceId: z.string(), contactIds: z.array(z.string()).min(1).max(a.MAX_BULK) },
  }, ({ sequenceId, contactIds }) => wrap(() => a.enrollInSequence(ctx, { sequenceId, contactIds })));

  server.registerTool("prospecting_pause", {
    description: "Pause a RUNNING prospecting run (cancels pending connection tasks).",
    inputSchema: { runId: z.string() },
  }, ({ runId }) => wrap(() => a.prospectingPause(ctx, { runId })));

  server.registerTool("prospecting_resume", {
    description: "Resume a DRAFT or PAUSED prospecting run.",
    inputSchema: { runId: z.string() },
  }, ({ runId }) => wrap(() => a.prospectingResume(ctx, { runId })));

  server.registerTool("sequence_pause", {
    description: "Pause an ACTIVE sequence.",
    inputSchema: { sequenceId: z.string() },
  }, ({ sequenceId }) => wrap(() => a.sequencePause(ctx, { sequenceId })));

  server.registerTool("sequence_resume", {
    description: "Resume a PAUSED sequence.",
    inputSchema: { sequenceId: z.string() },
  }, ({ sequenceId }) => wrap(() => a.sequenceResume(ctx, { sequenceId })));

  server.registerTool("campaign_start", {
    description: "Start a DRAFT campaign (checks WhatsApp/Gmail connection where relevant). Sends only through the guarded pipeline.",
    inputSchema: { campaignId: z.string() },
  }, ({ campaignId }) => wrap(() => a.campaignStart(ctx, { campaignId })));

  server.registerTool("campaign_pause", {
    description: "Pause a RUNNING campaign.",
    inputSchema: { campaignId: z.string() },
  }, ({ campaignId }) => wrap(() => a.campaignPause(ctx, { campaignId })));

  return server;
}
