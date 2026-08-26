/**
 * Which stored judgements a rebuild has invalidated.
 *
 * A rebuild replaces a person's axes, and everything already computed against the axes
 * it removed was computed through the old lens. Erez Rachmil's 11 vetoes were all judged
 * against CTO-lens axes; leaving them in place makes the decisions screen and the quiet
 * counters present stale reasoning as the current decision.
 *
 * Marked, never deleted — the trail is what lets a wrong decision be argued with months
 * later. And never a SENT draft: that one went to a human being, and no rebuild changes
 * the fact that it did.
 *
 * The selectors are pure; markSuperseded at the bottom is the database half.
 */
import { prisma } from "@/lib/prisma";

/**
 * Matches on axes nobody subscribes to any more.
 *
 * `liveAxisIds` is ORG-WIDE on purpose. An AxisMatch is judged once and shared by every
 * subscriber — that sharing is what keeps LLM cost flat as the person count grows — so a
 * single remaining subscriber anywhere keeps the judgement useful.
 */
export function supersededMatches(
  matches: { id: string; axisId: string }[],
  liveAxisIds: Set<string>
): string[] {
  return matches.filter((m) => !liveAxisIds.has(m.axisId)).map((m) => m.id);
}

/**
 * Drafts whose axis their own person no longer subscribes to.
 *
 * Scoped per contact, and only for contacts present in `liveAxisIdsByContact`: a person
 * the rebuild did not touch has an unchanged model, and marking their drafts would
 * rewrite history for no reason. A null axisId cannot be shown to have survived, so it
 * counts as superseded for a person who WAS rebuilt.
 */
export function supersededDrafts(
  drafts: { id: string; contactId: string; axisId: string | null; status: string }[],
  liveAxisIdsByContact: Map<string, Set<string>>
): string[] {
  return drafts
    .filter((d) => {
      if (d.status === "SENT") return false;
      const live = liveAxisIdsByContact.get(d.contactId);
      if (!live) return false;
      return d.axisId == null || !live.has(d.axisId);
    })
    .map((d) => d.id);
}


/**
 * Mark everything a rebuild invalidated for the given contacts, in one place.
 *
 * Called AFTER the new axes are attached, so "live" means the new model. Runs even when
 * nothing changed — a no-op is cheaper than deciding whether to call it.
 *
 * Not pure (this is the DB half); the selection logic above is, and is where the rules
 * are tested.
 */
export async function markSuperseded(
  input: { orgId: string; ownerId: string; contactIds: string[] }
): Promise<{ matches: number; drafts: number }> {
  if (input.contactIds.length === 0) return { matches: 0, drafts: 0 };

  // Live subscriptions across the WHOLE org: an AxisMatch is shared, so one remaining
  // subscriber anywhere keeps it current.
  const liveOrgWide = await prisma.personAxis.findMany({
    where: { mutedAt: null, axis: { orgId: input.orgId } },
    select: { axisId: true, personProfile: { select: { contactId: true } } },
  });
  const liveAxisIds = new Set(liveOrgWide.map((r) => r.axisId));

  const liveByContact = new Map<string, Set<string>>();
  for (const id of input.contactIds) liveByContact.set(id, new Set());
  for (const r of liveOrgWide) {
    const set = liveByContact.get(r.personProfile.contactId);
    if (set) set.add(r.axisId);
  }

  const [matches, drafts] = await Promise.all([
    prisma.axisMatch.findMany({
      where: { supersededAt: null, axis: { orgId: input.orgId } },
      select: { id: true, axisId: true },
    }),
    prisma.radarDraft.findMany({
      where: { ownerId: input.ownerId, supersededAt: null, contactId: { in: input.contactIds } },
      select: { id: true, contactId: true, axisId: true, status: true },
    }),
  ]);

  const staleMatchIds = supersededMatches(matches, liveAxisIds);
  const staleDraftIds = supersededDrafts(drafts, liveByContact);
  const now = new Date();

  const [m, d] = await Promise.all([
    staleMatchIds.length
      ? prisma.axisMatch.updateMany({ where: { id: { in: staleMatchIds } }, data: { supersededAt: now } })
      : Promise.resolve({ count: 0 }),
    staleDraftIds.length
      ? prisma.radarDraft.updateMany({ where: { id: { in: staleDraftIds } }, data: { supersededAt: now } })
      : Promise.resolve({ count: 0 }),
  ]);

  return { matches: m.count, drafts: d.count };
}
