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
import { attachAxes, ensureCompanyMonitorAxis, ensureIndustryAxis } from "@/lib/tech-radar/axis-store";
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
  /** Layer 4's fields of work per person, found vs. derived. Not gated by the merge gate
   *  or by whether the person kept any axis — this is about what the model saw, not
   *  what survived. */
  domainsByPerson: { name: string; found: number; derived: number }[];
  /** Yellow flags: people whose every mapped field of work was derived, none found in
   *  their own data. Not a defect by itself — SCRAPE_PROFILE may simply be thin for them
   *  — but a cohort where this is common is a signal the person data is too. */
  allDerived: string[];
  /** Unique search-query strings currently pooled per axis kind, read back from the DB
   *  across the owner's whole modelled cohort (not just this run's rebuilds) — the same
   *  scope as hebrewQueriesByPerson below. */
  layerQueries: { industry: number; companyMonitor: number; person: number };
  /**
   * What the INDUSTRY net is actually saving. `savedQueries` is Σ over INDUSTRY axes of
   * (distinct subscriber employers − 1) × its query count — the number of per-employer
   * query sets the shared net made unnecessary.
   */
  industryShared: { industries: number; employers: number; savedQueries: number };
  /**
   * Free-text notes that are not a per-person skip and not a per-rule rejection count —
   * today, only `no_industry: <employer>` when ensureIndustryAxis was skipped for lack of
   * `employer.profile.industry` (a legacy profile researched before research v2). Task 8
   * left this owed to Task 10: the skip itself is silent by design (never a crash), but a
   * silent skip with no visibility anywhere is indistinguishable from a bug.
   */
  notes: string[];
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
    domainsByPerson: [], allDerived: [],
    layerQueries: { industry: 0, companyMonitor: 0, person: 0 },
    industryShared: { industries: 0, employers: 0, savedQueries: 0 },
    notes: [],
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
      // Layer-4 FOUND sources: the prompt reads the About paragraph and the past roles
      // and must quote them verbatim to claim a field was found there.
      about: contact.about,
      experience: contact.experience,
    });
    if (!draft) {
      report.skipped.push({ contactId: contact.id, name, reason: "profile_call_failed" });
      continue;
    }

    // Layer 4's fields of work, tallied regardless of what the merge gate later keeps —
    // this is about what the model saw in the person's own data, not what survived as an
    // axis. A person whose every field is derived (found === 0) is flagged: not a defect
    // by itself, but a cohort where it is common says something about the person data.
    const foundDomains = draft.domains.filter((d) => d.kind === "found").length;
    const derivedDomains = draft.domains.filter((d) => d.kind === "derived").length;
    report.domainsByPerson.push({ name, found: foundDomains, derived: derivedDomains });
    if (draft.domains.length > 0 && foundDomains === 0) {
      report.allDerived.push(name);
    }

    // The veto's person-specificity bar, applied to the rationale BEFORE any axis is
    // paid for. A domain-description rationale ("כי הוא בבנקאות") dies here, loudly.
    const employerFacts = employer.profile as
      | {
          namedCompetitors?: string[];
          customerSegments?: string[];
          products?: string[];
          // Optional: profiles researched before Task 5 (research v2) don't have this.
          // Absence is handled below by simply not calling ensureIndustryAxis — never a
          // crash, never an empty-string industry.
          industry?: { canonical: string; queries: string[] };
        }
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

    const profile = await prisma.personProfile.upsert({
      where: { contactId: contact.id },
      create: {
        contactId: contact.id,
        roleLens: draft.roleLens,
        reasoning: draft.reasoning,
        employerTrackedCompanyId: employer.id,
        domains: draft.domains,
      },
      // personalNotes is deliberately untouched: it is learned from feedback, and a
      // rebuild must not erase what the pilot taught us about someone.
      update: {
        roleLens: draft.roleLens,
        reasoning: draft.reasoning,
        employerTrackedCompanyId: employer.id,
        refreshedAt: new Date(),
        domains: draft.domains,
      },
      select: { id: true },
    });

    // Layer 1, the shared industry net — deliberately BEFORE the "all rejected" exit
    // below and OUTSIDE the gate entirely. gateRationales only ever judges draft.axes
    // (the ROLE_COMPANY proposals); an INDUSTRY axis carries no personDecision and would
    // die on no_person_side if it were ever routed through that gate. Skipping it when
    // gate.kept is empty would mean the one person whose subjects all died is exactly
    // the person who loses the net too — the opposite of what a shared net is for.
    //
    // The force-detach below is NOT moved up here with it. A wholesale-rejected draft
    // means there is nothing to replace the person's existing axes with — deleting their
    // un-muted links here would be pure data loss (2026-08-26 review, Important 1). Only
    // the profile row and the industry subscription are safe to write unconditionally;
    // the detach stays gated behind having something to detach FOR.
    if (employerFacts?.industry?.canonical && (employerFacts.industry.queries?.length ?? 0) > 0) {
      await ensureIndustryAxis({
        orgId: input.orgId,
        personProfileId: profile.id,
        industry: employerFacts.industry,
      });
    } else {
      // Task 8's own interface note: the skip itself is correct (never invent an industry
      // for a profile researched before research v2) but it was silent — indistinguishable
      // from a bug. Named here, once per person, rather than only once per employer, since
      // the report is read per-run and a person is the unit everything else in it uses.
      report.notes.push(`no_industry: ${employer.name}`);
    }

    if (gate.kept.length === 0) {
      report.skipped.push({ contactId: contact.id, name, reason: "all_rationales_generic" });
      continue;
    }

    if (input.force) {
      // Detach the old model's un-muted ROLE_COMPANY/COMPANY_MONITOR subscriptions; the
      // new axes replace them. Muted links stay — they carry learned "לא מעניין אותו"
      // feedback. INDUSTRY is excluded too: ensureIndustryAxis already ran above and
      // (re)created this person's net link, and an unscoped delete here would wipe it
      // right back out on every successful force rebuild — the industry net contributing
      // zero queries for exactly the people this pipeline is meant to feed (2026-08-26
      // review round 2). An INDUSTRY link is a net subscription, not one of the subjects
      // force-detach exists to clear.
      await prisma.personAxis.deleteMany({
        where: { personProfileId: profile.id, mutedAt: null, source: { not: "INDUSTRY" } },
      });
    }

    // Every surviving proposal's evidence, assembled here because this is where
    // draft.domains lives — attachAxes decides merges on the label/queries/employer alone
    // and never sees the domains list. domainKind/domainSource come from the domains entry
    // this axis's `domain` names; the parser already guarantees an exact match (an axis
    // whose domain does not resolve was dropped as `no_domain`), so the fallback below is
    // defensive only.
    const domainByName = new Map(draft.domains.map((d) => [d.domain, d]));
    const keptWithEvidence = gate.kept.map((proposal) => {
      const matched = domainByName.get(proposal.domain);
      return {
        ...proposal,
        evidence: {
          personDecision: proposal.personDecision,
          companyFact: proposal.companyFact,
          domain: proposal.domain,
          domainKind: matched?.kind ?? "derived",
          domainSource: matched?.kind === "found" ? (matched.source ?? null) : null,
          layerEvidence: proposal.layerEvidence,
        },
      };
    });

    kept.push({ name, employerId: employer.id, axes: keptWithEvidence });

    const attached = await attachAxes({
      orgId: input.orgId,
      personProfileId: profile.id,
      proposals: keptWithEvidence,
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
  // Also the source for layerQueries/industryShared below — one read-back, one pass,
  // scoped to the owner's whole modelled cohort like the Hebrew invariant already is,
  // not just the people this run touched.
  const built = await db.personProfile.findMany({
    where: { contact: { ownerId: input.ownerId } },
    select: {
      contact: { select: { fullName: true } },
      employerTrackedCompanyId: true,
      axes: { select: { agenda: true, axis: { select: { id: true, kind: true, searchQueries: true } } } },
    },
  });
  const industryQueries = new Set<string>();
  const companyMonitorQueries = new Set<string>();
  const personQueries = new Set<string>();
  /** Per INDUSTRY axis id: which employers subscribe to it, and how many queries it
   *  carries — the two ingredients of the savedQueries formula below. */
  const industryAxes = new Map<string, { employerIds: Set<string>; queryCount: number }>();
  for (const row of built) {
    const name = row.contact.fullName ?? "?";
    const hebrew = countHebrewQueries(row.axes.map((a) => a.axis));
    const agenda = row.axes.filter((a) => a.agenda).length;
    report.hebrewQueriesByPerson.push({ name, hebrew, agenda });
    if (hebrew === 0) report.noHebrewQuery.push(name);

    for (const a of row.axes) {
      const queries = a.axis.searchQueries ?? [];
      if (a.axis.kind === "INDUSTRY") {
        for (const q of queries) industryQueries.add(q);
        const entry = industryAxes.get(a.axis.id) ?? { employerIds: new Set(), queryCount: queries.length };
        if (row.employerTrackedCompanyId) entry.employerIds.add(row.employerTrackedCompanyId);
        industryAxes.set(a.axis.id, entry);
      } else if (a.axis.kind === "COMPANY_MONITOR") {
        for (const q of queries) companyMonitorQueries.add(q);
      } else {
        for (const q of queries) personQueries.add(q);
      }
    }
  }
  if (report.noHebrewQuery.length > 0) {
    console.error(
      `[radar] INVARIANT FAILED org=${input.orgId}: no Hebrew query for ${report.noHebrewQuery.join(", ")} — these people cannot reach Israeli press`
    );
  }
  report.layerQueries = {
    industry: industryQueries.size,
    companyMonitor: companyMonitorQueries.size,
    person: personQueries.size,
  };
  {
    let savedQueries = 0;
    const sharedEmployerIds = new Set<string>();
    for (const { employerIds, queryCount } of industryAxes.values()) {
      savedQueries += Math.max(0, employerIds.size - 1) * queryCount;
      for (const id of employerIds) sharedEmployerIds.add(id);
    }
    report.industryShared = { industries: industryAxes.size, employers: sharedEmployerIds.size, savedQueries };
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
