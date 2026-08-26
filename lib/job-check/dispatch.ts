import { prisma } from "@/lib/prisma";
import { selectDueContacts, type DueRow } from "@/lib/job-check/select-due-contacts";

const DAILY_CAP = 25; // conservative profile-visit budget per owner per dispatch
// Spread the scheduled scrapes across ~9 hours so the extension visits roughly one
// profile every 20-25 min (humanized) instead of back-to-back. The extension's
// tasks/next only claims tasks whose scheduledFor <= now, so future-dated tasks wait.
const SPREAD_WINDOW_MS = 9 * 60 * 60 * 1000;
export const PENDING_EXPIRY_DAYS = 7;
// A radar-marked person's profile counts as stale after this long — the same clock
// radar-person-prepare uses when it force-refreshes one contact on demand.
export const RADAR_SCRAPE_STALE_DAYS = 30;
// Slots inside DAILY_CAP that belong to radar-marked people before job-check gets a look.
// Both sources sort never-touched rows to the same -Infinity, so without a reservation an
// owner with a bottomless never-checked job-check pool (the pilot owner has ~16k) takes
// every slot every night and a hand-marked person is never scraped at all. This is a
// floor, not a ceiling: whatever radar doesn't claim goes back to job-check, and whatever
// job-check doesn't claim goes to radar. The per-owner total is still DAILY_CAP.
export const RADAR_RESERVED_SLOTS = 10;

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
  const now = Date.now();

  // A live SCRAPE_PROFILE task blocks its contact from every future dispatch (the dedup
  // below) while advancing nothing. Both blocking statuses are swept, not just PENDING:
  // a task leaves CLAIMED only when the extension POSTs a result, so one claimed by a
  // browser that was closed mid-scrape never reports — and tasks/next stops re-claiming
  // it after MAX_ATTEMPTS. After 7 days either status is a corpse, not a queue entry.
  await prisma.extensionTask.updateMany({
    where: {
      kind: "SCRAPE_PROFILE",
      status: { in: ["PENDING", "CLAIMED"] },
      createdAt: { lt: new Date(now - PENDING_EXPIRY_DAYS * 86_400_000) },
    },
    data: { status: "CANCELLED", errorCode: "expired_unclaimed" },
  });

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

  // Second source: people hand-marked for the radar, regardless of Org.jobCheckEnabled.
  // This scrape runs through the customer's own extension session — no Apollo/Bright Data
  // spend — so it doesn't need the job-check module's money gate, only the radar flag.
  const radarStaleCutoff = new Date(now - RADAR_SCRAPE_STALE_DAYS * 86_400_000);
  const radarDue = await prisma.contact.findMany({
    where: {
      linkedinUrl: { not: "" },
      removedAt: null,
      radarInclude: true,
      ...(scope?.orgId ? { owner: { org: { id: scope.orgId } } } : {}),
      OR: [{ profileScrapedAt: null }, { profileScrapedAt: { lt: radarStaleCutoff } }],
    },
    select: { id: true, ownerId: true, linkedinUrl: true, profileScrapedAt: true },
    orderBy: { profileScrapedAt: { sort: "asc", nulls: "first" } }, // never-scraped-first
    take: 500,
  });

  // The two sources are kept apart per owner, deduped by contact id across both, so the
  // split below can reserve slots for radar. A contact due on both counts is counted once
  // as a job-check row (added first) and keeps its lastJobCheckAt-based sort slot.
  const jobByOwner = new Map<string, DueRow[]>();
  const radarByOwner = new Map<string, DueRow[]>();
  const seen = new Set<string>();
  const addRow = (into: Map<string, DueRow[]>, r: DueRow) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    const arr = into.get(r.ownerId) ?? [];
    arr.push(r);
    into.set(r.ownerId, arr);
  };
  for (const c of due) addRow(jobByOwner, c);
  for (const c of radarDue) {
    addRow(radarByOwner, {
      id: c.id,
      ownerId: c.ownerId,
      linkedinUrl: c.linkedinUrl,
      lastJobCheckAt: c.profileScrapedAt,
    });
  }

  // One shared per-owner budget, split rather than merged. Merging starved radar to zero:
  // both sources sort never-touched rows to -Infinity and a stable sort keeps job-check —
  // which never runs dry — ahead of every radar row forever. So radar is handed a floor of
  // RADAR_RESERVED_SLOTS first, job-check fills what's left, and whichever source has
  // fewer rows than its share leaves the remainder to the other. The extension's LinkedIn
  // session still never sees more than DAILY_CAP visits per owner per dispatch.
  const owners = new Set([...jobByOwner.keys(), ...radarByOwner.keys()]);
  const chosen: DueRow[] = [];
  for (const ownerId of owners) {
    const jobRows = jobByOwner.get(ownerId) ?? [];
    const radarRows = radarByOwner.get(ownerId) ?? [];
    const radarFloor = Math.min(radarRows.length, RADAR_RESERVED_SLOTS);
    const jobTake = Math.min(jobRows.length, DAILY_CAP - radarFloor);
    chosen.push(...selectDueContacts(jobRows, jobTake));
    chosen.push(...selectDueContacts(radarRows, DAILY_CAP - jobTake));
  }
  if (chosen.length === 0) return 0;

  // Skip contacts that already have a scrape queued or claimed (e.g. cron + on-enable
  // overlap, or a CLAIMED task the extension hasn't finished yet) so tasks don't pile up.
  const pending = await prisma.extensionTask.findMany({
    where: { kind: "SCRAPE_PROFILE", status: { in: ["PENDING", "CLAIMED"] } },
    select: { payload: true },
  });
  const alreadyQueued = new Set(
    pending.map((t) => (t.payload as { contactId?: string })?.contactId).filter(Boolean)
  );
  const toCreate = chosen.filter((c) => !alreadyQueued.has(c.id));
  if (toCreate.length === 0) return 0;

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
