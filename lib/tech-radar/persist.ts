/**
 * Persistence for the discovery pipeline.
 *
 * upsertTechItem is idempotent on the shared dedupeKey, which is what makes one
 * launch covered by three outlets a single row — and what lets a second company
 * reuse an item another company already paid to write up.
 */
import { prisma } from "@/lib/prisma";
import type { CappedCandidate, TechItemDraft } from "@/lib/tech-radar/types";
import { makeItemDedupeKey, isSameLaunch } from "@/lib/tech-radar/item";

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

/** Normalised for comparison: scheme, www, trailing slash and tracking params are noise. */
export function normalizeStoryUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export async function upsertTechItem(draft: TechItemDraft): Promise<string> {
  // Story-level first: the SAME URL is the same story, whatever the write-up called it.
  // The 2026-08-23 run stored one Nature paper twice, as "CO2-EOR" and as "CO2-EOR with
  // xanthan gum", because the key is built from the model's own naming and the model
  // named it differently on two passes. A url is not a matter of opinion.
  const storyUrls = new Set(draft.sources.map((x) => normalizeStoryUrl(x.url)).filter(Boolean));
  if (storyUrls.size > 0) {
    const recent = await prisma.techItem.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: { id: true, sources: true, thin: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    for (const row of recent) {
      const rowUrls = Array.isArray(row.sources) ? (row.sources as { url?: string }[]) : [];
      if (rowUrls.some((x) => x?.url && storyUrls.has(normalizeStoryUrl(x.url)))) {
        return mergeInto(row, draft);
      }
    }
  }

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
    select: { id: true, technology: true, categories: true, sources: true, thin: true },
    take: 20,
  });
  const twin = siblings.find((s) => isSameLaunch(s, draft));
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
      shareworthy: draft.shareworthy,
      stature: draft.stature,
      kind: draft.kind,
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
        businessLine: c.lineKey ?? null,
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
    select: { id: true, businessLine: true, score: true },
    orderBy: [{ score: "desc" }, { id: "asc" }],
  });
  return interleaveByLine(rows);
}

/**
 * Round-robin the drafting order across business lines.
 *
 * Each contact can only hold a couple of open drafts, and drafting strictly by score let
 * one line spend that budget entirely: in the first human-run scan both of Delek's energy
 * opportunities ended up with zero drafts because the finance ones drafted first. Taking
 * the best of each line in turn means every line reaches a person.
 */
export function interleaveByLine(
  rows: { id: string; businessLine: string | null }[]
): string[] {
  const byLine = new Map<string, string[]>();
  for (const r of rows) {
    // Unattributed opportunities share one bucket rather than each claiming a turn.
    const key = (r.businessLine ?? "").trim().toLowerCase();
    const list = byLine.get(key);
    if (list) list.push(r.id);
    else byLine.set(key, [r.id]);
  }

  // Line order follows the best-scoring line first, since `rows` arrives sorted.
  const lines = [...byLine.keys()];
  const out: string[] = [];
  for (let round = 0; out.length < rows.length; round += 1) {
    let progressed = false;
    for (const line of lines) {
      const queue = byLine.get(line);
      if (!queue || round >= queue.length) continue;
      out.push(queue[round]);
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}

/** Existing item ids for a company, so a scan never re-judges what it already has. */
export async function existingItemIds(trackedCompanyId: string): Promise<Set<string>> {
  const rows = await prisma.techOpportunity.findMany({
    where: { trackedCompanyId },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
}
