import { prisma } from "@/lib/prisma";
import { computeNextScheduledFor } from "@/lib/extension/task-scheduler";
import { checkConnectQuota } from "@/lib/prospecting/quota";

const DAY_MS = 24 * 60 * 60 * 1000;

/** After this many consecutive failed SEARCH pages, stop discovery and proceed with what we have. */
export const SEARCH_FAIL_CAP = 5;

async function getConnectStats(ownerId: string) {
  const dayAgo = new Date(Date.now() - DAY_MS);
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [sentToday, sentThisWeek, sentLastHour, last] = await Promise.all([
    prisma.connectionRequest.count({ where: { ownerId, status: "SENT", sentAt: { gte: dayAgo } } }),
    prisma.connectionRequest.count({ where: { ownerId, status: "SENT", sentAt: { gte: weekAgo } } }),
    prisma.connectionRequest.count({ where: { ownerId, status: "SENT", sentAt: { gte: hourAgo } } }),
    prisma.connectionRequest.findFirst({
      where: { ownerId, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);
  return { sentToday, sentThisWeek, sentLastHour, lastSentAt: last?.sentAt ?? null };
}

/** Release the per-run CONNECT slot. Call after a CONNECT task completes (success or failure). */
export async function releaseConnectSlot(runId: string): Promise<void> {
  await prisma.prospectingRun.updateMany({ where: { id: runId }, data: { connectInFlight: false } });
}

/**
 * Atomically queue the NEXT CONNECT task for a RUNNING run — at most one CONNECT in flight per run.
 * The run-level `connectInFlight` flag is acquired via a conditional update (atomic), so concurrent
 * callers (tick + result handler) cannot both queue. The flag stays TRUE until the CONNECT result is
 * processed and releaseConnectSlot() is called. Returns the queued candidate id, or null.
 */
export async function queueNextConnect(runId: string): Promise<string | null> {
  const now = new Date();
  // Atomically acquire the slot: only if RUNNING, not already in flight, and not in a checkpoint backoff.
  const lock = await prisma.prospectingRun.updateMany({
    where: {
      id: runId,
      status: "RUNNING",
      connectInFlight: false,
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    data: { connectInFlight: true },
  });
  if (lock.count !== 1) return null;

  try {
    const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
    if (!run) {
      await releaseConnectSlot(runId);
      return null;
    }

    // Atomically claim the oldest DISCOVERED candidate.
    const next = await prisma.connectionRequest.findFirst({
      where: { runId, status: "DISCOVERED" },
      orderBy: { createdAt: "asc" },
      select: { id: true, linkedinUrl: true, fullName: true },
    });
    if (!next) {
      await releaseConnectSlot(runId);
      return null;
    }
    const claim = await prisma.connectionRequest.updateMany({
      where: { id: next.id, status: "DISCOVERED" },
      data: { status: "QUEUED" },
    });
    if (claim.count !== 1) {
      await releaseConnectSlot(runId);
      return null;
    }

    const owner = await prisma.user.findUnique({ where: { id: run.ownerId }, select: { timezone: true } });
    const tz = owner?.timezone ?? "Asia/Jerusalem";

    const { sentToday, sentThisWeek, sentLastHour, lastSentAt } = await getConnectStats(run.ownerId);
    const quota = checkConnectQuota({
      sentToday,
      sentThisWeek,
      dailyCap: run.dailyCap,
      weeklyCap: run.weeklyCap,
    });

    let scheduledFor: Date;
    if (quota.canSendNow) {
      const hourlyCap = Math.max(1, Math.floor(run.dailyCap / 4));
      const workingWeekdays = tz === "Asia/Jerusalem" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5]; // Israel: Sun-Thu
      scheduledFor = computeNextScheduledFor({
        timezone: tz,
        workingHoursStart: 9,
        workingHoursEnd: 18,
        weekdaysOnly: true,
        workingWeekdays,
        lastSentAt,
        sentTodayCount: sentToday,
        sentLastHourCount: sentLastHour,
        dailyCap: run.dailyCap,
        hourlyCap,
      });
    } else if (quota.deferReason === "daily") {
      scheduledFor = new Date(Date.now() + DAY_MS);
    } else {
      scheduledFor = new Date(Date.now() + 7 * DAY_MS);
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
    // Slot intentionally remains held until the CONNECT result calls releaseConnectSlot().
    return next.id;
  } catch (e) {
    await releaseConnectSlot(runId);
    throw e;
  }
}
