import { prisma } from "@/lib/prisma";
import { buildSearchUrl, parseSearchTitles } from "@/lib/prospecting/search-url";
import { logProspectingEvent } from "@/lib/prospecting/events";
import { computeNextScheduledFor, isWithinWindow } from "@/lib/extension/task-scheduler";

/** Company runs search 2nd + 3rd degree connections. */
export const COMPANY_NETWORK = ["S", "O"];

/** Randomized 2–5 minute pause between companies (humanized cadence). */
export function interCompanyDelayMs(): number {
  return 120_000 + Math.floor(Math.random() * 180_000);
}

/**
 * Circuit breaker: after this many consecutive FAILED companies, discovery pauses
 * instead of burning the rest of the queue (a fail wave = LinkedIn refusing our
 * searches — rate limit / logged out — not bad companies).
 */
export const DISCOVERY_FAIL_CAP = 5;
export const DISCOVERY_BACKOFF_MS = 6 * 60 * 60 * 1000;

/**
 * Discovery (resolve + people-search) runs on the customer's own LinkedIn, so
 * it is scheduled only during human browsing hours — NOT the run's send window,
 * which can be as narrow as one evening hour and is meant for connection sends.
 * The run's sendDays are respected; outside the hours a task waits for the next
 * window start. ~12h/day at the 2–5 min cadence also caps daily search volume.
 */
export const DISCOVERY_HOURS_START = 9;
export const DISCOVERY_HOURS_END = 21;

async function discoveryScheduledFor(
  run: { ownerId: string; sendDays?: number[] },
  delayMs: number,
): Promise<Date> {
  const owner = await prisma.user.findUnique({
    where: { id: run.ownerId },
    select: { timezone: true },
  });
  const tz = owner?.timezone ?? "Asia/Jerusalem";
  const workingWeekdays =
    run.sendDays && run.sendDays.length > 0
      ? run.sendDays
      : tz === "Asia/Jerusalem"
        ? [0, 1, 2, 3, 4]
        : [1, 2, 3, 4, 5];
  const window = {
    workingHoursStart: DISCOVERY_HOURS_START,
    workingHoursEnd: DISCOVERY_HOURS_END,
    workingWeekdays,
  };
  const base = new Date(Date.now() + delayMs);
  if (isWithinWindow(base, { timezone: tz, ...window })) return base;
  // Next window start (huge caps: this clamp is about hours, not quotas).
  return computeNextScheduledFor({
    timezone: tz,
    ...window,
    weekdaysOnly: true,
    lastSentAt: null,
    sentTodayCount: 0,
    sentLastHourCount: 0,
    dailyCap: Number.MAX_SAFE_INTEGER,
    hourlyCap: Number.MAX_SAFE_INTEGER,
  });
}

/** One company search page for a SINGLE title (LinkedIn URL search can't OR a title list — see search-url.ts). */
export function buildCompanySearchUrl(
  run: { geoUrn: string },
  companyId: string,
  page: number,
  title: string,
): string {
  return buildSearchUrl(
    {
      keywords: title,
      geoUrn: run.geoUrn,
      companyIds: [companyId],
      network: COMPANY_NETWORK,
    },
    page,
  );
}

type RunRow = { id: string; ownerId: string };
type TargetRow = { id: string; name: string; linkedinUrl: string | null };
type SearchTargetRow = TargetRow & {
  linkedinCompanyId: string | null;
  searchPage: number;
  searchTitleIndex: number;
};

/** Re-queue a RESOLVE_COMPANY task for a target that is already in flight (tick/start recovery). */
export async function enqueueResolveTask(
  run: RunRow,
  target: TargetRow,
  scheduledFor?: Date,
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
      scheduledFor: scheduledFor ?? (await discoveryScheduledFor(run, 0)),
    },
  });
}

/**
 * Queue a company SEARCH page for the target's CURRENT title (target.searchTitleIndex).
 * Falls back to resolve when the numeric ID is missing. When the cursor is past the last
 * searchable title (or there are none), the company is finished and we advance to the next.
 */
export async function enqueueCompanySearchTask(
  run: RunRow & { keywords: string; geoUrn: string },
  target: SearchTargetRow,
  page: number,
): Promise<void> {
  if (!target.linkedinCompanyId) {
    await enqueueResolveTask(run, target);
    return;
  }
  const title = parseSearchTitles(run.keywords)[target.searchTitleIndex];
  if (title === undefined) {
    const done = await prisma.prospectingCompanyTarget.updateMany({
      where: { id: target.id, status: { in: ["READY", "SEARCHING"] } },
      data: { status: "DONE" },
    });
    if (done.count === 1)
      await startNextPendingTarget(run.id, interCompanyDelayMs());
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
        searchUrl: buildCompanySearchUrl(
          run,
          target.linkedinCompanyId,
          page,
          title,
        ),
        page,
        targetId: target.id,
      },
      prospectingRunId: run.id,
      scheduledFor: await discoveryScheduledFor(run, 0),
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
      scheduledFor: await discoveryScheduledFor(run, delayMs),
    },
  });
  return true;
}

/**
 * Permanently fail a company and move on to the next one — after the SAME
 * humanized 2–5 min pause a success gets (a zero-delay failure path once burned
 * an entire 748-company queue in 95 minutes during a LinkedIn rate-limit wave).
 * When DISCOVERY_FAIL_CAP companies fail consecutively, the breaker pauses the
 * whole run for DISCOVERY_BACKOFF_MS instead of queueing the next company.
 */
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

  // Breaker check: are the last N settled companies ALL failures?
  const recent = await prisma.prospectingCompanyTarget.findMany({
    where: { runId, status: { in: ["DONE", "FAILED"] } },
    orderBy: { updatedAt: "desc" },
    take: DISCOVERY_FAIL_CAP,
    select: { status: true },
  });
  const wave =
    recent.length === DISCOVERY_FAIL_CAP &&
    recent.every((t) => t.status === "FAILED");
  if (wave) {
    const backoffUntil = new Date(Date.now() + DISCOVERY_BACKOFF_MS);
    await prisma.prospectingRun.updateMany({
      where: { id: runId },
      data: { pausedUntil: backoffUntil },
    });
    await logProspectingEvent({
      runId,
      type: "FAILED",
      message: `${DISCOVERY_FAIL_CAP} חברות נכשלו ברצף — נראה שלינקדאין מגבילה חיפושים כרגע. הריצה הושהתה ותתחדש אוטומטית ${formatBackoffHe(backoffUntil)}`,
      detail: { breaker: true, pausedUntil: backoffUntil.toISOString() },
    });
    return;
  }

  await startNextPendingTarget(runId, interCompanyDelayMs());
}

function formatBackoffHe(until: Date): string {
  return `בשעה ${until.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}`;
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
