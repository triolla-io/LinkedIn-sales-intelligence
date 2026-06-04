import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { queueNextConnect } from "@/lib/prospecting/connect-scheduler";

export const prospectingTick = inngest.createFunction(
  { id: "prospecting-tick", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const runs = await prisma.prospectingRun.findMany({ where: { status: "RUNNING" } });

    for (const run of runs) {
      // Safety net: if a chain stalled (e.g. a deferred CONNECT's day rolled over, or a
      // CONNECT result event was lost), re-evaluate and queue the next one.
      await queueNextConnect(run.id);

      // Re-queue discovery if a SEARCH page failed and left no live SEARCH task.
      if (!run.discoveryDone) {
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

      // Completion check: discovery done AND no remaining work AND no live connect task.
      if (run.discoveryDone) {
        const [remaining, liveConnect] = await Promise.all([
          prisma.connectionRequest.count({ where: { runId: run.id, status: { in: ["DISCOVERED", "QUEUED"] } } }),
          prisma.extensionTask.findFirst({
            where: { prospectingRunId: run.id, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
            select: { id: true },
          }),
        ]);
        if (remaining === 0 && !liveConnect) {
          await prisma.prospectingRun.update({
            where: { id: run.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        }
      }
    }
  }
);
