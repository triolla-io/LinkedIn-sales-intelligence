/**
 * Build the person model for the people someone marked.
 *
 * This is the step that has to exist before a person-outward scan can find anything: no
 * PersonProfile means no PersonAxis, which means no axis has a subscriber, which means
 * the pool is empty and the run reports "no news" for a reason that has nothing to do
 * with news.
 */
import { prisma } from "@/lib/prisma";
import { buildPersonProfile, type AxisProposal } from "@/lib/tech-radar/person-profile";
import { gateRationales } from "@/lib/tech-radar/rationale-gate";
import { attachAxes, ensureCompanyMonitorAxis } from "@/lib/tech-radar/axis-store";
import { countHebrewQueries } from "@/lib/tech-radar/axis";
import { poolQueryCount } from "@/lib/tech-radar/person-scan";
import { prisma as db } from "@/lib/prisma";
import { isUsableProfile } from "@/lib/tech-radar/types";
import { markSuperseded } from "@/lib/tech-radar/superseded";
import {
  thinProfiles, stageDistribution, sameDecisionCollisions,
  type ThinProfile, type DecisionCollision,
} from "@/lib/tech-radar/profile-quality";

/** Rebuilt only when older than this — a role does not change weekly. */
const STALE_AFTER_DAYS = 90;

export type BuildProfilesReport = {
  considered: number;
  built: number;
  refreshed: number;
  axesCreated: number;
  axesMerged: number;
  /**
   * Merges the competitive-set gate refused. NOT a loss — the person got their own axis
   * instead of inheriting one whose customers are not theirs. Each refusal is named in
   * `skipped`, with the axis it would have joined and the employer that blocked it.
   */
  axesRefused: number;
  /**
   * What the NEXT scan will ask the providers for, after this rebuild. Refusing a merge
   * raises the axis count; it only raises the BILL if it raises this. The 2026-08-26 run
   * used 34 unique queries — that is the number to compare against.
   */
  pool: { axes: number; uniqueQueries: number };
  /**
   * Anyone the gate left under MIN_AXES_PER_PERSON. Elinor Levinson Gafni came back from
   * the 2026-08-26 rebuild with two axes, one of which was not even hers, and the run
   * finished quietly — a thin profile has to declare itself thin.
   */
  thin: ThinProfile[];
  /**
   * Axes per staged question. `adopt: 0` across the cohort is the signal that stage (ד)
   * did not land; it produced nothing for all four people and nothing counted it.
   */
  stages: Record<string, number>;
  /**
   * Two executives at the SAME employer handed the same decision — the
   * union-instead-of-intersection failure in its purest form.
   */
  sameDecision: DecisionCollision[];
  /** Hebrew search queries per person, from the DATABASE. Zero for anyone is a defect. */
  hebrewQueriesByPerson: { name: string; hebrew: number; agenda: number }[];
  /** People with no Hebrew query at all. Must be empty. */
  noHebrewQuery: string[];
  /** Every person who did NOT get a profile, and why. Never a silent shortfall. */
  skipped: { contactId: string; name: string; reason: string }[];
  /** Stale judgements marked (never deleted) because their axis was retired. */
  superseded: { matches: number; drafts: number };
  /**
   * Axes killed by each DETERMINISTIC rule. `title_pattern` is the compliance meter for
   * the prompt's prohibition on opening a rationale with the job title: a number that
   * stays high means the prompt is not landing.
   */
  rejectedByRule: Record<string, number>;
};

export async function buildProfilesForMarked(input: {
  orgId: string;
  ownerId: string;
  /** Restrict to these contacts. Omitted = the whole marked cohort; empty = nobody. */
  contactIds?: string[];
  /**
   * Rebuild even a fresh profile, and DETACH the person's existing un-muted axes first.
   * This is how a brain upgrade reaches people already modelled: without the detach,
   * Elinor keeps her stale core-systems subscription no matter how good the new axes
   * are. Muted links survive — the mute is learned feedback, and the learning stays.
   */
  force?: boolean;
}): Promise<BuildProfilesReport> {
  const report: BuildProfilesReport = {
    considered: 0, built: 0, refreshed: 0, axesCreated: 0, axesMerged: 0, axesRefused: 0,
    pool: { axes: 0, uniqueQueries: 0 }, thin: [], stages: {}, sameDecision: [],
    hebrewQueriesByPerson: [], noHebrewQuery: [], skipped: [], rejectedByRule: {},
    superseded: { matches: 0, drafts: 0 },
  };

  const contacts = await prisma.contact.findMany({
    where: {
      ownerId: input.ownerId,
      removedAt: null,
      radarInclude: true,
      ...(input.contactIds === undefined ? {} : { id: { in: input.contactIds } }),
    },
    select: {
      id: true, fullName: true, currentTitle: true, headline: true, currentCompany: true, companyId: true,
      about: true, experience: true, profileScrapedAt: true,
      personProfile: { select: { id: true, refreshedAt: true } },
    },
  });
  report.considered = contacts.length;
  if (contacts.length === 0) return report;

  const employers = await prisma.trackedCompany.findMany({
    where: { orgId: input.orgId },
    select: { id: true, name: true, aliases: true, companyId: true, profile: true, status: true },
  });

  const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);

  /** Contacts whose model this run actually replaced — the only ones whose old
   *  judgements are stale. Someone skipped or unchanged must not have history rewritten. */
  const rebuilt: string[] = [];
  // Collected per person so the four quality numbers are computed over the cohort rather
  // than per call — a collision is only visible across two people.
  const kept: { name: string; employerId: string; axes: AxisProposal[] }[] = [];

  for (const contact of contacts) {
    const name = contact.fullName ?? contact.id;

    if (!input.force && contact.personProfile && contact.personProfile.refreshedAt > staleBefore) {
      // Already modelled and still current. Its axes are already attached.
      continue;
    }

    const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
    const employer = employers.find(
      (e) =>
        (contact.companyId != null && e.companyId === contact.companyId) ||
        norm(e.name) === norm(contact.currentCompany) ||
        e.aliases.some((a) => norm(a) === norm(contact.currentCompany))
    );

    // The employer profile is context for "what does this person own?". Without it the
    // model has only a job title, and a title alone produces axes indistinguishable
    // from every other holder of that title — which is the company-level failure again,
    // one level up. Better to say so than to build a profile that cannot be vetoed.
    if (!employer) {
      report.skipped.push({ contactId: contact.id, name, reason: "no_tracked_employer" });
      continue;
    }
    if (!isUsableProfile(employer.profile)) {
      report.skipped.push({
        contactId: contact.id,
        name,
        reason: employer.status === "RESEARCH_FAILED" ? "employer_research_failed" : "employer_not_researched",
      });
      continue;
    }

    // No title, no headline, no about paragraph: SCRAPE_PROFILE never landed (or landed
    // on an old extension build) and there is nothing for the model to read a role out
    // of. Modelling anyway produces a profile indistinguishable from a blank contact —
    // skip and say so, rather than pay for an LLM call that models nobody in particular.
    if (!contact.currentTitle && !contact.headline && !contact.about) {
      report.skipped.push({ contactId: contact.id, name, reason: "person_data_missing" });
      continue;
    }

    const draft = await buildPersonProfile({
      fullName: name,
      currentTitle: contact.currentTitle,
      headline: contact.headline,
      companyName: employer.name,
      employerProfile: employer.profile,
      // Threading only for now — the prompt starts reading these in Task 9.
      about: contact.about,
      experience: contact.experience,
    });
    if (!draft) {
      report.skipped.push({ contactId: contact.id, name, reason: "profile_call_failed" });
      continue;
    }

    // The veto's person-specificity bar, applied to the rationale BEFORE any axis is
    // paid for. A domain-description rationale ("כי הוא בבנקאות") dies here, loudly.
    const employerFacts = employer.profile as
      | { namedCompetitors?: string[]; customerSegments?: string[]; products?: string[] }
      | null;
    const gate = await gateRationales(draft.roleLens, draft.axes, {
      namedCompetitors: employerFacts?.namedCompetitors ?? [],
      // Stored in English while companyFact is written in Hebrew, so this is NOT how the
      // company side is recognised. It is here only so a fact that quotes the research
      // verbatim ("B2C: Individual consumers") is not read as an invented rival — the
      // capitalised "Individual" would otherwise trip the unknown-name scan.
      customerSegments: employerFacts?.customerSegments ?? [],
      // The employer's own identity, so a name in a rationale can be told apart by ROLE.
      // Without it "Phoenix" in Gil Tamir's own axis reads as an invented competitor, and
      // so do "Poalim UP" and "Poalim Young" — Bank Hapoalim's own products — in Pazit's.
      employer: {
        names: [employer.name, ...employer.aliases],
        products: employerFacts?.products ?? [],
      },
      reasoning: draft.reasoning,
    });
    for (const r of gate.rejected) {
      report.skipped.push({ contactId: contact.id, name, reason: `axis_rejected[${r.reason}]: ${r.label}` });
    }
    // Deterministic rejections are counted per rule so "is the brain obeying the
    // prompt?" is answerable from the report rather than by reading rationales.
    for (const [rule, n] of Object.entries(gate.deterministic)) {
      report.rejectedByRule[rule] = (report.rejectedByRule[rule] ?? 0) + n;
    }
    if (gate.kept.length === 0) {
      report.skipped.push({ contactId: contact.id, name, reason: "all_rationales_generic" });
      continue;
    }

    const profile = await prisma.personProfile.upsert({
      where: { contactId: contact.id },
      create: {
        contactId: contact.id,
        roleLens: draft.roleLens,
        reasoning: draft.reasoning,
        employerTrackedCompanyId: employer.id,
      },
      // personalNotes is deliberately untouched: it is learned from feedback, and a
      // rebuild must not erase what the pilot taught us about someone.
      update: {
        roleLens: draft.roleLens,
        reasoning: draft.reasoning,
        employerTrackedCompanyId: employer.id,
        refreshedAt: new Date(),
      },
      select: { id: true },
    });

    if (input.force) {
      // Detach the old model's un-muted subscriptions; the new axes replace them.
      // Muted links stay — they carry learned "לא מעניין אותו" feedback.
      await prisma.personAxis.deleteMany({
        where: { personProfileId: profile.id, mutedAt: null },
      });
    }

    kept.push({ name, employerId: employer.id, axes: gate.kept });

    const attached = await attachAxes({
      orgId: input.orgId,
      personProfileId: profile.id,
      proposals: gate.kept,
      // The employer, so a merge is never decided on the label alone. Gil Tamir (Phoenix)
      // created "תחרות דיגיטלית מול הראל ומגדל"; Elinor (Bank Leumi) was folded into it and
      // inherited its three insurance queries, because the axis row owns the queries and
      // label similarity cannot see whose competitors those are.
      employer: {
        employerId: employer.id,
        names: [employer.name, ...employer.aliases],
        namedCompetitors: employerFacts?.namedCompetitors ?? [],
      },
    });
    report.axesCreated += attached.created;
    report.axesMerged += attached.merged;
    report.axesRefused += attached.refused;
    // Refusals go where a human already reads axis outcomes, so each one renders as
    // `axis_merge_refused[<axis> · <employer>]: <label>` next to the person it belongs to.
    for (const s of [...attached.skipped, ...attached.mergeRefused]) {
      report.skipped.push({ contactId: contact.id, name, reason: `axis_${s.reason}: ${s.label}` });
    }

    await ensureCompanyMonitorAxis({
      orgId: input.orgId,
      trackedCompanyId: employer.id,
      companyName: employer.name,
    });

    rebuilt.push(contact.id);
    if (contact.personProfile) report.refreshed += 1;
    else report.built += 1;
  }

  // Everything judged against the axes this run retired stops presenting itself as the
  // current decision. Marked, not deleted, and never the SENT draft.
  report.superseded = await markSuperseded({
    orgId: input.orgId,
    ownerId: input.ownerId,
    contactIds: rebuilt,
  });

  // Verified against the database, not against the prompt. A prompt that asks for a
  // Hebrew query and a pipeline that drops it look identical from the prompt's side.
  const built = await db.personProfile.findMany({
    where: { contact: { ownerId: input.ownerId } },
    select: {
      contact: { select: { fullName: true } },
      axes: { select: { agenda: true, axis: { select: { searchQueries: true } } } },
    },
  });
  for (const row of built) {
    const name = row.contact.fullName ?? "?";
    const hebrew = countHebrewQueries(row.axes.map((a) => a.axis));
    const agenda = row.axes.filter((a) => a.agenda).length;
    report.hebrewQueriesByPerson.push({ name, hebrew, agenda });
    if (hebrew === 0) report.noHebrewQuery.push(name);
  }
  if (report.noHebrewQuery.length > 0) {
    console.error(
      `[radar] INVARIANT FAILED org=${input.orgId}: no Hebrew query for ${report.noHebrewQuery.join(", ")} — these people cannot reach Israeli press`
    );
  }

  // Built with the run's own builder, normalizer and per-axis cap, so the number in
  // the report is the number that gets billed. Refusing a merge raises the axis count;
  // this is where it becomes visible whether it raised the bill.
  report.pool = await poolQueryCount(input.orgId);
  report.thin = thinProfiles(kept);
  report.stages = stageDistribution(kept.flatMap((k) => k.axes));
  report.sameDecision = sameDecisionCollisions(kept);
  for (const t of report.thin) {
    console.warn(`[radar] THIN PROFILE ${t.name}: ${t.axes} axes, floor is ${t.floor}`);
  }

  return report;
}
