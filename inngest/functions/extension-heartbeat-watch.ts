import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

const OFFLINE_THRESHOLD_MIN = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extensionHeartbeatWatchHandler(_: any) {
  const staleThreshold = new Date(Date.now() - 5 * 60_000); // 5 minutes
  await prisma.extensionTask.updateMany({
    where: { status: "CLAIMED", claimedAt: { lt: staleThreshold } },
    data: { status: "PENDING", claimedAt: null },
  });

  const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MIN * 60_000);
  const sessions = await prisma.extensionSession.findMany({
    where: { revokedAt: null, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: threshold } }] },
    select: { userId: true, lastSeenAt: true },
  });

  for (const s of sessions) {
    const pending = await prisma.extensionTask.count({
      where: { userId: s.userId, status: "PENDING", scheduledFor: { lte: new Date() } },
    });
    if (pending === 0) continue;

    const existing = await prisma.extensionAlert.findFirst({
      where: { userId: s.userId, kind: "OFFLINE", resolvedAt: null },
    });
    if (existing) continue;

    await prisma.extensionAlert.create({
      data: {
        userId: s.userId,
        kind: "OFFLINE",
        message: `Open Chrome to keep sending — extension offline, ${pending} messages waiting.`,
      },
    });
  }
}

export const extensionHeartbeatWatch = inngest.createFunction(
  { id: "extension-heartbeat-watch", triggers: [{ cron: "*/15 * * * *" }] },
  extensionHeartbeatWatchHandler
);
