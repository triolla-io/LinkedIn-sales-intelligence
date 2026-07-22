import { prisma } from "@/lib/prisma";
import { selectDueContacts } from "@/lib/job-check/select-due-contacts";

const DAILY_CAP = 25; // conservative profile-visit budget per owner per dispatch
// Spread the scheduled scrapes across ~9 hours so the extension visits roughly one
// profile every 20-25 min (humanized) instead of back-to-back. The extension's
// tasks/next only claims tasks whose scheduledFor <= now, so future-dated tasks wait.
const SPREAD_WINDOW_MS = 9 * 60 * 60 * 1000;

/**
 * Select contacts due for a job-change scrape and enqueue SCRAPE_PROFILE extension tasks
 * with randomized, spread-out scheduledFor times.
 *
 * Gated on Org.jobCheckEnabled (default false) — nothing is scheduled for an org until it
 * turns the module ON. Pass `scope.orgId` to dispatch for a single org (used by the
 * kick-on-enable flow); omit it for the nightly all-orgs cron.
 *
 * Shared by the daily cron (job-check-tick) and the on-enable trigger (job-check-dispatch).
 */
export async function dispatchJobChecks(scope?: { orgId?: string }): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);

  const due = await prisma.contact.findMany({
    where: {
      linkedinUrl: { not: "" },
      removedAt: null,
      // Safety gate: only orgs with the module ON. Optionally scoped to one org.
      owner: { org: { jobCheckEnabled: true, ...(scope?.orgId ? { id: scope.orgId } : {}) } },
      OR: [{ lastJobCheckAt: null }, { lastJobCheckAt: { lt: cutoff } }],
    },
    select: { id: true, ownerId: true, linkedinUrl: true, lastJobCheckAt: true },
    orderBy: { lastJobCheckAt: { sort: "asc", nulls: "first" } }, // oldest/never-checked-first
    take: 500,
  });

  const byOwner = new Map<string, typeof due>();
  for (const c of due) {
    const arr = byOwner.get(c.ownerId) ?? [];
    arr.push(c);
    byOwner.set(c.ownerId, arr);
  }
  const chosen = [...byOwner.values()].flatMap((rows) => selectDueContacts(rows, DAILY_CAP));
  if (chosen.length === 0) return 0;

  // Skip contacts that already have a pending scrape queued (e.g. cron + on-enable overlap,
  // or the extension has been offline) so tasks don't pile up.
  const pending = await prisma.extensionTask.findMany({
    where: { kind: "SCRAPE_PROFILE", status: "PENDING" },
    select: { payload: true },
  });
  const alreadyQueued = new Set(
    pending.map((t) => (t.payload as { contactId?: string })?.contactId).filter(Boolean)
  );
  const toCreate = chosen.filter((c) => !alreadyQueued.has(c.id));
  if (toCreate.length === 0) return 0;

  const now = Date.now();
  await prisma.extensionTask.createMany({
    data: toCreate.map((c) => ({
      userId: c.ownerId,
      kind: "SCRAPE_PROFILE" as const,
      payload: { contactId: c.id, linkedinUrl: c.linkedinUrl },
      // Randomized time within the spread window → visits are spread through the day.
      scheduledFor: new Date(now + Math.floor(Math.random() * SPREAD_WINDOW_MS)),
    })),
  });
  return toCreate.length;
}
