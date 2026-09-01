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
import { invalidEntityTags } from "@/lib/tech-radar/rationale-rules";
import { careerSummary } from "@/lib/tech-radar/career";
import { researchPerson, type PersonWebResearch } from "@/lib/tech-radar/person-research";
import type { BusinessLine } from "@/lib/tech-radar/types";
import {
  attachAxes, ensureCompanyMonitorAxis, ensureIndustryAxis, ensureEntityAxes,
} from "@/lib/tech-radar/axis-store";
import { countHebrewQueries } from "@/lib/tech-radar/axis";
import { poolQueryCount, MAX_QUERIES_PER_AXIS } from "@/lib/tech-radar/person-scan";
import { buildAxisQueryPool } from "@/lib/tech-radar/axis-fit";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import { missingLayer } from "@/lib/tech-radar/layers";
import { prisma as db } from "@/lib/prisma";
import { isUsableProfile } from "@/lib/tech-radar/types";
import { markSuperseded } from "@/lib/tech-radar/superseded";
import {
  thinProfiles, stageDistribution, sameDecisionCollisions,
  type ThinProfile, type DecisionCollision,
} from "@/lib/tech-radar/profile-quality";

/** Rebuilt only when older than this — a role does not change weekly. */
const STALE_AFTER_DAYS = 90;

/**
 * A gate rejection reason, formatted so a human reading the skip log can tell which floor
 * of the four-layer model was missing — `axis_no_person_side [קומה 4 חסרה]: <label>` reads
 * differently from `axis_no_company_side [קומה 2 חסרה]: <label>` without opening
 * layers.ts. `reason` may carry a `:detail` suffix (e.g. `unknown_competitor:Revolut`);
 * only the rule name before the colon is looked up, but the full reason (detail included)
 * is still printed. Rules `missingLayer` doesn't recognise (`contradicts_reasoning`, and
 * any future rule not about a missing layer) print with no suffix at all.
 */
function formatAxisRejection(reason: string, label: string): string {
  const rule = reason.split(":")[0];
  const layer = missingLayer(rule);
  const suffix = layer === null ? "" : ` [קומה ${layer} חסרה]`;
  return `axis_${reason}${suffix}: ${label}`;
}

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
  /**
   * Entity tags the truth gate refused, by name. An invented rival is worse in a tag than
   * in a rationale: a rationale is read by a human before anything is sent, while a tag
   * carries its name into matching mechanically. The pilot's invented "בנק בינלאומי ראשון"
   * is the case — so each refusal is named here rather than counted.
   */
  entityTagsDropped: string[];
  /**
   * Findings per person, and what they cost. `findings: 0` is the loudest number in this
   * report: it means the model saw only the job title crossed with the employer, which
   * produces a person indistinguishable from anyone else holding that chair — and it is
   * exactly what happened on 2026-08-31, when three of four paid providers were at zero
   * AND this path passed no research map at all. Both halves are fixed; this is the meter
   * that says so.
   */
  researchByPerson: { name: string; findings: number; paidQueries: number; discarded: number }[];
  /** Anyone built on ZERO findings. Must be empty, and is a defect when it is not. */
  noResearch: string[];
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
  /**
   * Web research about the PEOPLE, keyed by contact id — a PRE-FETCHED cache, not the
   * only source any more. The prepare flow (radar.person.prepare) researches the one
   * person it is onboarding and hands the findings in; anyone missing from the map is now
   * researched HERE instead of being modelled without research.
   *
   * The old contract was the opposite — "the nightly path omits the map entirely and
   * builds without it, because researching a whole cohort is a news-quota bill" — and it
   * was written when research meant paid provider calls. It does not any more (person
   * research is free Google News RSS first), so the reason for the omission is gone while
   * its cost stayed: every person rebuilt through this path, including the whole
   * 2026-08-31 cohort, was built from title x company alone. That is the single biggest
   * cause of axes that read like anyone's.
   */
  personResearchByContact?: Map<string, PersonWebResearch>;
  /** Injection seam: tests must never reach a provider. Defaults to researchPerson. */
  researcher?: typeof researchPerson;
}): Promise<BuildProfilesReport> {
  const report: BuildProfilesReport = {
    considered: 0, built: 0, refreshed: 0, axesCreated: 0, axesMerged: 0, axesRefused: 0,
    pool: { axes: 0, uniqueQueries: 0 }, thin: [], stages: {}, sameDecision: [],
    hebrewQueriesByPerson: [], noHebrewQuery: [], skipped: [], rejectedByRule: {},
    superseded: { matches: 0, drafts: 0 },
    researchByPerson: [], noResearch: [],
    domainsByPerson: [], allDerived: [],
    layerQueries: { industry: 0, companyMonitor: 0, person: 0 },
    industryShared: { industries: 0, employers: 0, savedQueries: 0 },
    notes: [], entityTagsDropped: [],
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
      // Layer-4 sources the deep scrape added, plus the Hebrew first name — the same
      // person's press is almost entirely Hebrew, so it is what person research searches on.
      skills: true, education: true, hebrewFirstName: true,
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

    // Research the person unless the caller already did. This used to be a bare `?? null`
    // inside the build call — a silent build with no person layer — and that single `??` is
    // why the 2026-08-31 cohort came back generic: NONE of the three callers of this
    // function passes the map, so the branch that ran was always the one with no research.
    let personResearch = input.personResearchByContact?.get(contact.id) ?? null;
    if (!personResearch) {
      const research = input.researcher ?? researchPerson;
      // researchPerson never throws by contract, but a provider-layer surprise must not
      // cost the whole build: a person modelled on the title is still better than none.
      try {
        personResearch = await research({
          fullName: name,
          hebrewName: contact.hebrewFirstName,
          companyName: employer.name,
        });
      } catch {
        personResearch = null;
      }
    }
    report.researchByPerson.push({
      name,
      findings: personResearch?.findings.length ?? 0,
      paidQueries: personResearch?.paidQueries ?? 0,
      // Results that came back naming only the employer. High here with `findings: 0` is a
      // recall problem; both being zero is a provider problem. Different fixes, so the
      // report has to tell them apart.
      discarded: personResearch?.discarded ?? 0,
    });
    if (!personResearch || personResearch.findings.length === 0) report.noResearch.push(name);

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
      // The deep scrape's own two fields. Weak alone, strong in the role verification: a
      // head of retail listing "Trade Finance" is claiming a line the canonical role
      // definition would have put in notOwns.
      skills: contact.skills,
      education: contact.education,
      // Computed in code (lib/tech-radar/career.ts), never asked of the model — an invented
      // tenure is indistinguishable from a real one once it is downstream, which is exactly
      // what the fabricated `dateIso: "2024-01-01"` cost the pilot one field over.
      career: careerSummary(contact.experience),
      // Now present on EVERY path — pre-fetched by the caller, or researched just above.
      personResearch,
      // The employer's lines of business WITH `forWhom` — the input the audience answer is
      // an intersection over. Without it the model can only copy the company's whole
      // customer base onto one executive, which is the v1 failure this phase exists to fix.
      businessLines: (employer.profile as { businessLines?: BusinessLine[] } | null)?.businessLines ?? [],
    });
    if (!draft) {
      // NOTE (Task 9): a draft rejected for a missing `audience` — the one hard new
      // requirement in the v2 parser — lands in this same bucket, because
      // buildPersonProfile signals both a failed call and an unusable response as `null`
      // (it logs the parse reason and drops it). Distinguishing them needs the reason
      // surfaced on buildPersonProfile's return, in person-profile.ts, which this task is
      // not allowed to touch; until then `profile_no_audience` is only in the server log.
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
          // The dated moves research actually found. Feeds two checks: the gate's
          // fabricated-date rule (which fails OPEN without them, so an invented dateIso
          // survives if they are not passed) and the entity-tag gate, where a project the
          // employer announced is the evidence that the project is theirs.
          recentMoves?: { fact: string; dateIso: string; sourceUrl?: string }[];
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
      // Every layer-3 axis in the pilot org carried an invented `dateIso: "2024-01-01"`,
      // and layer3Expired then quietly dropped all of them from the query pool. The check
      // that catches it fails open with no moves in hand — so not passing these means the
      // rule can never fire.
      recentMoves: employerFacts?.recentMoves ?? [],
    });
    for (const r of gate.rejected) {
      report.skipped.push({ contactId: contact.id, name, reason: formatAxisRejection(r.reason, r.label) });
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
        // Whose customers this person serves, and which lines are and are not on their
        // desk. Persisted rather than recomputed: Phase B's matching reads them, and the
        // person page shows them to the human who has to approve the model.
        audience: draft.audience,
        scope: draft.scope,
      },
      // personalNotes is deliberately untouched: it is learned from feedback, and a
      // rebuild must not erase what the pilot taught us about someone.
      update: {
        roleLens: draft.roleLens,
        reasoning: draft.reasoning,
        employerTrackedCompanyId: employer.id,
        // Only advance refreshedAt when the person actually got something built. gate.kept
        // is already known here (gateRationales ran above). Without this condition a
        // wholesale-rejected person (gate.kept.length === 0) is stamped "freshly modelled"
        // and the staleness guard at the top of this loop silently skips them for 90 days
        // on every non-force rebuild — no way to retry short of `force` (2026-08-26 final
        // review, Finding 2).
        ...(gate.kept.length > 0 ? { refreshedAt: new Date() } : {}),
        domains: draft.domains,
        // Refreshed unconditionally, like roleLens: a legacy profile built before the v2
        // parser has `audience: null`, and leaving it null after a rebuild would keep
        // Phase B blind to exactly the people who were just remodelled.
        audience: draft.audience,
        scope: draft.scope,
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
      const industryAxisId = await ensureIndustryAxis({
        orgId: input.orgId,
        personProfileId: profile.id,
        industry: employerFacts.industry,
      });
      // Task 8's all-filler-canonical guard: a canonical made only of stopwords
      // normalises to an empty key and ensureIndustryAxis refuses to mint a degenerate
      // axis for it, returning null. That refusal is correct — but silently discarded
      // here would leave the person with NO industry link and no explanation why,
      // exactly the silent-gap pattern this review exists to catch.
      if (industryAxisId === null) {
        report.notes.push(`industry_key_empty: ${employer.name}`);
      }
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
      //
      // MANUAL is excluded for a different reason, and it is the stronger one: a MANUAL
      // link is a HUMAN'S CORRECTION — someone looked at the model, saw what it missed and
      // typed the tag in. A rebuild that deleted it would make the person page's add-tag
      // control a lie: the tag would hold until the next rebuild and then vanish with no
      // trace and no explanation. The rebuild supersedes what the LLM proposed, never what
      // a person decided.
      await prisma.personAxis.deleteMany({
        where: { personProfileId: profile.id, mutedAt: null, source: { notIn: ["INDUSTRY", "MANUAL"] } },
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
          // The stage tag and the adopt axis's outside example, which the build enforced
          // and then dropped on the floor. Persisted so the mix is readable afterwards.
          stage: proposal.stage,
          externalExample: proposal.externalExample,
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

    // The person's NAMED subjects, gated before any of them can reach matching. A tag is
    // held to a harder standard than a rationale: a rationale is read by a human before
    // anything is sent, while a tag carries its name mechanically. So a competitor must
    // appear in the employer's researched gazetteer, and a product or project must be the
    // employer's OWN — the pilot's invented "בנק בינלאומי ראשון" is what this refuses.
    //
    // The employer's own vocabulary is its products PLUS the facts of its dated moves: a
    // project tag ("אשראי מהיר") is almost never in a product list, and the announcement
    // that names it is the evidence that the project is theirs.
    const entityTags = draft.entityTags ?? [];
    const dropped = invalidEntityTags(entityTags, employerFacts?.namedCompetitors ?? [], {
      names: [employer.name, ...employer.aliases],
      products: [
        ...(employerFacts?.products ?? []),
        ...(employerFacts?.recentMoves ?? []).map((m) => m.fact),
      ],
    });
    report.entityTagsDropped.push(...dropped);
    const keptTags = entityTags.filter((t) => !dropped.includes(t.name));
    // Skipped entirely at zero, so a cohort with no tags does no writes — and, in the
    // report, an empty `entityTagsDropped` with no axes is not confused with a refusal.
    if (keptTags.length > 0) {
      await ensureEntityAxes({
        orgId: input.orgId,
        personProfileId: profile.id,
        tags: keptTags,
      });
    }

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
      axes: {
        select: {
          agenda: true,
          mutedAt: true,
          axis: { select: { id: true, kind: true, status: true, searchQueries: true } },
        },
      },
    },
  });
  /**
   * Every ACTIVE, un-muted axis this cohort actually subscribes to, deduped by id (a
   * shared INDUSTRY axis appears once per subscriber but must only be counted once) and
   * carrying which employers subscribe to it — the two ingredients layerQueries and
   * industryShared.savedQueries both need.
   *
   * Excluded here as a deliberate report-side choice — muting is not honored by the scan
   * itself today (nothing in axis-store.ts or person-scan.ts skips a muted PersonAxis
   * link when building the query pool), so this makes the count conservative rather than
   * accurate to what the scan will actually fetch. A non-ACTIVE axis (MERGED/RETIRED/
   * TOO_BROAD) can still be joined via a stale PersonAxis row — that one genuinely
   * doesn't belong in a report describing what the pool actually fetches.
   */
  const liveAxes = new Map<string, { kind: string; searchQueries: string[]; employerIds: Set<string> }>();
  for (const row of built) {
    const name = row.contact.fullName ?? "?";
    const hebrew = countHebrewQueries(row.axes.map((a) => a.axis));
    const agenda = row.axes.filter((a) => a.agenda).length;
    report.hebrewQueriesByPerson.push({ name, hebrew, agenda });
    if (hebrew === 0) report.noHebrewQuery.push(name);

    for (const a of row.axes) {
      if (a.mutedAt || a.axis.status !== "ACTIVE") continue;
      let entry = liveAxes.get(a.axis.id);
      if (!entry) {
        entry = { kind: a.axis.kind, searchQueries: a.axis.searchQueries ?? [], employerIds: new Set() };
        liveAxes.set(a.axis.id, entry);
      }
      if (row.employerTrackedCompanyId) entry.employerIds.add(row.employerTrackedCompanyId);
    }
  }
  if (report.noHebrewQuery.length > 0) {
    console.error(
      `[radar] INVARIANT FAILED org=${input.orgId}: no Hebrew query for ${report.noHebrewQuery.join(", ")} — these people cannot reach Israeli press`
    );
  }

  // Unique query strings per kind, capped and deduped by buildAxisQueryPool — the SAME
  // function and the SAME effective per-axis limit (MAX_QUERIES_PER_AXIS) the real pool
  // fetches under, so this number can never claim more recall than a scan would actually
  // buy. Anything that is not INDUSTRY or COMPANY_MONITOR falls into "person" by default,
  // so a future RadarAxisKind is counted rather than silently dropped.
  const byKind: Record<"industry" | "companyMonitor" | "person", { id: string; searchQueries: string[] }[]> = {
    industry: [], companyMonitor: [], person: [],
  };
  for (const [id, entry] of liveAxes) {
    const bucket = entry.kind === "INDUSTRY" ? "industry" : entry.kind === "COMPANY_MONITOR" ? "companyMonitor" : "person";
    byKind[bucket].push({ id, searchQueries: entry.searchQueries });
  }
  report.layerQueries = {
    industry: buildAxisQueryPool(byKind.industry, normalizeQuery, MAX_QUERIES_PER_AXIS).length,
    companyMonitor: buildAxisQueryPool(byKind.companyMonitor, normalizeQuery, MAX_QUERIES_PER_AXIS).length,
    person: buildAxisQueryPool(byKind.person, normalizeQuery, MAX_QUERIES_PER_AXIS).length,
  };
  {
    let savedQueries = 0;
    let industries = 0;
    const sharedEmployerIds = new Set<string>();
    for (const [id, entry] of liveAxes) {
      if (entry.kind !== "INDUSTRY") continue;
      industries += 1;
      // This axis's OWN capped query count — the same cap, applied per-axis rather than
      // pooled across axes, since savedQueries is a per-axis sum.
      const queryCount = buildAxisQueryPool([{ id, searchQueries: entry.searchQueries }], normalizeQuery, MAX_QUERIES_PER_AXIS).length;
      savedQueries += Math.max(0, entry.employerIds.size - 1) * queryCount;
      for (const employerId of entry.employerIds) sharedEmployerIds.add(employerId);
    }
    report.industryShared = { industries, employers: sharedEmployerIds.size, savedQueries };
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
