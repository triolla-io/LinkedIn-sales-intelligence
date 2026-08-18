/**
 * Persistence for the discovery pipeline.
 *
 * upsertTechItem is idempotent on the shared dedupeKey, which is what makes one
 * launch covered by three outlets a single row — and what lets a second company
 * reuse an item another company already paid to write up.
 */
import { prisma } from "@/lib/prisma";
import type { CappedCandidate, TechItemDraft } from "@/lib/tech-radar/types";
import { makeItemDedupeKey, isSameTechnology } from "@/lib/tech-radar/item";

/**
 * Create the TechItem or return the existing one. Sources of an existing item are
 * merged so later coverage of the same launch is not lost, and `thin` is cleared
 * once any run manages to read a real page.
 */
/** Merge new coverage into an existing item without losing what is already there. */
async function mergeInto(
  existing: { id: string; sources: unknown; thin: boolean },
  draft: TechItemDraft
): Promise<string> {
  const prior = Array.isArray(existing.sources) ? (existing.sources as { url?: string }[]) : [];
  const seen = new Set(prior.map((s) => s?.url).filter(Boolean));
  const merged = [...prior, ...draft.sources.filter((s) => !seen.has(s.url))];
  if (merged.length !== prior.length || (existing.thin && !draft.thin)) {
    await prisma.techItem.update({
      where: { id: existing.id },
      data: { sources: merged, thin: existing.thin && draft.thin },
    });
  }
  return existing.id;
}

export async function upsertTechItem(draft: TechItemDraft): Promise<string> {
  const dedupeKey = makeItemDedupeKey(draft.vendor, draft.technology);
  const existing = await prisma.techItem.findUnique({
    where: { dedupeKey },
    select: { id: true, sources: true, thin: true },
  });
  if (existing) return mergeInto(existing, draft);

  // No exact hit. The same announcement covered by two outlets gets named two slightly
  // different ways, which an exact key can never catch — compare recent items from the
  // same parties by name similarity before creating a twin.
  const vendorPrefix = `${dedupeKey.split("::")[0]}::`;
  const siblings = await prisma.techItem.findMany({
    where: { dedupeKey: { startsWith: vendorPrefix } },
    select: { id: true, technology: true, sources: true, thin: true },
    take: 20,
  });
  const twin = siblings.find((s) => isSameTechnology(s.technology, draft.technology));
  if (twin) return mergeInto(twin, draft);

  const created = await prisma.techItem.create({
    data: {
      vendor: draft.vendor,
      technology: draft.technology,
      title: draft.title,
      summary: draft.summary,
      categories: draft.categories,
      sources: draft.sources,
      publishedAt: draft.publishedAt ? new Date(draft.publishedAt) : null,
      thin: draft.thin,
      dedupeKey,
    },
    select: { id: true },
  });
  return created.id;
}

/** Create the per-company opportunities. Idempotent on (trackedCompanyId, itemId). */
export async function createOpportunities(candidates: CappedCandidate[]): Promise<number> {
  let created = 0;
  for (const c of candidates) {
    const existing = await prisma.techOpportunity.findUnique({
      where: { trackedCompanyId_itemId: { trackedCompanyId: c.trackedCompanyId, itemId: c.itemId } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.techOpportunity.create({
      data: {
        trackedCompanyId: c.trackedCompanyId,
        itemId: c.itemId,
        fitRationale: c.fitRationale,
        score: c.score,
        status: "DISCOVERED",
      },
    });
    created += 1;
  }
  return created;
}

/**
 * Opportunities still awaiting drafting, read from durable state rather than from
 * whatever the creating step returned — the pattern documented in
 * detectAndRecordSignals, so an Inngest retry neither duplicates nor drops drafts.
 */
export async function findDraftableOpportunityIds(trackedCompanyId: string): Promise<string[]> {
  const rows = await prisma.techOpportunity.findMany({
    where: { trackedCompanyId, status: "DISCOVERED", drafts: { none: {} } },
    select: { id: true },
    orderBy: { score: "desc" },
  });
  return rows.map((r) => r.id);
}

/** Existing item ids for a company, so a scan never re-judges what it already has. */
export async function existingItemIds(trackedCompanyId: string): Promise<Set<string>> {
  const rows = await prisma.techOpportunity.findMany({
    where: { trackedCompanyId },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
}
