import { prisma } from "@/lib/prisma";
import { computeNextScheduledFor } from "@/lib/extension/task-scheduler";
import { checkConnectQuota } from "@/lib/prospecting/quota";

const DAY_MS = 24 * 60 * 60 * 1000;

async function getConnectStats(ownerId: string) {
  const dayAgo = new Date(Date.now() - DAY_MS);
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [sentToday, sentThisWeek, last] = await Promise.all([
    prisma.connectionRequest.count({ where: { ownerId, status: "SENT", sentAt: { gte: dayAgo } } }),
    prisma.connectionRequest.count({ where: { ownerId, status: "SENT", sentAt: { gte: weekAgo } } }),
    prisma.connectionRequest.findFirst({
      where: { ownerId, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);
  return { sentToday, sentThisWeek, lastSentAt: last?.sentAt ?? null };
}

/**
 * Pick the next DISCOVERED candidate for a RUNNING run and queue a CONNECT ExtensionTask.
 * Returns the queued candidate id, or null if there is nothing eligible to send right now.
 * - No DISCOVERED candidates left → null (caller checks discoveryDone to complete the run).
 * - Daily/weekly cap reached → schedules the candidate for the next window instead of dropping it.
 */
export async function queueNextConnect(runId: string): Promise<string | null> {
  const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING") return null;

  // Don't double-queue: bail if this run already has a live CONNECT task.
  const liveConnect = await prisma.extensionTask.findFirst({
    where: { prospectingRunId: runId, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
    select: { id: true },
  });
  if (liveConnect) return null;

  const next = await prisma.connectionRequest.findFirst({
    where: { runId, status: "DISCOVERED" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return null;

  const owner = await prisma.user.findUnique({
    where: { id: run.ownerId },
    select: { timezone: true },
  });
  const tz = owner?.timezone ?? "Asia/Jerusalem";

  const { sentToday, sentThisWeek, lastSentAt } = await getConnectStats(run.ownerId);
  const quota = checkConnectQuota({
    sentToday,
    sentThisWeek,
    dailyCap: run.dailyCap,
    weeklyCap: run.weeklyCap,
  });

  let scheduledFor: Date;
  if (quota.canSendNow) {
    // hourlyCap keeps the scheduler from bunching sends within a single hour.
    const hourlyCap = Math.max(1, Math.floor(run.dailyCap / 4));
    scheduledFor = computeNextScheduledFor({
      timezone: tz,
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: true,
      lastSentAt,
      sentTodayCount: sentToday,
      sentLastHourCount: 0,
      dailyCap: run.dailyCap,
      hourlyCap,
    });
  } else if (quota.deferReason === "daily") {
    scheduledFor = new Date(Date.now() + DAY_MS); // tick re-evaluates after the day rolls
  } else {
    scheduledFor = new Date(Date.now() + 7 * DAY_MS); // weekly cap — wait out the week
  }

  await prisma.extensionTask.create({
    data: {
      userId: run.ownerId,
      kind: "CONNECT",
      payload: { profileUrl: next.linkedinUrl, recipientName: next.fullName ?? "" },
      prospectingRunId: runId,
      connectionRequestId: next.id,
      scheduledFor,
    },
  });
  await prisma.connectionRequest.update({ where: { id: next.id }, data: { status: "QUEUED" } });

  return next.id;
}
