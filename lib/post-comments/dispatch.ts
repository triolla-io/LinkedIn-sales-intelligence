import { prisma } from "@/lib/prisma";
import { buildActivityUrl } from "@/lib/post-comments/posts";

// Applied per invocation of dispatchPostScrapes, not per calendar day — this function is
// also called from the follow route (one contact) and the kick-on-enable path (one org),
// so "daily cap" would be the wrong name for a limit that has nothing to do with the clock.
export const MAX_SCRAPES_PER_OWNER_PER_RUN = 25; // matches job-check's SCRAPE_PROFILE budget thinking
const SPREAD_WINDOW_MS = 6 * 60 * 60 * 1000; // spread scrapes over 6h, human-ish

/**
 * Create SCRAPE_POSTS tasks for watched contacts. orgId narrows to one org
 * (kick-on-enable / follow-now); omitted = all orgs with the module on (daily tick).
 * contactIds further narrows to specific contacts (e.g. the follow route dispatching just
 * the one contact that was newly followed) — the org gate below still applies even then,
 * so an org with the module OFF gets zero tasks regardless of what contactIds is passed.
 */
export async function dispatchPostScrapes(
  opts: { orgId?: string; contactIds?: string[] } = {}
): Promise<{ created: number }> {
  const contacts = await prisma.contact.findMany({
    where: {
      postWatchEnabled: true,
      linkedinUrl: { not: "" },
      removedAt: null,
      ...(opts.contactIds ? { id: { in: opts.contactIds } } : {}),
      owner: {
        org: {
          postCommentsEnabled: true,
          ...(opts.orgId ? { id: opts.orgId } : {}),
        },
      },
    },
    select: { id: true, ownerId: true, linkedinUrl: true },
  });
  if (contacts.length === 0) return { created: 0 };

  // Skip contacts that already have a SCRAPE_POSTS task queued or claimed (e.g. cron +
  // kick-on-enable + follow-now overlap) so tasks don't pile up for the same contact.
  const live = await prisma.extensionTask.findMany({
    where: { kind: "SCRAPE_POSTS", status: { in: ["PENDING", "CLAIMED"] } },
    select: { payload: true },
  });
  const inFlight = new Set(
    live
      .map((t) => (t.payload as { contactId?: string })?.contactId)
      .filter((id): id is string => typeof id === "string")
  );

  const perOwner = new Map<string, number>();
  const now = Date.now();
  const toCreate: Array<{ id: string; ownerId: string; linkedinUrl: string }> = [];
  for (const c of contacts) {
    if (inFlight.has(c.id)) continue;
    const used = perOwner.get(c.ownerId) ?? 0;
    if (used >= MAX_SCRAPES_PER_OWNER_PER_RUN) continue;
    perOwner.set(c.ownerId, used + 1);
    toCreate.push(c);
  }
  if (toCreate.length === 0) return { created: 0 };

  // An explicit contactIds list means a person just pressed "follow" and is watching the
  // screen — run now. The spread window exists to keep the DAILY sweep from visiting
  // every profile the instant the tick fires; applying it to a hand-picked follow would
  // make the user wait hours for the thing she just asked for.
  const immediate = (opts.contactIds?.length ?? 0) > 0;

  await prisma.extensionTask.createMany({
    data: toCreate.map((c) => ({
      userId: c.ownerId,
      kind: "SCRAPE_POSTS" as const,
      payload: { contactId: c.id, activityUrl: buildActivityUrl(c.linkedinUrl) },
      scheduledFor: immediate
        ? new Date(now)
        : new Date(now + Math.floor(Math.random() * SPREAD_WINDOW_MS)),
    })),
  });
  return { created: toCreate.length };
}
