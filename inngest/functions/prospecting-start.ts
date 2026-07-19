import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { buildSearchUrl } from "@/lib/prospecting/search-url";
import { queueNextConnect } from "@/lib/prospecting/connect-scheduler";
import {
  enqueueCompanySearchTask,
  enqueueResolveTask,
  maybeCompleteCompanyRun,
  startNextPendingTarget,
} from "@/lib/prospecting/company-discovery";

export const prospectingStart = inngest.createFunction(
  {
    id: "prospecting-start",
    triggers: [{ event: "prospecting.start" as const }],
  },
  async ({ event }) => {
    const { runId } = event.data as { runId: string };

    const run = await prisma.prospectingRun.findUnique({
      where: { id: runId },
    });
    if (!run) return;
    if (run.status !== "RUNNING") return; // API already set RUNNING; ignore stale events

    if (run.targetType === "COMPANY") {
      if (!run.startedAt) {
        await prisma.prospectingRun.update({
          where: { id: runId },
          data: { startedAt: new Date() },
        });
      }
      // Resume sending immediately if people are already waiting.
      const pendingCount = await prisma.connectionRequest.count({
        where: { runId, status: "DISCOVERED" },
      });
      if (pendingCount > 0) await queueNextConnect(runId);

      if (run.discoveryDone) {
        await maybeCompleteCompanyRun(runId);
        return;
      }
      // One discovery task in flight per run: don't double-start.
      const liveDiscovery = await prisma.extensionTask.findFirst({
        where: {
          prospectingRunId: runId,
          kind: { in: ["RESOLVE_COMPANY", "SEARCH"] },
          status: { in: ["PENDING", "CLAIMED"] },
        },
        select: { id: true },
      });
      if (liveDiscovery) return;
      // Resume the in-flight company if one exists, else start the next PENDING one.
      const inFlight = await prisma.prospectingCompanyTarget.findFirst({
        where: { runId, status: { in: ["RESOLVING", "READY", "SEARCHING"] } },
        orderBy: { createdAt: "asc" },
      });
      if (inFlight) {
        if (inFlight.linkedinCompanyId)
          await enqueueCompanySearchTask(run, inFlight, inFlight.searchPage);
        else await enqueueResolveTask(run, inFlight);
      } else {
        await startNextPendingTarget(runId);
      }
      return;
    }

    // ---------------- keyword flow (unchanged) ----------------

    // Resuming a run whose discovery already finished: don't re-scrape, just resume sending.
    if (run.discoveryDone) {
      await queueNextConnect(runId);
      return;
    }

    // If there are already discovered candidates waiting, kick off sending immediately
    // without waiting for the next SEARCH result to trigger queueNextConnect.
    const pendingCount = await prisma.connectionRequest.count({
      where: { runId, status: "DISCOVERED" },
    });
    if (pendingCount > 0) {
      await queueNextConnect(runId);
    }

    // Reset discovery cursor and kick off page 1.
    const searchUrl = buildSearchUrl(
      {
        keywords: run.keywords,
        geoUrn: run.geoUrn,
        industryIds: run.industryIds,
      },
      run.nextSearchPage,
    );
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
  },
);
