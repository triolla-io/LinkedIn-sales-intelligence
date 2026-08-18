import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { McpError } from "@/lib/mcp/errors";
import type { McpCtx } from "@/lib/mcp/context";
import { selectEnrichableContacts } from "@/lib/contacts/enrich-budget";
import { buildEnrollmentExecutions } from "@/lib/sequences/helpers";
import { waClient } from "@/lib/whatsapp/client";
import { hasGmailScope } from "@/lib/gmail/client";

export const MAX_BULK = 200;

async function audit(ctx: McpCtx, tool: string, payload: Record<string, unknown>) {
  await prisma.auditEvent.create({
    data: { actorId: ctx.userId, action: `mcp.${tool}`, payload: { tool, ...payload } },
  });
}

function assertCap(ids: string[]) {
  if (ids.length === 0) throw new McpError("invalid", "contactIds must not be empty");
  if (ids.length > MAX_BULK) {
    throw new McpError("invalid", `Too many contacts (${ids.length}); max ${MAX_BULK} per call`);
  }
}

export async function enrichContacts(ctx: McpCtx, { contactIds }: { contactIds: string[] }) {
  assertCap(contactIds);
  // McpCtx (unlike withTenant's ctx.org) doesn't carry the org row, so resolve
  // both credit ceilings via the User -> Organization relation instead of a raw
  // prisma.organization query.
  const owner = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: {
      org: { select: { monthlyApolloBudget: true, perUserMonthlyApolloCredits: true } },
    },
  });
  const monthlyApolloBudget = owner?.org?.monthlyApolloBudget ?? 0;
  const perUserMonthlyApolloCredits = owner?.org?.perUserMonthlyApolloCredits ?? 0;
  const sel = await selectEnrichableContacts({
    effectiveUserId: ctx.userId,
    orgId: ctx.orgId,
    monthlyApolloBudget,
    perUserMonthlyApolloCredits,
    contactIds,
  });
  if ("budgetExhausted" in sel) {
    throw new McpError(
      "conflict",
      sel.blockedBy === "user"
        ? "Your personal monthly enrichment quota is exhausted"
        : "The organization's monthly enrichment budget is exhausted"
    );
  }
  if (sel.validIds.length > 0) {
    await inngest.send(
      sel.validIds.map((id) => ({
        name: "enrich.contact" as const,
        data: { contactId: id, ownerId: ctx.userId, actorId: ctx.userId },
      }))
    );
  }
  await audit(ctx, "enrich_contacts", { queued: sel.validIds.length, skipped: sel.skipped });
  return { queued: sel.validIds.length, skipped: sel.skipped, creditsRemaining: sel.creditsRemaining };
}

export async function enrollInSequence(ctx: McpCtx, { sequenceId, contactIds }: { sequenceId: string; contactIds: string[] }) {
  assertCap(contactIds);
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, ownerId: ctx.userId },
    include: {
      steps: {
        orderBy: { stepNumber: "asc" },
        select: { id: true, dayOffset: true, sendHour: true, sendMinute: true, sendHourEnd: true, sendMinuteEnd: true },
      },
    },
  });
  if (!sequence) throw new McpError("not_found", `No sequence ${sequenceId} owned by you`);
  if (sequence.steps.length === 0) throw new McpError("invalid", "Sequence has no steps configured");

  // Only enroll contacts the user actually owns — never trust raw ids.
  const owned = await prisma.contact.findMany({
    where: { id: { in: contactIds }, ownerId: ctx.userId },
    select: { id: true },
  });
  const ownedIds = owned.map((c) => c.id);

  await prisma.sequenceEnrollment.createMany({
    data: ownedIds.map((contactId) => ({ sequenceId, contactId, status: "ACTIVE" as const })),
    skipDuplicates: true,
  });
  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { sequenceId, contactId: { in: ownedIds } },
    select: { id: true, enrolledAt: true, executions: { select: { id: true }, take: 1 } },
  });
  const fresh = enrollments.filter((e) => e.executions.length === 0);
  if (fresh.length > 0) {
    await prisma.sequenceStepExecution.createMany({
      data: fresh.flatMap((enr) =>
        buildEnrollmentExecutions(enr.enrolledAt, sequence.steps).map((row) => ({ ...row, enrollmentId: enr.id }))
      ),
      skipDuplicates: true,
    });
  }
  await audit(ctx, "enroll_in_sequence", { sequenceId, enrolled: fresh.length, skipped: contactIds.length - fresh.length });
  return { enrolled: fresh.length, skipped: contactIds.length - fresh.length };
}

export async function prospectingPause(ctx: McpCtx, { runId }: { runId: string }) {
  const run = await prisma.prospectingRun.findFirst({ where: { id: runId, ownerId: ctx.userId } });
  if (!run) throw new McpError("not_found", `No run ${runId} owned by you`);
  if (run.status !== "RUNNING") throw new McpError("conflict", "Only RUNNING runs can be paused");
  await prisma.prospectingRun.update({ where: { id: runId }, data: { status: "PAUSED" } });
  await prisma.extensionTask.updateMany({
    where: { prospectingRunId: runId, status: "PENDING" },
    data: { status: "FAILED", errorCode: "paused" },
  });
  await prisma.connectionRequest.updateMany({
    where: { runId, status: "QUEUED" }, data: { status: "DISCOVERED" },
  });
  await prisma.prospectingRun.update({ where: { id: runId }, data: { connectInFlight: false } });
  await audit(ctx, "prospecting_pause", { runId });
  return { ok: true, status: "PAUSED" };
}

export async function prospectingResume(ctx: McpCtx, { runId }: { runId: string }) {
  const run = await prisma.prospectingRun.findFirst({ where: { id: runId, ownerId: ctx.userId } });
  if (!run) throw new McpError("not_found", `No run ${runId} owned by you`);
  if (run.status !== "DRAFT" && run.status !== "PAUSED") {
    throw new McpError("conflict", "Only DRAFT or PAUSED runs can be resumed");
  }
  const owner = await prisma.user.findUnique({
    where: { id: ctx.userId }, select: { routineConnectionsEnabled: true },
  });
  if (owner && !owner.routineConnectionsEnabled) {
    throw new McpError("conflict", "The connections module is disabled for your account");
  }
  if (run.targetType === "COMPANY") {
    const targets = await prisma.prospectingCompanyTarget.count({
      where: { runId, status: { not: "REMOVED" } },
    });
    if (targets === 0) throw new McpError("conflict", "Run has no company targets");
  }
  await prisma.prospectingRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
  await inngest.send({ name: "prospecting.start" as const, data: { runId } });
  await audit(ctx, "prospecting_resume", { runId });
  return { ok: true, status: "RUNNING" };
}

export async function sequencePause(ctx: McpCtx, { sequenceId }: { sequenceId: string }) {
  const seq = await prisma.sequence.findFirst({ where: { id: sequenceId, ownerId: ctx.userId } });
  if (!seq) throw new McpError("not_found", `No sequence ${sequenceId} owned by you`);
  if (seq.status !== "ACTIVE") throw new McpError("conflict", "Only ACTIVE sequences can be paused");
  await prisma.sequence.update({ where: { id: sequenceId }, data: { status: "PAUSED" } });
  await audit(ctx, "sequence_pause", { sequenceId });
  return { ok: true, status: "PAUSED" };
}

export async function sequenceResume(ctx: McpCtx, { sequenceId }: { sequenceId: string }) {
  const seq = await prisma.sequence.findFirst({ where: { id: sequenceId, ownerId: ctx.userId } });
  if (!seq) throw new McpError("not_found", `No sequence ${sequenceId} owned by you`);
  if (seq.status !== "PAUSED") throw new McpError("conflict", "Only PAUSED sequences can be resumed");
  await prisma.sequence.update({ where: { id: sequenceId }, data: { status: "ACTIVE" } });
  await audit(ctx, "sequence_resume", { sequenceId });
  return { ok: true, status: "ACTIVE" };
}

export async function campaignStart(ctx: McpCtx, { campaignId }: { campaignId: string }) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId: ctx.userId } });
  if (!campaign) throw new McpError("not_found", `No campaign ${campaignId} owned by you`);
  if (campaign.status !== "DRAFT") throw new McpError("conflict", "Campaign must be DRAFT to start");
  if (campaign.channel === "WHATSAPP") {
    const { status } = await waClient.status(ctx.userId);
    if (status !== "CONNECTED") throw new McpError("conflict", "Connect WhatsApp before starting this campaign");
  }
  if (campaign.channel === "EMAIL") {
    const account = await prisma.account.findFirst({
      where: { userId: ctx.userId, provider: "google" }, select: { scope: true },
    });
    if (!hasGmailScope(account?.scope ?? null)) {
      throw new McpError("conflict", "Re-authorize Google to enable Gmail sending");
    }
  }
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "QUEUED" } });
  await inngest.send({ name: "campaign.start", data: { campaignId } });
  await audit(ctx, "campaign_start", { campaignId });
  return { ok: true, status: "QUEUED" };
}

export async function campaignPause(ctx: McpCtx, { campaignId }: { campaignId: string }) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, ownerId: ctx.userId } });
  if (!campaign) throw new McpError("not_found", `No campaign ${campaignId} owned by you`);
  if (campaign.status !== "RUNNING") throw new McpError("conflict", "Campaign must be RUNNING to pause");
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
  await audit(ctx, "campaign_pause", { campaignId });
  return { ok: true, status: "PAUSED" };
}
