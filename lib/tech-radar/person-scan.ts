/**
 * The person-outward run, end to end.
 *
 * Direction, in one place so it can be checked at a glance:
 *
 *   marked people -> their axes -> queries from those axes -> news -> shareworthy
 *   triage -> per-AXIS fit -> the axis's subscribers -> deterministic rank -> veto
 *   -> one draft
 *
 * v1 ran the other way: org -> tracked companies -> queries from company profiles ->
 * per-COMPANY fit -> pick someone who works there. A company nobody subscribes to now
 * contributes no query and cannot pull the run toward itself.
 */
import { prisma } from "@/lib/prisma";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import { fetchPoolNews } from "@/lib/tech-radar/fetch-pool-news";
import { triageAll, type PoolItem } from "@/lib/tech-radar/triage";
import { synthesizeItem } from "@/lib/tech-radar/item";
import { readPage } from "@/lib/research/read-page";
import { canonicalizeSourceUrl } from "@/lib/news/canonical-url";
import { upsertTechItem } from "@/lib/tech-radar/persist";
import { buildAxisQueryPool, judgeAxisFit, capPoolByAxis, AXIS_FIT_FLOOR } from "@/lib/tech-radar/axis-fit";
import { splitFresh } from "@/lib/tech-radar/freshness";
import { judgeAndDraft } from "@/lib/tech-radar/judge-and-draft";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";
import { SHAREWORTHY_FLOOR, STATURE_FLOOR } from "@/lib/tech-radar/types";
import { judgeAcceptance, isIsraeliSource, type AcceptanceReport } from "@/lib/tech-radar/acceptance";

const MAX_QUERIES_PER_AXIS = 3;
/**
 * Triage cost scales with this and nothing else useful. 677 items cost ~$1 for 30
 * survivors on 2026-08-23 — over half the daily budget. 200 keeps a run near $0.35.
 */
const MAX_POOL_ITEMS = 200;
const MAX_SYNTHESIS_PER_RUN = 12;
const MAX_AXIS_FIT_PER_RUN = 40;
/** Pilot: one small batch a day, read by a human before anything is sent. */
const MAX_DRAFTS_PER_DAY = 10;
/** MUST equal QUIET_COOLDOWN_DAYS in lib/tech-radar/quiet.ts, which stays prisma-free
 *  and therefore cannot import this. */
export const MIN_DAYS_BETWEEN_MESSAGES = 7;

/** What one axis asked for this run, and what came back. Rendered as explained silence. */
export type AxisStat = {
  axisId: string;
  label: string;
  queries: number;
  results: number;
  /** A Hebrew query that returned no Israeli source — a warning, not a failure. */
  hebrewNoIsraeliSource: boolean;
};

const HEBREW_RE = /[֐-׿]/;

/**
 * Attribute each query and each returned item back to the axes that asked for it. The
 * pool is deduplicated across axes, so one query can serve several — every subscriber
 * is credited, which is why this cannot be a simple per-query count.
 */
export function tallyAxisStats(
  axes: { id: string; label: string }[],
  pool: { query: string; axisIds: string[] }[],
  items: { url: string; companyIds: string[] }[]
): AxisStat[] {
  return axes.map((axis) => {
    const mine = pool.filter((p) => p.axisIds.includes(axis.id));
    const got = items.filter((i) => i.companyIds.includes(axis.id));
    const askedInHebrew = mine.some((p) => HEBREW_RE.test(p.query));
    return {
      axisId: axis.id,
      label: axis.label,
      queries: mine.length,
      results: got.length,
      hebrewNoIsraeliSource: askedInHebrew && !got.some((i) => isIsraeliSource(i.url)),
    };
  });
}

export type PersonScanReport = {
  axes: number;
  queriesRun: number;
  poolItems: number;
  worthSharing: number;
  itemsWritten: number;
  axisFitsJudged: number;
  candidates: number;
  vetoed: number;
  drafted: number;
  /** How many pool items the cap discarded, so a truncated run says so. */
  poolDropped: number;
  /** Published outside the 30-day window. Research gets no grace. */
  staleDropped: number;
  /** No date could be extracted, so the item could not be proven fresh. */
  undatedDropped: number;
  /** On-topic but weightless. The failure mode `stature` was added to name. */
  relevantButLight: number;
  /** Items whose page could not be read, so their summary is snippet-only. */
  snippetOnly: number;
  /** Did the run clear the pilot's bar, and if not, what was missing. */
  acceptance: AcceptanceReport;
  /** Why candidates were dropped, counted by reason. Never a bare number. */
  dropReasons: Record<string, number>;
  triageByKind: { kind: string; seen: number; passed: number }[];
  quotaExhausted: boolean;
};

const EMPTY: PersonScanReport = {
  axes: 0, queriesRun: 0, poolItems: 0, worthSharing: 0, itemsWritten: 0,
  axisFitsJudged: 0, candidates: 0, vetoed: 0, drafted: 0, poolDropped: 0, staleDropped: 0, undatedDropped: 0,
  relevantButLight: 0, snippetOnly: 0,
  acceptance: { weighty: 0, israeliSource: 0, israelRelevant: 0, met: false, shortfall: "לא נסרק" },
  dropReasons: {}, triageByKind: [], quotaExhausted: false,
};

function countBy(reasons: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

export async function personScan(orgId: string): Promise<PersonScanReport> {
  // ── 0. Open the run row before any work ───────────────────────────────────
  // A crash leaves finishedAt null, which reads as a stuck run instead of silence —
  // and EVERY exit path below must close the row, or the UI shows a scan that never
  // happened.
  const run = await prisma.radarScanRun.create({ data: { orgId }, select: { id: true } });
  /**
   * Per-axis query accounting, filled as the run progresses. An axis with zero results
   * is the difference between "the radar is broken" and "there was nothing this week" —
   * the decisions screen renders these as an explained silence, not a bug.
   */
  let axisStats: AxisStat[] = [];
  const finish = async (report: PersonScanReport): Promise<PersonScanReport> => {
    await prisma.radarScanRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        scanned: report.poolItems,
        topical: report.worthSharing,
        important: report.itemsWritten,
        connected: report.candidates,
        drafts: report.drafted,
        vetoed: report.vetoed,
        report: JSON.parse(JSON.stringify(report)),
        axisStats: axisStats.length ? JSON.parse(JSON.stringify(axisStats)) : undefined,
      },
    });
    return report;
  };

  // ── 1. The axes people actually subscribe to ──────────────────────────────
  // An axis with no subscribers contributes no query. That single condition is what
  // makes this run person-outward rather than company-outward.
  const axes = await prisma.radarAxis.findMany({
    where: { orgId, status: "ACTIVE", people: { some: {} } },
    select: {
      id: true, label: true, searchQueries: true, weight: true,
      people: {
        select: {
          weight: true, rationale: true,
          personProfile: {
            select: {
              contactId: true, roleLens: true, personalNotes: true, employerTrackedCompanyId: true,
              contact: { select: { id: true, ownerId: true, fullName: true, hebrewFirstName: true, currentTitle: true, currentCompany: true } },
            },
          },
        },
      },
    },
  });
  if (axes.length === 0) return finish(EMPTY);

  // ── 2. Queries from axes, not from company profiles ───────────────────────
  const pool = buildAxisQueryPool(
    axes.map((a) => ({ id: a.id, searchQueries: a.searchQueries })),
    normalizeQuery,
    MAX_QUERIES_PER_AXIS
  );
  const news = await fetchPoolNews(pool.map((p) => ({ query: p.query, companyIds: p.axisIds })));

  // Hard gate (26.8): only items published in the last 30 days go anywhere —
  // research included, no per-kind grace. An item whose date cannot be extracted
  // is rejected rather than demoted: an undated item shown to Yuval as if it were
  // this week's is worse than one we never sent.
  const { fresh, stale, undated } = splitFresh(news.items, new Date());
  const freshnessDrops: Record<string, number> = {};
  if (undated.length > 0) freshnessDrops.no_extractable_date = undated.length;
  if (stale.length > 0) freshnessDrops.older_than_window = stale.length;

  // Recorded before any filtering below this point: this answers "did the axis get
  // anything at all", which is a different question from "did anything survive triage" —
  // but recorded AFTER the freshness gate, so a stale-only axis does not look productive.
  axisStats = tallyAxisStats(
    axes.map((a) => ({ id: a.id, label: a.label })),
    pool,
    fresh
  );
  if (fresh.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length, dropReasons: freshnessDrops,
    });
  }

  // ── 3. Shareworthiness triage, once per item, company- and person-agnostic ─
  // Capped before triage, round-robin across axes, so the cut never starves one
  // interest and the bill stays predictable.
  const capped = capPoolByAxis(fresh, MAX_POOL_ITEMS);
  if (capped.dropped > 0) {
    console.log(`[radar] pool capped org=${orgId} kept=${capped.kept.length} dropped=${capped.dropped}`);
  }
  const poolItems: PoolItem[] = capped.kept.map((i) => ({
    title: i.title, url: i.url, snippet: i.snippet, publishedAt: i.publishedAt,
  }));
  const verdicts = await triageAll(poolItems);
  const byKind = new Map<string, { kind: string; seen: number; passed: number }>();
  for (const v of verdicts) {
    const e = byKind.get(v.kind) ?? { kind: v.kind, seen: 0, passed: 0 };
    e.seen += 1;
    if (v.shareworthy >= SHAREWORTHY_FLOOR && v.stature >= STATURE_FLOOR && !v.staleness) e.passed += 1;
    byKind.set(v.kind, e);
  }
  const triageByKind = [...byKind.values()].sort((a, b) => b.seen - a.seen);
  // Two bars, not one. The run before this returned items that were on-topic and
  // weightless — a paper on an injection polymer, a trade piece on a pipe robot. Correct
  // subject, no gift. Relevance and weight are different questions and both have a floor.
  const worthSharing = verdicts.filter(
    (v) => v.shareworthy >= SHAREWORTHY_FLOOR && v.stature >= STATURE_FLOOR && !v.staleness
  );
  const relevantButLight = verdicts.filter(
    (v) => v.shareworthy >= SHAREWORTHY_FLOOR && v.stature < STATURE_FLOOR && !v.staleness
  ).length;
  // Judged on what CLEARED the filter, so the report says whether the run found gifts —
  // and when it did not, says that rather than being padded with the best of a weak pool.
  const acceptance = judgeAcceptance(
    worthSharing.map((v) => ({
      kind: v.kind,
      stature: v.stature,
      url: v.url,
      israelRelevant: v.israelRelevant,
    }))
  );
  if (!acceptance.met) console.warn(`[radar] acceptance org=${orgId} ${acceptance.shortfall}`);
  console.log(
    `[radar] triage org=${orgId} ${triageByKind.map((k) => `${k.kind}=${k.passed}/${k.seen}`).join(" ")}` +
      ` relevant_but_light=${relevantButLight} weighty=${acceptance.weighty}` +
      ` israel_relevant=${acceptance.israelRelevant} israeli_source=${acceptance.israeliSource}`
  );
  if (worthSharing.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: poolItems.length, triageByKind, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length, dropReasons: freshnessDrops,
    });
  }

  // ── 4. Write each surviving item up once ──────────────────────────────────
  const subscribersByUrl = new Map(capped.kept.map((i) => [i.url, i.companyIds]));
  let pageReadFailures = 0;
  const written: { itemId: string; axisIds: string[]; kind: string; title: string; summary: string; technology: string | null; sources: unknown }[] = [];
  for (const verdict of worthSharing.slice(0, MAX_SYNTHESIS_PER_RUN)) {
    const source = capped.kept.find((i) => i.url === verdict.url);
    if (!source) continue;
    try {
      // Read the actual article. Passing `pages: []` meant the model saw a title and a
      // snippet and filled the rest from what it already knew — that is how a Bloomberg
      // Law story about a court ordering OpenAI to hand over 20 million chat logs became
      // a summary of "ChatGPT is a large language model". A summary that does not
      // describe its source is worse than no summary.
      const page = await readPage(source.url);
      if (!page) pageReadFailures += 1;
      // Store where the read LANDED, not where the search pointed — a redirect wrapper
      // the ingest could not unwrap statically resolves here or never.
      const storedUrl = page?.finalUrl ? canonicalizeSourceUrl(page.finalUrl) : source.url;
      const draft = await synthesizeItem({
        triage: verdict,
        articles: [{ url: storedUrl, title: source.title, snippet: source.snippet, publishedAt: source.publishedAt }],
        pages: page ? [page] : [],
      });
      const itemId = await upsertTechItem(draft);
      written.push({
        itemId,
        axisIds: subscribersByUrl.get(verdict.url) ?? [],
        kind: verdict.kind,
        title: draft.title,
        summary: draft.summary,
        technology: draft.technology,
        sources: draft.sources,
      });
    } catch (err) {
      console.warn(`[radar] write-up failed for ${verdict.url}: ${(err as Error).message}`);
    }
  }
  if (written.length === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: poolItems.length, worthSharing: worthSharing.length,
      poolDropped: capped.dropped, relevantButLight, snippetOnly: pageReadFailures, acceptance, triageByKind, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length, dropReasons: freshnessDrops,
    });
  }

  // ── 5. Per-AXIS fit, judged once and shared by every subscriber ───────────
  // This stage only WRITES AxisMatch rows. Turning them into candidates, ranking, the
  // veto and the drafting all live in judgeAndDraft, which reads them back — so there is
  // one implementation of the judgement half rather than two that drift.
  const axisById = new Map(axes.map((a) => [a.id, a]));
  let axisFitsJudged = 0;
  let matchesAboveFloor = 0;

  for (const item of written) {
    for (const axisId of item.axisIds) {
      if (axisFitsJudged >= MAX_AXIS_FIT_PER_RUN) break;
      const axis = axisById.get(axisId);
      if (!axis) continue;

      const existing = await prisma.axisMatch.findUnique({
        where: { axisId_itemId: { axisId, itemId: item.itemId } },
        select: { score: true },
      });
      let score = existing?.score;
      if (score == null) {
        const fit = await judgeAxisFit({
          axisLabel: axis.label,
          axisQueries: axis.searchQueries,
          item: { title: item.title, summary: item.summary, technology: item.technology, kind: item.kind },
        });
        axisFitsJudged += 1;
        await prisma.axisMatch.create({
          data: { axisId, itemId: item.itemId, score: fit.score, rationale: fit.rationale },
        });
        score = fit.score;
      }
      if (score >= AXIS_FIT_FLOOR) matchesAboveFloor += 1;
    }
  }
  if (matchesAboveFloor === 0) {
    return finish({
      ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: poolItems.length, worthSharing: worthSharing.length,
      itemsWritten: written.length, axisFitsJudged, poolDropped: capped.dropped, relevantButLight, snippetOnly: pageReadFailures,
      acceptance, triageByKind, quotaExhausted: news.quotaLikely,
      staleDropped: stale.length, undatedDropped: undated.length, dropReasons: freshnessDrops,
    });
  }

  // ── 6-7. Rank, veto, draft — the ONE implementation, shared with radar.judge ──
  const judged = await judgeAndDraft(orgId);

  return finish({
    axes: axes.length,
    queriesRun: news.queriesRun,
    poolItems: poolItems.length,
    worthSharing: worthSharing.length,
    itemsWritten: written.length,
    axisFitsJudged,
    candidates: judged.candidates,
    vetoed: judged.vetoed,
    drafted: judged.drafted,
    poolDropped: capped.dropped,
    staleDropped: stale.length,
    undatedDropped: undated.length,
    relevantButLight,
    snippetOnly: pageReadFailures,
    acceptance,
    // Merged, not overwritten: freshness reasons are counted before triage, veto
    // reasons after — losing either half would misreport the funnel.
    dropReasons: { ...freshnessDrops, ...judged.dropReasons },
    triageByKind,
    quotaExhausted: news.quotaLikely,
  });
}
