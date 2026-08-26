/**
 * Persist the person model: write a PersonProfile and attach its axes, applying the
 * merge gate before every insert.
 *
 * The gate runs here rather than in the proposing prompt because it needs the org's
 * existing axes, and because a pure function is the only version of it that can be
 * tested without a database. See lib/tech-radar/axis.ts for the three levels.
 *
 * Since 2026-08-26 there is a FOURTH condition on every merge, and it is about the
 * employer rather than the label: an axis may only be shared by people whose companies
 * compete for the same customers. This file does the database half — which employer each
 * existing axis's subscribers work at — and judgeCompetitiveSetMerge() decides.
 */
import { prisma } from "@/lib/prisma";
import {
  judgeAxisMerge,
  judgeCeilings,
  judgeCompetitiveSetMerge,
  normalizeAxisKey,
  companyMonitorKey,
  industryKey,
  type AxisRow,
  type CompetitiveSet,
} from "@/lib/tech-radar/axis";
import { MAX_INDUSTRY_QUERIES } from "@/lib/tech-radar/types";
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
  /** Merges the competitive-set gate refused. Counted separately from `skipped`,
   *  because the person still got an axis — just their OWN one. */
  refused: number;
  /** Proposals that hit a ceiling or normalised to nothing. Never silent. */
  skipped: { label: string; reason: string }[];
  /**
   * Each refused merge, naming both halves: the label that was proposed and the axis
   * (plus the employer) it would have been folded into. A bare count could not have
   * shown that Elinor's bank axis was folded into Phoenix's insurance one — which is the
   * whole reason this exists.
   */
  mergeRefused: { label: string; reason: string }[];
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
  /**
   * The person's employer. REQUIRED: label similarity decided merges without it until
   * 2026-08-26, and the merge it made cannot be spotted by looking at the labels.
   */
  employer: CompetitiveSet;
}): Promise<AttachOutcome> {
  const out: AttachOutcome = { attached: 0, created: 0, merged: 0, refused: 0, skipped: [], mergeRefused: [] };

  const existingRows = await prisma.radarAxis.findMany({
    where: { orgId: input.orgId, status: "ACTIVE" },
    select: {
      id: true,
      key: true,
      label: true,
      kind: true,
      // An axis belongs to the competitive set of whoever already subscribes to it.
      people: { select: { personProfile: { select: { employerTrackedCompanyId: true } } } },
    },
  });
  const existing: AxisRow[] = existingRows.map((r) => ({ id: r.id, key: r.key, label: r.label }));
  const rowKind = new Map(existingRows.map((r) => [r.id, r.kind]));
  // An industry axis is a shared net, not a subject — it must not spend the org's
  // subject budget. Without this, a growing industry net would eventually crowd out
  // the org's own ROLE_COMPANY axes at MAX_AXES_PER_ORG. COMPANY_MONITOR axes are
  // deliberately NOT exempted: they still count, one per tracked company, pre-existing
  // behaviour that is out of scope here.
  let orgAxisCount = existingRows.filter((r) => r.kind !== "INDUSTRY").length;

  // ── The competitive-set gate, database half ────────────────────────────────
  const subscriberEmployerIds = [
    ...new Set(
      existingRows.flatMap((r) =>
        (r.people ?? [])
          .map((p) => p.personProfile?.employerTrackedCompanyId)
          .filter((id): id is string => !!id)
      )
    ),
  ];
  const employerRows =
    subscriberEmployerIds.length > 0
      ? await prisma.trackedCompany.findMany({
          where: { id: { in: subscriberEmployerIds } },
          select: { id: true, name: true, aliases: true, profile: true },
        })
      : [];
  const employerById = new Map<string, CompetitiveSet>(
    employerRows.map((r) => [
      r.id,
      {
        employerId: r.id,
        names: [r.name, ...(r.aliases ?? [])],
        namedCompetitors: (r.profile as { namedCompetitors?: string[] } | null)?.namedCompetitors ?? [],
      },
    ])
  );
  // The caller's copy of THIS person's employer wins: a rebuild re-researches the
  // employer first, and the row read back here can be the pre-refresh one.
  employerById.set(input.employer.employerId, input.employer);

  /** axisId -> the employer whose competitive set this person's does not share. */
  const blocked = new Map<string, string>();
  for (const row of existingRows) {
    const owners = (row.people ?? [])
      .map((p) => p.personProfile?.employerTrackedCompanyId)
      .filter((id): id is string => !!id)
      .map((id) => employerById.get(id))
      .filter((o): o is CompetitiveSet => !!o);
    const verdict = judgeCompetitiveSetMerge(input.employer, owners);
    if (!verdict.allowed) blocked.set(row.id, verdict.blockedBy);
  }
  /**
   * A COMPANY_MONITOR axis is not a merge target at all — its single query is the
   * employer's name, so folding a role axis into it would hand that person their own
   * company's press instead of their subject. Same failure as the insurance labels, by a
   * different road: the axis row owns the queries either way. Its structural key
   * ("company:<id>") cannot be hit by a label, but its LABEL can score 1.0 against
   * "מהלכים של הפניקס", so it has to be kept out of the candidate list by kind.
   *
   * INDUSTRY is excluded for the same reason: it is a shared net, not a subject, so a
   * ROLE_COMPANY proposal can never merge into it either. An allowlist on ROLE_COMPANY
   * rather than a growing denylist, so a future third kind is excluded by default
   * instead of by remembering to add it here — the two non-mergeable kinds are nets,
   * not subjects.
   */
  const catalog = existing.filter((row) => rowKind.get(row.id) === "ROLE_COMPANY");
  const mergeable = catalog.filter((row) => !blocked.has(row.id));
  const mergeableIds = new Set(mergeable.map((row) => row.id));

  /** One refusal per proposal, naming the axis and what stopped the merge. */
  const refused = new Set<string>();
  const refuse = (label: string, axisId: string) => {
    if (refused.has(label)) return;
    refused.add(label);
    out.refused += 1;
    const target = existing.find((e) => e.id === axisId);
    const kind = rowKind.get(axisId);
    const why =
      blocked.get(axisId) ??
      (kind === "COMPANY_MONITOR" ? "company_monitor" : kind === "INDUSTRY" ? "industry_net" : "not an active axis");
    out.mergeRefused.push({ label, reason: `merge_refused[${target?.label ?? axisId} · ${why}]` });
  };

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
  // Judged TWICE on purpose. `ungated` is what label similarity alone wants — kept so a
  // refusal can be reported instead of quietly not happening. `verdict` is the operative
  // one, and it only ever sees axes this person's employer may actually share.
  //
  // Level 1 is exempt from the gate: RadarAxis is unique on [orgId, key], so for a label
  // whose canonical key already exists there is no "create" to fall back to. It is also
  // not the road the failure travelled — another company's competitor names arrive on a
  // DIFFERENT label ("תחרות דיגיטלית מול הראל ומגדל" against a proposal naming הפועלים).
  const verdicts = ordered.map((p) => {
    const ungated = judgeAxisMerge(p.label, catalog);
    const verdict =
      ungated.decision === "merge" && ungated.via === "exact_key"
        ? ungated
        : judgeAxisMerge(p.label, mergeable);
    return { proposal: p, verdict, ungated };
  });
  const questions = verdicts.filter((v) => v.verdict.decision === "ask" || v.verdict.decision === "create");
  const answers =
    questions.length > 0
      ? await resolveMergeQuestions(
          catalog.map((e) => ({ id: e.id, label: e.label })),
          questions.map((q) => ({ label: q.proposal.label }))
        )
      : new Map<number, string | null>();
  const askedIndex = new Map(questions.map((q, n) => [q.proposal.label, n]));

  for (const { proposal, verdict, ungated } of verdicts) {
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

    // The free levels wanted a merge across a competitive-set line. Recorded before any
    // decision, so the report shows what the gate stopped rather than only what it did.
    if (ungated.decision === "merge" && ungated.via === "similarity" && blocked.has(ungated.axisId)) {
      refuse(proposal.label, ungated.axisId);
    }

    let axisId: string;
    if (verdict.decision === "merge") {
      axisId = verdict.axisId;
      out.merged += 1;
    } else {
      const answeredId = answers.get(askedIndex.get(proposal.label) ?? -1) ?? null;
      // The model is shown the WHOLE catalog, and its answer is gated here rather than
      // its candidates being filtered first — that is what makes a refused merge visible
      // instead of merely absent. Creating instead is the safe direction (see
      // axis-merge.ts): a near-duplicate axis wastes a little search budget, and two
      // axes carrying the same query string are fetched once by the pool anyway.
      if (answeredId && !mergeableIds.has(answeredId)) {
        refuse(proposal.label, answeredId);
      } else if (answeredId) {
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

/**
 * Layer 1: the shared industry net. One RadarAxis per (org × industry canonical), NOT per
 * person or per employer — this is what lets N employers in the same industry pay for one
 * set of queries instead of N. Mirrors ensureCompanyMonitorAxis's structural-key upsert,
 * but this one ALSO writes the PersonAxis link: a company monitor has no per-person
 * subscriber to attach (it belongs to the employer), an industry net has exactly that —
 * every marked person at every employer in the industry subscribes to the same row.
 *
 * Deliberately sits OUTSIDE attachAxes: it bypasses MAX_AXES_PER_PERSON by design (a
 * broad net, not one of the person's own five subjects), and it never passes through
 * gateRationales — an INDUSTRY proposal carries no personDecision and would die on
 * no_person_side if it ever reached that gate.
 */
export async function ensureIndustryAxis(input: {
  orgId: string;
  personProfileId: string;
  industry: { canonical: string; queries: string[] };
}): Promise<"created" | "attached" | "skipped"> {
  const canonical = (input.industry.canonical ?? "").trim();
  if (!canonical) return "skipped";

  const key = industryKey(canonical);
  const queries = (input.industry.queries ?? [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .slice(0, MAX_INDUSTRY_QUERIES);

  // findUnique-then-create, not upsert: the return value has to say whether THIS call
  // created the shared axis or merely joined it, and an upsert's result looks identical
  // either way.
  const found = await prisma.radarAxis.findUnique({
    where: { orgId_key: { orgId: input.orgId, key } },
    select: { id: true },
  });
  let axisId: string;
  let outcome: "created" | "attached";
  if (found) {
    axisId = found.id;
    outcome = "attached";
  } else {
    const created = await prisma.radarAxis.create({
      data: {
        orgId: input.orgId,
        key,
        label: `ענף: ${canonical}`,
        kind: "INDUSTRY",
        searchQueries: queries,
      },
      select: { id: true },
    });
    axisId = created.id;
    outcome = "created";
  }

  // Idempotent: re-running a profile build must not double-subscribe or overwrite a
  // weight the learning loop has already moved — same rule as attachAxes's link upsert.
  await prisma.personAxis.upsert({
    where: { personProfileId_axisId: { personProfileId: input.personProfileId, axisId } },
    create: {
      personProfileId: input.personProfileId,
      axisId,
      rationale: `שאילתות ענף משותפות — ${canonical}`,
      agenda: false,
      weight: 0.5,
      source: "INDUSTRY",
    },
    update: {},
    select: { id: true },
  });

  return outcome;
}
