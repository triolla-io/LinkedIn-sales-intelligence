/**
 * Persist the person model: write a PersonProfile and attach its axes, applying the
 * merge gate before every insert.
 *
 * The gate runs here rather than in the proposing prompt because it needs the org's
 * existing axes, and because a pure function is the only version of it that can be
 * tested without a database. See lib/tech-radar/axis.ts for the three levels.
 */
import { prisma } from "@/lib/prisma";
import {
  judgeAxisMerge,
  judgeCeilings,
  normalizeAxisKey,
  companyMonitorKey,
  type AxisRow,
} from "@/lib/tech-radar/axis";
import type { AxisProposal } from "@/lib/tech-radar/person-profile";
import { resolveMergeQuestions } from "@/lib/tech-radar/axis-merge";
import { checkAxisLabel } from "@/lib/tech-radar/draft-guard";

/**
 * How related the nearest axis must be before a ceiling-hit proposal is folded into it.
 * Below this, the honest answer is "the ceiling stopped this", not a false neighbour.
 */
const CEILING_FALLBACK_FLOOR = 0.2;

export type AttachOutcome = {
  attached: number;
  created: number;
  merged: number;
  /** Proposals that hit a ceiling or normalised to nothing. Never silent. */
  skipped: { label: string; reason: string }[];
};

/**
 * Attach a person to axes, creating only what does not already exist.
 *
 * Three levels, cheapest first: an exact canonical key is free, overlap at or above
 * AUTO_MERGE_AT is free, and everything else goes to ONE batched model call.
 *
 * That call used to be skipped — `ask` was treated as `create`, on the reasoning that
 * with a handful of people the band would be nearly empty. The first live build proved
 * that wrong in the most direct way available: 6 people produced 33 axes with one
 * subscriber each, including three separate axes for one subject at one company. The
 * band is not the rare case; it is where near-duplicates live.
 */
export async function attachAxes(input: {
  orgId: string;
  personProfileId: string;
  proposals: AxisProposal[];
}): Promise<AttachOutcome> {
  const out: AttachOutcome = { attached: 0, created: 0, merged: 0, skipped: [] };

  const existingRows = await prisma.radarAxis.findMany({
    where: { orgId: input.orgId, status: "ACTIVE" },
    select: { id: true, key: true, label: true },
  });
  const existing: AxisRow[] = existingRows;
  let orgAxisCount = existingRows.length;

  const held = await prisma.personAxis.count({ where: { personProfileId: input.personProfileId } });
  let personAxisCount = held;

  // Level 3, batched: everything the free levels did not settle is asked in one call.
  // Asking per proposal would be N calls per person; asking once is one.
  // Agenda FIRST. The "exactly one agenda axis" guarantee is enforced when the proposals
  // are parsed, which is before this gate runs — so on 2026-08-23 three of six people
  // lost their agenda axis to a ceiling or a rejection and were left with role axes only,
  // which is the exact thing the agenda axis exists to prevent. Processing it first means
  // it is never the proposal that gets squeezed out.
  const ordered = [...input.proposals].sort((a, b) => Number(b.agenda) - Number(a.agenda));
  const verdicts = ordered.map((p) => ({ proposal: p, verdict: judgeAxisMerge(p.label, existing) }));
  const questions = verdicts.filter((v) => v.verdict.decision === "ask" || v.verdict.decision === "create");
  const answers =
    questions.length > 0
      ? await resolveMergeQuestions(
          existing.map((e) => ({ id: e.id, label: e.label })),
          questions.map((q) => ({ label: q.proposal.label }))
        )
      : new Map<number, string | null>();
  const askedIndex = new Map(questions.map((q, n) => [q.proposal.label, n]));

  for (const { proposal, verdict } of verdicts) {
    if (verdict.decision === "reject") {
      out.skipped.push({ label: proposal.label, reason: "empty_key" });
      continue;
    }

    // A label is copy on the people and decisions screens. Checked BEFORE the merge
    // branch too: merging a malformed proposal into a good axis is fine, but letting one
    // through to `create` puts the model's typography in front of the user.
    const labelViolations = checkAxisLabel(proposal.label);
    if (labelViolations.length > 0 && verdict.decision !== "merge") {
      out.skipped.push({ label: proposal.label, reason: `bad_label:${labelViolations.join(",")}` });
      continue;
    }

    let axisId: string;
    if (verdict.decision === "merge") {
      axisId = verdict.axisId;
      out.merged += 1;
    } else {
      const answeredId = answers.get(askedIndex.get(proposal.label) ?? -1) ?? null;
      if (answeredId) {
        // The model recognised it as an existing subject worded differently.
        axisId = answeredId;
        out.merged += 1;
        const link0 = await prisma.personAxis.upsert({
          where: { personProfileId_axisId: { personProfileId: input.personProfileId, axisId } },
          create: { personProfileId: input.personProfileId, axisId, rationale: proposal.rationale, source: "ROLE_COMPANY" },
          update: { rationale: proposal.rationale },
          select: { id: true },
        });
        if (link0) {
          personAxisCount += 1;
          out.attached += 1;
        }
        continue;
      }

      const ceiling = judgeCeilings({ orgAxisCount, personAxisCount });
      if (!ceiling.allowed) {
        // At a ceiling the person attaches to the NEAREST existing axis rather than
        // being dropped — but only if it is actually near. Since ASK_ABOVE is 0, the
        // "nearest" axis can have zero overlap, and filing a renewable-energy interest
        // under core banking is worse than recording that the ceiling was hit.
        if (verdict.decision === "ask" && verdict.similarity >= CEILING_FALLBACK_FLOOR) {
          axisId = verdict.axisId;
          out.merged += 1;
        } else {
          out.skipped.push({ label: proposal.label, reason: ceiling.reason });
          continue;
        }
      } else {
        const key = normalizeAxisKey(proposal.label);
        const created = await prisma.radarAxis.create({
          data: {
            orgId: input.orgId,
            key,
            label: proposal.label,
            kind: "ROLE_COMPANY",
            searchQueries: proposal.searchQueries,
          },
          select: { id: true, key: true, label: true },
        });
        axisId = created.id;
        existing.push(created);
        orgAxisCount += 1;
        out.created += 1;
      }
    }

    // Idempotent: re-running a profile build must not double-attach or overwrite a
    // weight the learning loop has already moved.
    const link = await prisma.personAxis.upsert({
      where: { personProfileId_axisId: { personProfileId: input.personProfileId, axisId } },
      create: {
        personProfileId: input.personProfileId,
        axisId,
        rationale: proposal.rationale,
        agenda: proposal.agenda,
        source: "ROLE_COMPANY",
      },
      update: { rationale: proposal.rationale, agenda: proposal.agenda },
      select: { id: true, createdAt: true },
    });
    if (link) {
      personAxisCount += 1;
      out.attached += 1;
    }
  }

  // Last resort: if the agenda proposal was dropped anyway, promote a surviving link.
  // A person with only role axes gives the veto nothing a same-title peer would not also
  // have — and the veto rejected exactly that on 2026-08-23.
  const links = await prisma.personAxis.findMany({
    where: { personProfileId: input.personProfileId },
    select: { id: true, agenda: true },
    orderBy: { createdAt: "asc" },
  });
  if (links.length > 0 && !links.some((l) => l.agenda)) {
    await prisma.personAxis.update({ where: { id: links[0].id }, data: { agenda: true } });
    out.skipped.push({ label: "(agenda)", reason: "agenda_proposal_dropped_promoted_first_link" });
  }

  // Denormalised for the width guard, recomputed rather than incremented so a retry
  // cannot inflate it.
  const touched = await prisma.personAxis.groupBy({
    by: ["axisId"],
    where: { axisId: { in: existing.map((e) => e.id) } },
    _count: { axisId: true },
  });
  for (const row of touched) {
    await prisma.radarAxis.update({
      where: { id: row.axisId },
      data: { subscriberCount: row._count.axisId },
    });
  }

  return out;
}

/**
 * One COMPANY_MONITOR axis per employer that has at least one person. Never shared,
 * never merged, own budget lane — so a verified move by the recipient's own company
 * cannot be crowded out by a strong shared axis.
 */
export async function ensureCompanyMonitorAxis(input: {
  orgId: string;
  trackedCompanyId: string;
  companyName: string;
}): Promise<string> {
  const key = companyMonitorKey(input.trackedCompanyId);
  const axis = await prisma.radarAxis.upsert({
    where: { orgId_key: { orgId: input.orgId, key } },
    create: {
      orgId: input.orgId,
      key,
      label: `מהלכים של ${input.companyName}`,
      kind: "COMPANY_MONITOR",
      trackedCompanyId: input.trackedCompanyId,
      searchQueries: [input.companyName],
    },
    update: {},
    select: { id: true },
  });
  return axis.id;
}
