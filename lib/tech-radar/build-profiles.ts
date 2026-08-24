/**
 * Build the person model for the people someone marked.
 *
 * This is the step that has to exist before a person-outward scan can find anything: no
 * PersonProfile means no PersonAxis, which means no axis has a subscriber, which means
 * the pool is empty and the run reports "no news" for a reason that has nothing to do
 * with news.
 */
import { prisma } from "@/lib/prisma";
import { buildPersonProfile } from "@/lib/tech-radar/person-profile";
import { attachAxes, ensureCompanyMonitorAxis } from "@/lib/tech-radar/axis-store";
import { countHebrewQueries } from "@/lib/tech-radar/axis";
import { prisma as db } from "@/lib/prisma";
import { isUsableProfile } from "@/lib/tech-radar/types";

/** Rebuilt only when older than this — a role does not change weekly. */
const STALE_AFTER_DAYS = 90;

export type BuildProfilesReport = {
  considered: number;
  built: number;
  refreshed: number;
  axesCreated: number;
  axesMerged: number;
  /** Hebrew search queries per person, from the DATABASE. Zero for anyone is a defect. */
  hebrewQueriesByPerson: { name: string; hebrew: number; agenda: number }[];
  /** People with no Hebrew query at all. Must be empty. */
  noHebrewQuery: string[];
  /** Every person who did NOT get a profile, and why. Never a silent shortfall. */
  skipped: { contactId: string; name: string; reason: string }[];
};

export async function buildProfilesForMarked(input: {
  orgId: string;
  ownerId: string;
  /** Restrict to these contacts. Omitted = the whole marked cohort; empty = nobody. */
  contactIds?: string[];
}): Promise<BuildProfilesReport> {
  const report: BuildProfilesReport = {
    considered: 0, built: 0, refreshed: 0, axesCreated: 0, axesMerged: 0,
    hebrewQueriesByPerson: [], noHebrewQuery: [], skipped: [],
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

  for (const contact of contacts) {
    const name = contact.fullName ?? contact.id;

    if (contact.personProfile && contact.personProfile.refreshedAt > staleBefore) {
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

    const draft = await buildPersonProfile({
      fullName: name,
      currentTitle: contact.currentTitle,
      headline: contact.headline,
      companyName: employer.name,
      employerProfile: employer.profile,
    });
    if (!draft) {
      report.skipped.push({ contactId: contact.id, name, reason: "profile_call_failed" });
      continue;
    }

    const profile = await prisma.personProfile.upsert({
      where: { contactId: contact.id },
      create: {
        contactId: contact.id,
        roleLens: draft.roleLens,
        employerTrackedCompanyId: employer.id,
      },
      // personalNotes is deliberately untouched: it is learned from feedback, and a
      // rebuild must not erase what the pilot taught us about someone.
      update: { roleLens: draft.roleLens, employerTrackedCompanyId: employer.id, refreshedAt: new Date() },
      select: { id: true },
    });

    const attached = await attachAxes({
      orgId: input.orgId,
      personProfileId: profile.id,
      proposals: draft.axes,
    });
    report.axesCreated += attached.created;
    report.axesMerged += attached.merged;
    for (const s of attached.skipped) {
      report.skipped.push({ contactId: contact.id, name, reason: `axis_${s.reason}: ${s.label}` });
    }

    await ensureCompanyMonitorAxis({
      orgId: input.orgId,
      trackedCompanyId: employer.id,
      companyName: employer.name,
    });

    if (contact.personProfile) report.refreshed += 1;
    else report.built += 1;
  }

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

  return report;
}
