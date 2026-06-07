import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { queueNextConnect, SEARCH_FAIL_CAP } from "@/lib/prospecting/connect-scheduler";

export const prospectingTick = inngest.createFunction(
  { id: "prospecting-tick", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const runs = await prisma.prospectingRun.findMany({ where: { status: "RUNNING" } });
    const now = new Date();

    for (const run of runs) {
      // Respect checkpoint backoff.
      if (run.pausedUntil && run.pausedUntil > now) continue;

      // Reconcile a stuck CONNECT slot: connectInFlight true but no live CONNECT task
      // (e.g. a result event was lost) → release so the chain can resume.
      if (run.connectInFlight) {
        const liveConnect = await prisma.extensionTask.findFirst({
          where: { prospectingRunId: run.id, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
          select: { id: true },
        });
        if (!liveConnect) {
          await prisma.prospectingRun.updateMany({ where: { id: run.id }, data: { connectInFlight: false } });
        }
      }

      // Safety net: queue the next CONNECT if eligible (atomic; no-op if one is in flight).
      await queueNextConnect(run.id);

      // Re-queue discovery if a SEARCH page failed and left no live SEARCH task (until the fail cap).
      if (!run.discoveryDone && run.searchFailCount < SEARCH_FAIL_CAP) {
        const liveSearch = await prisma.extensionTask.findFirst({
          where: { prospectingRunId: run.id, kind: "SEARCH", status: { in: ["PENDING", "CLAIMED"] } },
          select: { id: true },
        });
        if (!liveSearch) {
          await prisma.extensionTask.create({
            data: {
              userId: run.ownerId,
              kind: "SEARCH",
              payload: { searchUrl: run.searchUrl, page: run.nextSearchPage },
              prospectingRunId: run.id,
              scheduledFor: new Date(),
            },
          });
        }
      }

      // Completion: discovery done AND no remaining work AND no live CONNECT task.
      if (run.discoveryDone) {
        const [remaining, liveConnect] = await Promise.all([
          prisma.connectionRequest.count({ where: { runId: run.id, status: { in: ["DISCOVERED", "QUEUED"] } } }),
          prisma.extensionTask.findFirst({
            where: { prospectingRunId: run.id, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
            select: { id: true },
          }),
        ]);
        if (remaining === 0 && !liveConnect) {
          await prisma.prospectingRun.updateMany({
            where: { id: run.id, status: "RUNNING" },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        }
      }
    }
  }
);
