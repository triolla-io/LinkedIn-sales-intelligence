import { prisma } from "@/lib/prisma";
import {
  computeJitteredScheduledFor,
  resolveJitterConfig,
  sampleJitterSeconds,
} from "@/lib/extension/send-jitter";

// Sends older than this don't need spacing against — a gap that large is
// already human-looking.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Pick the next humanized slot for a LinkedIn SEND task: after every SEND the
 * user already has queued (or just finished), plus a Gaussian-jittered delay.
 */
export async function scheduleJitteredSend(
  userId: string
): Promise<{ scheduledFor: Date; delaySeconds: number }> {
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);

  const [latestPending, latestCompleted] = await Promise.all([
    prisma.extensionTask.findFirst({
      where: { userId, kind: "SEND", status: { in: ["PENDING", "CLAIMED"] } },
      orderBy: { scheduledFor: "desc" },
      select: { scheduledFor: true },
    }),
    prisma.extensionTask.findFirst({
      where: { userId, kind: "SEND", status: "DONE", completedAt: { gte: since } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
  ]);

  const delaySeconds = sampleJitterSeconds(resolveJitterConfig(process.env));
  const scheduledFor = computeJitteredScheduledFor({
    now,
    latestPendingScheduledFor: latestPending?.scheduledFor ?? null,
    latestCompletedAt: latestCompleted?.completedAt ?? null,
    delaySeconds,
  });
  return { scheduledFor, delaySeconds };
}
