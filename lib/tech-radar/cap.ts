/**
 * Stage 5: the weekly opportunity cap.
 *
 * This is what keeps the feed usable as the tracked-company list grows from 3
 * to 50. Two ceilings apply: a per-company cap, then a global weekly cap — but
 * the global cut carries a FLOOR of one opportunity per company that had any
 * candidate, so a single high-scoring company can never swallow the whole week.
 *
 * Fully deterministic: Inngest replays the same step and must get the same
 * answer, so every ordering is total (score, then itemId, then companyId).
 * Pure — no prisma, no LLM, never throws.
 */
import {
  MAX_OPPORTUNITIES_PER_COMPANY,
  WEEKLY_OPPORTUNITY_CAP,
  type CappedCandidate,
} from "@/lib/tech-radar/types";

/** Total order: highest score first, ties broken so replays are stable. */
function byScoreThenId(a: CappedCandidate, b: CappedCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
  if (a.trackedCompanyId !== b.trackedCompanyId) return a.trackedCompanyId < b.trackedCompanyId ? -1 : 1;
  return 0;
}

export function allocateWeeklyCap(
  candidates: CappedCandidate[],
  opts: { perCompany?: number; weekly?: number } = {}
): CappedCandidate[] {
  const perCompany = Math.max(0, opts.perCompany ?? MAX_OPPORTUNITIES_PER_COMPANY);
  const weekly = Math.max(0, opts.weekly ?? WEEKLY_OPPORTUNITY_CAP);
  if (candidates.length === 0 || perCompany === 0 || weekly === 0) return [];

  // 1. Per-company cap, best-scoring first.
  const byCompany = new Map<string, CappedCandidate[]>();
  for (const c of candidates) {
    const list = byCompany.get(c.trackedCompanyId);
    if (list) list.push(c);
    else byCompany.set(c.trackedCompanyId, [c]);
  }
  // Company iteration order must not depend on Map insertion order either.
  const companyIds = [...byCompany.keys()].sort();
  const perCompanyKept = new Map<string, CappedCandidate[]>();
  for (const id of companyIds) {
    const sorted = [...(byCompany.get(id) ?? [])].sort(byScoreThenId);
    perCompanyKept.set(id, sorted.slice(0, perCompany));
  }

  const survivors = companyIds.flatMap((id) => perCompanyKept.get(id) ?? []);
  if (survivors.length <= weekly) return survivors.sort(byScoreThenId);

  // 2. The floor: every company with a candidate keeps its best one. When there
  //    are more companies than the weekly cap allows, the floor itself has to be
  //    rationed — take the best-of-each, then keep the strongest of those.
  const bests = companyIds
    .map((id) => (perCompanyKept.get(id) ?? [])[0])
    .filter((c): c is CappedCandidate => !!c)
    .sort(byScoreThenId);

  if (bests.length >= weekly) return bests.slice(0, weekly);

  // 3. Fill the remaining slots globally by score from everything not already in.
  const taken = new Set(bests.map((c) => `${c.trackedCompanyId}::${c.itemId}`));
  const rest = survivors
    .filter((c) => !taken.has(`${c.trackedCompanyId}::${c.itemId}`))
    .sort(byScoreThenId);

  return [...bests, ...rest.slice(0, weekly - bests.length)].sort(byScoreThenId);
}
