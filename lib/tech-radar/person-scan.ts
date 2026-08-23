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
import { upsertTechItem } from "@/lib/tech-radar/persist";
import { buildAxisQueryPool, judgeAxisFit, capPoolByAxis, AXIS_FIT_FLOOR } from "@/lib/tech-radar/axis-fit";
import { selectRecipientsForItem, type RecipientCandidate } from "@/lib/tech-radar/veto";
import { rankForPeople, pairKey, type RankCandidate } from "@/lib/tech-radar/person-rank";
import { draftTechMessage } from "@/lib/tech-radar/draft";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";
import { SHAREWORTHY_FLOOR } from "@/lib/tech-radar/types";

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
const MIN_DAYS_BETWEEN_MESSAGES = 7;

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
  /** Why candidates were dropped, counted by reason. Never a bare number. */
  dropReasons: Record<string, number>;
  triageByKind: { kind: string; seen: number; passed: number }[];
  quotaExhausted: boolean;
};

const EMPTY: PersonScanReport = {
  axes: 0, queriesRun: 0, poolItems: 0, worthSharing: 0, itemsWritten: 0,
  axisFitsJudged: 0, candidates: 0, vetoed: 0, drafted: 0, poolDropped: 0,
  dropReasons: {}, triageByKind: [], quotaExhausted: false,
};

function countBy(reasons: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

export async function personScan(orgId: string): Promise<PersonScanReport> {
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
  if (axes.length === 0) return EMPTY;

  // ── 2. Queries from axes, not from company profiles ───────────────────────
  const pool = buildAxisQueryPool(
    axes.map((a) => ({ id: a.id, searchQueries: a.searchQueries })),
    normalizeQuery,
    MAX_QUERIES_PER_AXIS
  );
  const news = await fetchPoolNews(pool.map((p) => ({ query: p.query, companyIds: p.axisIds })));
  if (news.items.length === 0) {
    return { ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, quotaExhausted: news.quotaLikely };
  }

  // ── 3. Shareworthiness triage, once per item, company- and person-agnostic ─
  // Capped before triage, round-robin across axes, so the cut never starves one
  // interest and the bill stays predictable.
  const capped = capPoolByAxis(news.items, MAX_POOL_ITEMS);
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
    if (v.shareworthy >= SHAREWORTHY_FLOOR && !v.staleness) e.passed += 1;
    byKind.set(v.kind, e);
  }
  const triageByKind = [...byKind.values()].sort((a, b) => b.seen - a.seen);
  const worthSharing = verdicts.filter((v) => v.shareworthy >= SHAREWORTHY_FLOOR && !v.staleness);
  console.log(
    `[radar] triage org=${orgId} ${triageByKind.map((k) => `${k.kind}=${k.passed}/${k.seen}`).join(" ")}`
  );
  if (worthSharing.length === 0) {
    return { ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: poolItems.length, triageByKind, quotaExhausted: news.quotaLikely };
  }

  // ── 4. Write each surviving item up once ──────────────────────────────────
  const subscribersByUrl = new Map(capped.kept.map((i) => [i.url, i.companyIds]));
  const written: { itemId: string; axisIds: string[]; kind: string; title: string; summary: string; technology: string | null; sources: unknown }[] = [];
  for (const verdict of worthSharing.slice(0, MAX_SYNTHESIS_PER_RUN)) {
    const source = capped.kept.find((i) => i.url === verdict.url);
    if (!source) continue;
    try {
      const draft = await synthesizeItem({
        triage: verdict,
        articles: [{ url: source.url, title: source.title, snippet: source.snippet, publishedAt: source.publishedAt }],
        pages: [],
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
    return { ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: poolItems.length, worthSharing: worthSharing.length, poolDropped: capped.dropped, triageByKind, quotaExhausted: news.quotaLikely };
  }

  // ── 5. Per-AXIS fit, judged once and shared by every subscriber ───────────
  const axisById = new Map(axes.map((a) => [a.id, a]));
  const candidates: RankCandidate[] = [];
  const itemById = new Map(written.map((w) => [w.itemId, w]));
  let axisFitsJudged = 0;

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
      if (score < AXIS_FIT_FLOOR) continue;

      // One shared judgement fans out to every subscriber of the axis.
      for (const link of axis.people) {
        const contact = link.personProfile.contact;
        candidates.push({
          contactId: contact.id,
          itemId: item.itemId,
          axisId,
          trackedCompanyId: link.personProfile.employerTrackedCompanyId ?? contact.currentCompany ?? contact.id,
          axisScore: score,
          personWeight: link.weight,
          kind: item.kind,
        });
      }
    }
  }
  if (candidates.length === 0) {
    return { ...EMPTY, axes: axes.length, queriesRun: news.queriesRun, poolItems: poolItems.length, worthSharing: worthSharing.length, itemsWritten: written.length, axisFitsJudged, poolDropped: capped.dropped, triageByKind, quotaExhausted: news.quotaLikely };
  }

  // ── 6. Deterministic per-person rank ─────────────────────────────────────
  const contactIds = [...new Set(candidates.map((c) => c.contactId))];
  const priorDrafts = await prisma.radarDraft.findMany({
    where: { contactId: { in: contactIds } },
    select: { contactId: true, itemId: true, createdAt: true, item: { select: { kind: true } } },
    orderBy: { createdAt: "desc" },
  });
  const alreadySeen = new Set(priorDrafts.map((d) => pairKey(d.contactId, d.itemId)));
  const recentKinds = new Map<string, string[]>();
  const daysSinceLastMessage = new Map<string, number>();
  const now = Date.now();
  for (const d of priorDrafts) {
    const kinds = recentKinds.get(d.contactId) ?? [];
    if (kinds.length < 3) kinds.push(d.item.kind);
    recentKinds.set(d.contactId, kinds);
    if (!daysSinceLastMessage.has(d.contactId)) {
      daysSinceLastMessage.set(d.contactId, (now - d.createdAt.getTime()) / 86_400_000);
    }
  }

  const { ranked, dropped } = rankForPeople({
    candidates,
    alreadySeen,
    recentKinds,
    daysSinceLastMessage,
    minDaysBetweenMessages: MIN_DAYS_BETWEEN_MESSAGES,
    limit: MAX_DRAFTS_PER_DAY,
  });

  // ── 7. The veto, then one draft ──────────────────────────────────────────
  let drafted = 0;
  let vetoed = 0;
  const byItem = new Map<string, RankCandidate[]>();
  for (const c of ranked) {
    const list = byItem.get(c.itemId);
    if (list) list.push(c);
    else byItem.set(c.itemId, [c]);
  }

  for (const [itemId, group] of byItem) {
    const item = itemById.get(itemId);
    if (!item) continue;

    const vetoCandidates: RecipientCandidate[] = group.map((c) => {
      const axis = axisById.get(c.axisId);
      const link = axis?.people.find((p) => p.personProfile.contactId === c.contactId);
      const contact = link?.personProfile.contact;
      return {
        contact: {
          contactId: c.contactId,
          fullName: contact?.fullName ?? "",
          currentTitle: contact?.currentTitle ?? null,
          roleLens: link?.personProfile.roleLens ?? null,
          personalNotes: link?.personProfile.personalNotes ?? null,
        },
        company: { trackedCompanyId: c.trackedCompanyId, name: contact?.currentCompany ?? "" },
        axisRationale: link?.rationale ?? "",
        axisLabel: axis?.label,
        axisId: c.axisId,
      };
    });

    const chosen = await selectRecipientsForItem({
      item: { technology: item.technology, title: item.title, summary: item.summary, kind: item.kind },
      candidates: vetoCandidates,
    });
    vetoed += vetoCandidates.length - chosen.length;

    for (const { candidate, verdict } of chosen) {
      const rank = group.find((c) => c.contactId === candidate.contact.contactId);
      const axis = axisById.get(candidate.axisId ?? "");
      const link = axis?.people.find((p) => p.personProfile.contactId === candidate.contact.contactId);
      const contact = link?.personProfile.contact;
      if (!contact || !rank) continue;

      const message = await draftTechMessage({
        contactFullName: contact.fullName,
        hebrewFirstName: contact.hebrewFirstName,
        contactTitle: contact.currentTitle,
        companyName: contact.currentCompany ?? "",
        technology: item.technology ?? item.title,
        vendor: null,
        // The PERSON's reason, from the veto — not the company's fit rationale. This is
        // the line that made three founders receive byte-identical drafts in v1.
        fitRationale: verdict.whyHim,
        sourceUrl: firstSourceUrl(item.sources),
      });

      await prisma.radarDraft.create({
        data: {
          contactId: contact.id,
          itemId,
          axisId: candidate.axisId,
          ownerId: contact.ownerId,
          draftMessage: message,
          whyHim: verdict.whyHim,
          confidence: Math.max(0, Math.min(1, rank.axisScore * rank.personWeight + verdict.adjustment)),
          confidenceParts: { axisScore: rank.axisScore, personWeight: rank.personWeight, vetoAdjustment: verdict.adjustment },
        },
      });
      drafted += 1;
    }
  }

  return {
    axes: axes.length,
    queriesRun: news.queriesRun,
    poolItems: poolItems.length,
    worthSharing: worthSharing.length,
    itemsWritten: written.length,
    axisFitsJudged,
    candidates: candidates.length,
    vetoed,
    drafted,
    poolDropped: capped.dropped,
    dropReasons: countBy(dropped.map((d) => d.reason)),
    triageByKind,
    quotaExhausted: news.quotaLikely,
  };
}
