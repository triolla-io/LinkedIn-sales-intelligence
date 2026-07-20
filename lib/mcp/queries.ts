import { prisma } from "@/lib/prisma";
import { McpError } from "@/lib/mcp/errors";
import type { McpCtx } from "@/lib/mcp/context";

export async function searchContacts(ctx: McpCtx, { query, limit }: { query: string; limit: number }) {
  const contacts = await prisma.contact.findMany({
    where: {
      ownerId: ctx.userId,
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
      id: true, fullName: true, currentTitle: true, currentCompany: true,
      location: true, email: true, phone: true, enrichedAt: true, linkedinUrl: true,
    },
  });
  return { count: contacts.length, contacts };
}

export async function getContact(ctx: McpCtx, { contactId }: { contactId: string }) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: ctx.userId },
    select: {
      id: true, fullName: true, currentTitle: true, currentCompany: true, location: true,
      email: true, phone: true, linkedinUrl: true, enrichedAt: true, lastSyncedAt: true,
      // NOTE: Contact's relation to SentMessage is named `messages` (not `sentMessages`)
      // in prisma/schema.prisma. SentMessage also has no `channel` or `createdAt` field —
      // only `status`, `sentAt`, and `errorMessage` are available for this summary.
      messages: {
        orderBy: { sentAt: "desc" }, take: 10,
        select: { status: true, sentAt: true, errorMessage: true },
      },
    },
  });
  if (!contact) throw new McpError("not_found", `No contact ${contactId} owned by you`);
  return contact;
}

export async function listProspectingRuns(ctx: McpCtx) {
  const runs = await prisma.prospectingRun.findMany({
    where: { ownerId: ctx.userId },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: {
      id: true, name: true, keywords: true, status: true, dailyCap: true,
      totalDiscovered: true, totalSent: true, startedAt: true,
    },
  });
  return { count: runs.length, runs };
}

export async function getRunStatus(ctx: McpCtx, { runId }: { runId: string }) {
  const run = await prisma.prospectingRun.findFirst({
    where: { id: runId, ownerId: ctx.userId },
    select: {
      id: true, name: true, keywords: true, status: true, dailyCap: true,
      totalDiscovered: true, totalSent: true, nextDiscoveryAt: true, startedAt: true,
    },
  });
  if (!run) throw new McpError("not_found", `No run ${runId} owned by you`);
  const [byStatus, skipped] = await Promise.all([
    prisma.connectionRequest.groupBy({
      by: ["status"], where: { runId, ownerId: ctx.userId }, _count: true,
    }),
    prisma.connectionRequest.findMany({
      where: { runId, ownerId: ctx.userId, status: "SKIPPED" },
      select: { fullName: true, currentTitle: true, skipReason: true }, take: 25,
    }),
  ]);
  return { run, breakdown: byStatus, skipped };
}

export async function connectionStats(ctx: McpCtx, { days }: { days: number }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.connectionRequest.groupBy({
    by: ["status"], where: { ownerId: ctx.userId, createdAt: { gte: since } }, _count: true,
  });
  const counts = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  const sent = counts.SENT ?? 0;
  const accepted = counts.ACCEPTED ?? 0;
  return {
    windowDays: days,
    since: since.toISOString(),
    counts,
    acceptanceRate: sent + accepted > 0 ? +((accepted / (sent + accepted)) * 100).toFixed(1) : null,
  };
}

export async function listSequences(ctx: McpCtx) {
  const sequences = await prisma.sequence.findMany({
    where: { ownerId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, name: true, status: true, createdAt: true,
      _count: { select: { steps: true, enrollments: true } },
    },
  });
  return { count: sequences.length, sequences };
}

export async function getSequenceStatus(ctx: McpCtx, { sequenceId }: { sequenceId: string }) {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, ownerId: ctx.userId },
    select: {
      id: true, name: true, status: true,
      steps: { orderBy: { stepNumber: "asc" }, select: { stepNumber: true, channel: true, dayOffset: true } },
      _count: { select: { enrollments: true } },
    },
  });
  if (!sequence) throw new McpError("not_found", `No sequence ${sequenceId} owned by you`);
  const execBreakdown = await prisma.sequenceStepExecution.groupBy({
    by: ["status"],
    where: { enrollment: { sequenceId, sequence: { ownerId: ctx.userId } } },
    _count: true,
  });
  return { sequence, executions: execBreakdown };
}

export async function listCampaigns(ctx: McpCtx) {
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, name: true, channel: true, status: true, createdAt: true,
      _count: { select: { recipients: true } },
    },
  });
  return { count: campaigns.length, campaigns };
}

export async function getCampaignStatus(ctx: McpCtx, { campaignId }: { campaignId: string }) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, ownerId: ctx.userId },
    select: { id: true, name: true, channel: true, status: true, createdAt: true },
  });
  if (!campaign) throw new McpError("not_found", `No campaign ${campaignId} owned by you`);
  const recipients = await prisma.campaignRecipient.groupBy({
    by: ["status"], where: { campaignId }, _count: true,
  });
  return { campaign, recipients };
}
