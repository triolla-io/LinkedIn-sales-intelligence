/**
 * The judgement half of the radar: rank, veto, draft. No search, no triage.
 *
 * Split out so it can run on AxisMatch rows that already exist. Triage is ~80% of a
 * run's cost, so re-judging existing matches costs about $0.10 against ~$1 for a full
 * scan — and every tuning round from here changes the veto or the draft, not the search.
 * Paying for search again each time we adjust a prompt is the wrong shape.
 *
 * personScan calls this too, so there is ONE implementation of the veto and drafting
 * path rather than two that drift.
 */
import { prisma } from "@/lib/prisma";
import { AXIS_FIT_FLOOR } from "@/lib/tech-radar/axis-fit";
import { selectRecipientsForItem, type RecipientCandidate } from "@/lib/tech-radar/veto";
import { rankForPeople, pairKey, type RankCandidate } from "@/lib/tech-radar/person-rank";
import { draftTechMessage } from "@/lib/tech-radar/draft";
import { firstSourceUrl } from "@/lib/tech-radar/create-drafts";

const MAX_DRAFTS_PER_DAY = 10;
const MIN_DAYS_BETWEEN_MESSAGES = 7;

export type JudgeReport = {
  candidates: number;
  ranked: number;
  vetoed: number;
  drafted: number;
  dropReasons: Record<string, number>;
};

export async function judgeAndDraft(orgId: string): Promise<JudgeReport> {
  const empty: JudgeReport = { candidates: 0, ranked: 0, vetoed: 0, drafted: 0, dropReasons: {} };

  // Only axes somebody subscribes to. An axis with no subscriber has nobody to judge for.
  const axes = await prisma.radarAxis.findMany({
    where: { orgId, status: "ACTIVE", people: { some: {} } },
    select: {
      id: true,
      label: true,
      people: {
        select: {
          weight: true,
          rationale: true,
          personProfile: {
            select: {
              roleLens: true,
              personalNotes: true,
              employerTrackedCompanyId: true,
              contact: {
                select: {
                  id: true, ownerId: true, fullName: true, hebrewFirstName: true,
                  currentTitle: true, currentCompany: true,
                },
              },
            },
          },
        },
      },
      matches: {
        where: { score: { gte: AXIS_FIT_FLOOR } },
        select: {
          score: true,
          item: {
            select: { id: true, title: true, summary: true, technology: true, kind: true, sources: true },
          },
        },
        orderBy: { score: "desc" },
      },
    },
  });
  if (axes.length === 0) return empty;

  const candidates: RankCandidate[] = [];
  const itemById = new Map<string, (typeof axes)[number]["matches"][number]["item"]>();
  const axisById = new Map(axes.map((a) => [a.id, a]));

  for (const axis of axes) {
    for (const match of axis.matches) {
      itemById.set(match.item.id, match.item);
      for (const link of axis.people) {
        const contact = link.personProfile.contact;
        candidates.push({
          contactId: contact.id,
          itemId: match.item.id,
          axisId: axis.id,
          trackedCompanyId:
            link.personProfile.employerTrackedCompanyId ?? contact.currentCompany ?? contact.id,
          axisScore: match.score,
          personWeight: link.weight,
          kind: match.item.kind,
        });
      }
    }
  }
  if (candidates.length === 0) return empty;

  const contactIds = [...new Set(candidates.map((c) => c.contactId))];
  const prior = await prisma.radarDraft.findMany({
    where: { contactId: { in: contactIds } },
    select: { contactId: true, itemId: true, createdAt: true, status: true, item: { select: { kind: true } } },
    orderBy: { createdAt: "desc" },
  });

  // A VETOED row still means "this pair was decided" — re-judging it would spend an Opus
  // call to reach the same answer. @@unique([contactId, itemId]) would reject the write
  // anyway; this is the cheap check that avoids paying to find that out.
  const alreadySeen = new Set(prior.map((d) => pairKey(d.contactId, d.itemId)));
  const recentKinds = new Map<string, string[]>();
  const daysSince = new Map<string, number>();
  const now = Date.now();
  for (const d of prior) {
    if (d.status === "VETOED") continue; // never sent, so it is not a message they received
    const kinds = recentKinds.get(d.contactId) ?? [];
    if (kinds.length < 3) kinds.push(d.item.kind);
    recentKinds.set(d.contactId, kinds);
    if (!daysSince.has(d.contactId)) daysSince.set(d.contactId, (now - d.createdAt.getTime()) / 86_400_000);
  }

  const { ranked, dropped } = rankForPeople({
    candidates,
    alreadySeen,
    recentKinds,
    daysSinceLastMessage: daysSince,
    minDaysBetweenMessages: MIN_DAYS_BETWEEN_MESSAGES,
    limit: MAX_DRAFTS_PER_DAY,
  });

  const byItem = new Map<string, RankCandidate[]>();
  for (const c of ranked) {
    const list = byItem.get(c.itemId);
    if (list) list.push(c);
    else byItem.set(c.itemId, [c]);
  }

  let vetoed = 0;
  let drafted = 0;

  for (const [itemId, group] of byItem) {
    const item = itemById.get(itemId);
    if (!item) continue;

    const vetoCandidates: RecipientCandidate[] = group.map((c) => {
      const axis = axisById.get(c.axisId);
      const link = axis?.people.find((p) => p.personProfile.contact.id === c.contactId);
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

    const decisions = await selectRecipientsForItem({
      item: { technology: item.technology, title: item.title, summary: item.summary, kind: item.kind },
      candidates: vetoCandidates,
    });

    for (const { candidate, verdict, passed } of decisions) {
      const axis = axisById.get(candidate.axisId ?? "");
      const link = axis?.people.find((p) => p.personProfile.contact.id === candidate.contact.contactId);
      const contact = link?.personProfile.contact;
      const rank = group.find((c) => c.contactId === candidate.contact.contactId);
      if (!contact || !rank) continue;

      if (!passed) {
        vetoed += 1;
        // Recorded with its reason. A rejection nobody can read cannot be judged too
        // strict or too lenient, which is the one thing the pilot measures.
        await prisma.radarDraft.upsert({
          where: { contactId_itemId: { contactId: contact.id, itemId } },
          create: {
            contactId: contact.id, itemId, axisId: candidate.axisId, ownerId: contact.ownerId,
            whyHim: verdict.whyHim, status: "VETOED", discardReason: "not_person_specific",
          },
          update: {},
        });
        continue;
      }

      const message = await draftTechMessage({
        contactFullName: contact.fullName,
        hebrewFirstName: contact.hebrewFirstName,
        contactTitle: contact.currentTitle,
        companyName: contact.currentCompany ?? "",
        technology: item.technology ?? item.title,
        vendor: null,
        // The VETO's person-specific sentence, not the company's fit rationale. That one
        // argument is what made three founders receive byte-identical drafts in v1.
        fitRationale: verdict.whyHim,
        sourceUrl: firstSourceUrl(item.sources),
      });

      await prisma.radarDraft.upsert({
        where: { contactId_itemId: { contactId: contact.id, itemId } },
        create: {
          contactId: contact.id, itemId, axisId: candidate.axisId, ownerId: contact.ownerId,
          draftMessage: message, whyHim: verdict.whyHim,
          confidence: Math.max(0, Math.min(1, rank.axisScore * rank.personWeight + verdict.adjustment)),
          confidenceParts: { axisScore: rank.axisScore, personWeight: rank.personWeight, vetoAdjustment: verdict.adjustment },
        },
        update: {},
      });
      drafted += 1;
    }
  }

  const dropReasons: Record<string, number> = {};
  for (const d of dropped) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;

  return { candidates: candidates.length, ranked: ranked.length, vetoed, drafted, dropReasons };
}
