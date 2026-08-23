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
 * `ask`-band proposals are treated as CREATE in the pilot rather than paying for an LLM
 * call: the spec puts the disambiguation call in this band, but with a handful of people
 * the band is nearly empty and a wrong auto-merge is worse than a near-duplicate axis —
 * a merged axis cannot be un-merged without losing the rationale it was merged under.
 * Revisit when the catalog is large enough for the band to matter.
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

  for (const proposal of input.proposals) {
    const verdict = judgeAxisMerge(proposal.label, existing);
    if (verdict.decision === "reject") {
      out.skipped.push({ label: proposal.label, reason: "empty_key" });
      continue;
    }

    let axisId: string;
    if (verdict.decision === "merge") {
      axisId = verdict.axisId;
      out.merged += 1;
    } else {
      // `ask` and `create` both create in the pilot — see the note above.
      const ceiling = judgeCeilings({ orgAxisCount, personAxisCount });
      if (!ceiling.allowed) {
        // At a ceiling the person attaches to the nearest existing axis rather than
        // being dropped. Only a proposal with nothing near it is skipped.
        if (verdict.decision === "ask") {
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
        source: "ROLE_COMPANY",
      },
      update: { rationale: proposal.rationale },
      select: { id: true, createdAt: true },
    });
    if (link) {
      personAxisCount += 1;
      out.attached += 1;
    }
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
