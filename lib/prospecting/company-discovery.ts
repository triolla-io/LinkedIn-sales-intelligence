import { prisma } from "@/lib/prisma";
import { buildSearchUrl } from "@/lib/prospecting/search-url";
import { logProspectingEvent } from "@/lib/prospecting/events";

/** Company runs search 2nd + 3rd degree connections. */
export const COMPANY_NETWORK = ["S", "O"];

/** Randomized 2–5 minute pause between companies (humanized cadence). */
export function interCompanyDelayMs(): number {
  return 120_000 + Math.floor(Math.random() * 180_000);
}

export function buildCompanySearchUrl(
  run: { keywords: string; geoUrn: string },
  companyId: string,
  page: number,
): string {
  return buildSearchUrl(
    {
      keywords: run.keywords,
      geoUrn: run.geoUrn,
      companyIds: [companyId],
      network: COMPANY_NETWORK,
    },
    page,
  );
}

type RunRow = { id: string; ownerId: string };
type TargetRow = { id: string; name: string; linkedinUrl: string | null };

/** Re-queue a RESOLVE_COMPANY task for a target that is already in flight (tick/start recovery). */
export async function enqueueResolveTask(
  run: RunRow,
  target: TargetRow,
  scheduledFor: Date = new Date(),
): Promise<void> {
  await prisma.prospectingCompanyTarget.update({
    where: { id: target.id },
    data: { status: "RESOLVING" },
  });
  await prisma.extensionTask.create({
    data: {
      userId: run.ownerId,
      kind: "RESOLVE_COMPANY",
      payload: {
        targetId: target.id,
        linkedinUrl: target.linkedinUrl,
        name: target.name,
      },
      prospectingRunId: run.id,
      scheduledFor,
    },
  });
}

/** Queue a company SEARCH page. Falls back to resolve when the numeric ID is missing. */
export async function enqueueCompanySearchTask(
  run: RunRow & { keywords: string; geoUrn: string },
  target: TargetRow & { linkedinCompanyId: string | null },
  page: number,
): Promise<void> {
  if (!target.linkedinCompanyId) {
    await enqueueResolveTask(run, target);
    return;
  }
  await prisma.prospectingCompanyTarget.update({
    where: { id: target.id },
    data: { status: "SEARCHING" },
  });
  await prisma.extensionTask.create({
    data: {
      userId: run.ownerId,
      kind: "SEARCH",
      payload: {
        searchUrl: buildCompanySearchUrl(run, target.linkedinCompanyId, page),
        page,
        targetId: target.id,
      },
      prospectingRunId: run.id,
      scheduledFor: new Date(),
    },
  });
}

/**
 * Start discovery for the oldest PENDING company. Returns false when none remain
 * (marks discoveryDone and runs the completion check).
 */
export async function startNextPendingTarget(
  runId: string,
  delayMs = 0,
): Promise<boolean> {
  const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING") return false;

  const next = await prisma.prospectingCompanyTarget.findFirst({
    where: { runId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) {
    await prisma.prospectingRun.updateMany({
      where: { id: runId, discoveryDone: false },
      data: { discoveryDone: true },
    });
    await maybeCompleteCompanyRun(runId);
    return false;
  }

  // Guard against two concurrent handlers starting the same target.
  const claimed = await prisma.prospectingCompanyTarget.updateMany({
    where: { id: next.id, status: "PENDING" },
    data: { status: "RESOLVING" },
  });
  if (claimed.count !== 1) return false;

  await prisma.extensionTask.create({
    data: {
      userId: run.ownerId,
      kind: "RESOLVE_COMPANY",
      payload: {
        targetId: next.id,
        linkedinUrl: next.linkedinUrl,
        name: next.name,
      },
      prospectingRunId: runId,
      scheduledFor: new Date(Date.now() + delayMs),
    },
  });
  return true;
}

/** Permanently fail a company and move on to the next one. */
export async function failCompanyTarget(
  runId: string,
  target: { id: string; name: string },
  errorCode: string,
): Promise<void> {
  await prisma.prospectingCompanyTarget.update({
    where: { id: target.id },
    data: { status: "FAILED", error: errorCode },
  });
  await logProspectingEvent({
    runId,
    type: "FAILED",
    message: `${target.name} — ${errorCode}`,
    detail: { companyTargetId: target.id, errorCode },
  });
  await startNextPendingTarget(runId);
}

/**
 * COMPANY-run completion: discovery finished, every company terminal, no unsent people,
 * no live tasks → COMPLETED (+event). Keyword runs are untouched (they never complete).
 */
export async function maybeCompleteCompanyRun(runId: string): Promise<void> {
  const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
  if (
    !run ||
    run.targetType !== "COMPANY" ||
    run.status !== "RUNNING" ||
    !run.discoveryDone
  )
    return;

  const [nonTerminalTargets, remaining, liveTask] = await Promise.all([
    prisma.prospectingCompanyTarget.count({
      where: {
        runId,
        status: { in: ["PENDING", "RESOLVING", "READY", "SEARCHING"] },
      },
    }),
    prisma.connectionRequest.count({
      where: { runId, status: { in: ["DISCOVERED", "QUEUED"] } },
    }),
    prisma.extensionTask.findFirst({
      where: {
        prospectingRunId: runId,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      select: { id: true },
    }),
  ]);
  if (nonTerminalTargets > 0 || remaining > 0 || liveTask) return;

  const done = await prisma.prospectingRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      connectInFlight: false,
    },
  });
  if (done.count === 1) {
    await logProspectingEvent({
      runId,
      type: "COMPLETED",
      message: "כל החברות נסרקו וכל האנשים טופלו",
    });
  }
}
