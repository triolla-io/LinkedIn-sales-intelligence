import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { buildSearchUrl } from "@/lib/prospecting/search-url";
import { queueNextConnect } from "@/lib/prospecting/connect-scheduler";

export const prospectingStart = inngest.createFunction(
  { id: "prospecting-start", triggers: [{ event: "prospecting.start" as const }] },
  async ({ event }) => {
    const { runId } = event.data as { runId: string };

    const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
    if (!run) return;
    if (run.status !== "RUNNING") return; // API already set RUNNING; ignore stale events

    // Resuming a run whose discovery already finished: don't re-scrape, just resume sending.
    if (run.discoveryDone) {
      await queueNextConnect(runId);
      return;
    }

    // Reset discovery cursor and kick off page 1.
    const searchUrl = buildSearchUrl(run.keywords, run.nextSearchPage);
    await prisma.prospectingRun.update({
      where: { id: runId },
      data: { searchUrl, startedAt: run.startedAt ?? new Date() },
    });

    await prisma.extensionTask.create({
      data: {
        userId: run.ownerId,
        kind: "SEARCH",
        payload: { searchUrl, page: run.nextSearchPage },
        prospectingRunId: runId,
        scheduledFor: new Date(),
      },
    });
  }
);
