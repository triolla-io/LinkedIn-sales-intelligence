/**
 * The discovery scan: pooled queries -> shared triage -> shared write-ups ->
 * per-company fit -> capped opportunities.
 *
 * Shared stages run once for the whole org and are reused by every company, which
 * is what keeps the cost flat as the tracked list grows. Only fit is per-company.
 *
 * Every ceiling in lib/tech-radar/types.ts is enforced here; exceeding one stops
 * that stage rather than continuing.
 */
import { prisma } from "@/lib/prisma";
import { readPage } from "@/lib/research/read-page";
import { canonicalizeSourceUrl } from "@/lib/news/canonical-url";
import { buildQueryPool } from "@/lib/tech-radar/queries";
import { fetchPoolNews } from "@/lib/tech-radar/fetch-pool-news";
import { splitFresh } from "@/lib/tech-radar/freshness";
import { triageAll, type PoolItem } from "@/lib/tech-radar/triage";
import { synthesizeItem } from "@/lib/tech-radar/item";
import { prefilterItems, judgeFit, profileTerms, type FitItem } from "@/lib/tech-radar/fit";
import { allocateWeeklyCap } from "@/lib/tech-radar/cap";
import { upsertTechItem, createOpportunities, existingItemIds } from "@/lib/tech-radar/persist";
import { SHAREWORTHY_FLOOR, type ItemKind, type TriageVerdict } from "@/lib/tech-radar/types";
import {
  MAX_PAGE_READS_PER_RUN,
  MAX_SYNTHESIS_PER_RUN,
  isUsableProfile,
  type CappedCandidate,
  type TechRadarProfile,
} from "@/lib/tech-radar/types";

export type ScanReport = {
  companies: number;
  queriesRun: number;
  poolItems: number;
  /** Items that cleared the shareworthy floor. Kept as `launches` only in name would
   *  be a lie about what it counts, so it is renamed. */
  worthSharing: number;
  /** Per-kind pass rate, so a run can show whether the filter filters. */
  triageByKind: TriageKindCount[];
  itemsWritten: number;
  opportunitiesCreated: number;
  /** True when providers returned nothing at all — a quota wall, not an empty week. */
  quotaExhausted: boolean;
  /** Published outside the 30-day window. Research gets no grace. */
  staleDropped: number;
  /** No date could be extracted, so the item could not be proven fresh. */
  undatedDropped: number;
};

type ActiveCompany = {
  id: string;
  name: string;
  profile: TechRadarProfile;
};

/**
 * Order launches by how well their triage tags match the profiles of the companies that
 * asked for them. Cheap, deterministic and pre-synthesis, so the expensive stage is
 * spent on the most relevant items. Ties keep a stable order by url so an Inngest replay
 * makes the same choices.
 */
export function rankLaunchesByRelevance(
  launches: TriageVerdict[],
  companies: { id: string; profile: TechRadarProfile }[],
  byUrl: Map<string, { companyIds: string[] }>
): TriageVerdict[] {
  const termsByCompany = new Map(companies.map((c) => [c.id, profileTerms(c.profile)]));

  const score = (verdict: TriageVerdict): number => {
    const subscribers = byUrl.get(verdict.url)?.companyIds ?? [];
    const tags = verdict.categories.flatMap((c) => c.toLowerCase().split(/\s+/)).filter((t) => t.length > 3);
    let best = 0;
    for (const companyId of subscribers) {
      const terms = termsByCompany.get(companyId);
      if (!terms) continue;
      let overlap = 0;
      for (const tag of tags) if (terms.has(tag)) overlap += 1;
      best = Math.max(best, overlap);
    }
    return best;
  };

  return [...launches]
    .map((v) => ({ v, s: score(v) }))
    .sort((a, b) => (b.s !== a.s ? b.s - a.s : a.v.url < b.v.url ? -1 : 1))
    .map((x) => x.v);
}

/** Companies due a scan: ACTIVE, usable profile, and past their own interval. */
export async function loadScannableCompanies(orgId: string, now = new Date()): Promise<ActiveCompany[]> {
  const rows = await prisma.trackedCompany.findMany({
    where: { orgId, status: "ACTIVE" },
    select: { id: true, name: true, profile: true, lastScanAt: true, scanIntervalDays: true },
    orderBy: { name: "asc" },
  });

  return rows
    .filter((r) => {
      if (!r.lastScanAt) return true;
      const dueAt = r.lastScanAt.getTime() + r.scanIntervalDays * 24 * 60 * 60 * 1000;
      return now.getTime() >= dueAt;
    })
    .filter((r): r is typeof r & { profile: TechRadarProfile } => isUsableProfile(r.profile))
    .map((r) => ({ id: r.id, name: r.name, profile: r.profile }));
}

/**
 * One scan for one org. Returns a report rather than throwing on empty results —
 * an empty week is a legitimate outcome and must be distinguishable from a quota wall.
 */
export type TriageKindCount = { kind: ItemKind; seen: number; passed: number };

/**
 * Per-kind seen/passed, ordered by what was seen most. Pure, so the numbers on the
 * screen and the numbers in the log cannot disagree.
 */
export function summarizeTriage(verdicts: TriageVerdict[]): TriageKindCount[] {
  const byKind = new Map<ItemKind, TriageKindCount>();
  for (const v of verdicts) {
    const e = byKind.get(v.kind) ?? { kind: v.kind, seen: 0, passed: 0 };
    e.seen += 1;
    if (v.shareworthy >= SHAREWORTHY_FLOOR && !v.staleness) e.passed += 1;
    byKind.set(v.kind, e);
  }
  return [...byKind.values()].sort((a, b) => b.seen - a.seen || (a.kind < b.kind ? -1 : 1));
}

export async function scanOrg(orgId: string): Promise<ScanReport> {
  const companies = await loadScannableCompanies(orgId);
  const empty: ScanReport = {
    companies: companies.length,
    queriesRun: 0,
    poolItems: 0,
    worthSharing: 0,
    triageByKind: [],
    itemsWritten: 0,
    opportunitiesCreated: 0,
    quotaExhausted: false,
    staleDropped: 0,
    undatedDropped: 0,
  };
  if (companies.length === 0) return empty;

  // ── Stage 1: one canonical pool for the whole org ──────────────────────────
  const pool = buildQueryPool(companies.map((c) => ({ id: c.id, searchQueries: c.profile.searchQueries })));
  const news = await fetchPoolNews(pool);

  // Hard gate (26.8): only items published in the last 30 days go anywhere — research
  // included, no per-kind grace. An item whose date cannot be extracted is rejected
  // rather than demoted: an undated item shown as this week's is worse than one never sent.
  const { fresh, stale, undated } = splitFresh(news.items, new Date());
  if (fresh.length === 0) {
    return {
      ...empty, queriesRun: news.queriesRun, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length,
    };
  }

  // ── Stage 2: shared shareworthiness triage, once per pool item ────────────
  const poolItems: PoolItem[] = fresh.map((i) => ({
    title: i.title,
    url: i.url,
    snippet: i.snippet,
    publishedAt: i.publishedAt,
  }));
  const verdicts = await triageAll(poolItems);
  const worthSharing = verdicts.filter((v) => v.shareworthy >= SHAREWORTHY_FLOOR && !v.staleness);

  // Say what the filter DID, not just how much survived. "N items passed" cannot
  // distinguish a filter that rejects vendor promotion from one that tags everything
  // and rejects nothing — and the first run's failure was exactly that ambiguity.
  const triageByKind = summarizeTriage(verdicts);
  console.log(
    `[tech-radar] triage org=${orgId} ${triageByKind.map((k) => `${k.kind}=${k.passed}/${k.seen}`).join(" ")} stale=${
      verdicts.filter((v) => v.staleness).length
    }`
  );

  if (worthSharing.length === 0) {
    return {
      ...empty,
      queriesRun: news.queriesRun,
      poolItems: poolItems.length,
      triageByKind,
      quotaExhausted: news.quotaLikely,
      staleDropped: stale.length,
      undatedDropped: undated.length,
    };
  }

  // ── Stage 3: read the real pages and write each item up once ──────────────
  const byUrl = new Map(fresh.map((i) => [i.url, i]));
  const itemIdByUrl = new Map<string, string>();
  const itemsById = new Map<string, FitItem>();
  const subscribersByItemId = new Map<string, Set<string>>();

  let pageReads = 0;
  let syntheses = 0;

  // The budget is smaller than the number of launches a good week produces, so spend it
  // on what the subscribing companies actually care about rather than on whatever came
  // back first: the final Delek run found 19 launches, could write up 8, and dropped 11
  // in arrival order.
  const ranked = rankLaunchesByRelevance(worthSharing, companies, byUrl);

  for (const verdict of ranked) {
    if (syntheses >= MAX_SYNTHESIS_PER_RUN * Math.max(1, companies.length)) {
      console.warn(`[tech-radar] synthesis ceiling reached for org ${orgId}; ${worthSharing.length - syntheses} shareworthy items skipped`);
      break;
    }
    const source = byUrl.get(verdict.url);
    if (!source) continue;

    const pages = [];
    if (pageReads < MAX_PAGE_READS_PER_RUN * Math.max(1, companies.length)) {
      const page = await readPage(verdict.url);
      pageReads += 1;
      if (page) pages.push(page);
    }

    try {
      // Store where the read LANDED, not where the search pointed — a redirect wrapper
      // the ingest could not unwrap statically resolves here or never.
      const storedUrl = canonicalizeSourceUrl(pages[0]?.finalUrl ? pages[0].finalUrl : source.url);
      const draft = await synthesizeItem({
        triage: verdict,
        articles: [
          { url: storedUrl, title: source.title, snippet: source.snippet, publishedAt: source.publishedAt },
        ],
        pages,
      });
      syntheses += 1;
      const itemId = await upsertTechItem(draft);
      itemIdByUrl.set(verdict.url, itemId);
      itemsById.set(itemId, {
        itemId,
        vendor: draft.vendor,
        technology: draft.technology,
        title: draft.title,
        summary: draft.summary,
        categories: draft.categories,
      });
      const subs = subscribersByItemId.get(itemId) ?? new Set<string>();
      for (const companyId of source.companyIds) subs.add(companyId);
      subscribersByItemId.set(itemId, subs);
    } catch (err) {
      // One unwritable item must not lose the rest of the run.
      console.error(
        `[tech-radar] item synthesis failed for ${verdict.url}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (itemsById.size === 0) {
    return {
      ...empty,
      queriesRun: news.queriesRun,
      poolItems: poolItems.length,
      worthSharing: worthSharing.length,
      triageByKind,
      staleDropped: stale.length,
      undatedDropped: undated.length,
    };
  }

  // ── Stage 4: per-company fit ──────────────────────────────────────────────
  const candidates: CappedCandidate[] = [];

  for (const company of companies) {
    const already = await existingItemIds(company.id);
    const offered = [...itemsById.values()].filter(
      (item) => !already.has(item.itemId) && subscribersByItemId.get(item.itemId)?.has(company.id)
    );
    if (offered.length === 0) continue;

    for (const item of prefilterItems(company.profile, offered)) {
      try {
        const verdict = await judgeFit(company.profile, company.name, item);
        if (!verdict.fits) continue;
        candidates.push({
          trackedCompanyId: company.id,
          itemId: item.itemId,
          fitRationale: verdict.fitRationale,
          score: verdict.score,
          lineKey: verdict.businessLine,
        });
      } catch (err) {
        console.error(
          `[tech-radar] fit judgement failed for company ${company.id} item ${item.itemId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // ── Stage 5: cap and persist ──────────────────────────────────────────────
  const kept = allocateWeeklyCap(candidates);
  if (kept.length < candidates.length) {
    console.warn(
      `[tech-radar] weekly cap trimmed ${candidates.length - kept.length} of ${candidates.length} candidates for org ${orgId}`
    );
  }
  const created = await createOpportunities(kept);

  await prisma.trackedCompany.updateMany({
    where: { id: { in: companies.map((c) => c.id) } },
    data: { lastScanAt: new Date() },
  });

  return {
    companies: companies.length,
    queriesRun: news.queriesRun,
    poolItems: poolItems.length,
    worthSharing: worthSharing.length,
    triageByKind,
    itemsWritten: itemsById.size,
    opportunitiesCreated: created,
    quotaExhausted: news.quotaLikely,
    staleDropped: stale.length,
    undatedDropped: undated.length,
  };
}
