import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { queueNextConnect, SEARCH_FAIL_CAP } from "@/lib/prospecting/connect-scheduler";
import { buildSearchUrl } from "@/lib/prospecting/search-url";
import {
  enqueueCompanySearchTask,
  enqueueResolveTask,
  maybeCompleteCompanyRun,
  startNextPendingTarget,
} from "@/lib/prospecting/company-discovery";

/** A run re-runs discovery this long after exhausting its pool (recurring routine). */
const REDISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const prospectingTick = inngest.createFunction(
  { id: "prospecting-tick", triggers: [{ cron: "*/15 * * * *" }] },
  async () => {
    const runs = await prisma.prospectingRun.findMany({
      where: { status: "RUNNING" },
      include: { owner: { select: { routineConnectionsEnabled: true } } },
    });
    const now = new Date();

    for (const run of runs) {
      // Connections module off → effective pause: no reconciling, queueing, or discovery.
      if (!run.owner.routineConnectionsEnabled) continue;

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

      if (run.targetType === "COMPANY") {
        if (!run.discoveryDone) {
          // Re-queue a dropped RESOLVE/SEARCH for the current in-flight company.
          const liveDiscovery = await prisma.extensionTask.findFirst({
            where: {
              prospectingRunId: run.id,
              kind: { in: ["RESOLVE_COMPANY", "SEARCH"] },
              status: { in: ["PENDING", "CLAIMED"] },
            },
            select: { id: true },
          });
          if (!liveDiscovery) {
            const inFlight = await prisma.prospectingCompanyTarget.findFirst({
              where: {
                runId: run.id,
                status: { in: ["RESOLVING", "READY", "SEARCHING"] },
              },
              orderBy: { createdAt: "asc" },
            });
            if (inFlight) {
              if (inFlight.linkedinCompanyId) {
                await enqueueCompanySearchTask(run, inFlight, inFlight.searchPage);
              } else {
                await enqueueResolveTask(run, inFlight);
              }
            } else {
              await startNextPendingTarget(run.id);
            }
          }
        } else {
          // No 24h re-discovery for company runs — they complete instead.
          await maybeCompleteCompanyRun(run.id);
        }
        continue; // keyword-run logic below must not touch COMPANY runs
      }

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
              payload: {
                searchUrl: buildSearchUrl(
                  { keywords: run.keywords, geoUrn: run.geoUrn, industryIds: run.industryIds },
                  run.nextSearchPage
                ),
                page: run.nextSearchPage,
              },
              prospectingRunId: run.id,
              scheduledFor: new Date(),
            },
          });
        }
      }

      // Recurring re-discovery: a run that finished its pool sits with nextDiscoveryAt set. When that
      // time arrives, start a fresh discovery sweep (page 1) — already-seen people are de-duped, so
      // only NEW matches get added. The run never auto-COMPLETES; it keeps finding people daily until
      // the user pauses it.
      if (run.discoveryDone && run.nextDiscoveryAt && run.nextDiscoveryAt <= now) {
        const reset = await prisma.prospectingRun.updateMany({
          where: { id: run.id, status: "RUNNING", nextDiscoveryAt: run.nextDiscoveryAt },
          data: {
            discoveryDone: false,
            nextSearchPage: 1,
            searchUrl: buildSearchUrl({ keywords: run.keywords, geoUrn: run.geoUrn, industryIds: run.industryIds }, 1),
            searchFailCount: 0,
            nextDiscoveryAt: null,
          },
        });
        if (reset.count === 1) {
          await prisma.extensionTask.create({
            data: {
              userId: run.ownerId,
              kind: "SEARCH",
              payload: { searchUrl: buildSearchUrl({ keywords: run.keywords, geoUrn: run.geoUrn, industryIds: run.industryIds }, 1), page: 1 },
              prospectingRunId: run.id,
              scheduledFor: new Date(),
            },
          });
        }
        continue;
      }

      // Pool exhausted: instead of completing, schedule the next daily discovery sweep so the run
      // stays active and keeps catching new people (see extension-task-result for the same logic).
      if (run.discoveryDone && !run.nextDiscoveryAt) {
        const [remaining, liveConnect] = await Promise.all([
          prisma.connectionRequest.count({ where: { runId: run.id, status: { in: ["DISCOVERED", "QUEUED"] } } }),
          prisma.extensionTask.findFirst({
            where: { prospectingRunId: run.id, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
            select: { id: true },
          }),
        ]);
        if (remaining === 0 && !liveConnect) {
          await prisma.prospectingRun.updateMany({
            where: { id: run.id, status: "RUNNING", nextDiscoveryAt: null },
            data: { nextDiscoveryAt: new Date(now.getTime() + REDISCOVERY_INTERVAL_MS) },
          });
        }
      }
    }
  }
);
