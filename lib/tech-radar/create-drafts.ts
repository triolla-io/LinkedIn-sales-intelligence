/**
 * Turn one opportunity into prepared messages.
 *
 * Loops over every owner in the org, exactly like createMatchesForOrgArticle: the
 * recipient cap is per (opportunity × owner) because the owner is who sends. If
 * two reps both have contacts at the same company, each gets their own up-to-3.
 *
 * An opportunity with no senior contact anywhere produces zero drafts and stays
 * DISCOVERED — the UI shows it as "no one to contact", which tells the rep where
 * they need to acquire one.
 */
import { prisma } from "@/lib/prisma";
import { isSeniorTitle } from "@/lib/company-signals/clevel";
import { buildRecipientWhere, rankRecipients } from "@/lib/tech-radar/recipients";
import { draftTechMessage } from "@/lib/tech-radar/draft";
import type { RecipientCandidate } from "@/lib/tech-radar/types";

/** Candidate pool size per owner before ranking. */
const CANDIDATE_CAP = 25;

/**
 * How many still-open drafts one person may be holding before we stop adding more.
 *
 * The 3-per-opportunity cap says nothing about how many OPPORTUNITIES one person can
 * receive, and the live Delek Group run put five separate messages in front of the CEO
 * in a single scan. Dismissed and already-sent drafts do not count — this bounds the
 * queue in front of a person, not their lifetime total.
 */
const MAX_OPEN_DRAFTS_PER_CONTACT = 2;
const OPEN_DRAFT_WINDOW_DAYS = 7;

export async function createDraftsForOpportunity(
  opportunityId: string
): Promise<{ created: number; owners: number }> {
  const opportunity = await prisma.techOpportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    select: {
      id: true,
      fitRationale: true,
      item: { select: { technology: true, title: true, summary: true, vendor: true } },
      trackedCompany: {
        select: { id: true, orgId: true, name: true, aliases: true, companyId: true, relationship: true },
      },
    },
  });

  const company = opportunity.trackedCompany;
  const owners = await prisma.user.findMany({ where: { orgId: company.orgId }, select: { id: true } });
  const ownerIds = owners.map((o) => o.id);

  // ONE query for the whole org, grouped in memory. Asking per owner meant a database
  // round-trip for every user in the org on every opportunity — 2,591 of them in the
  // live run — when only a handful have anyone at the company at all.
  const allContacts = await prisma.contact.findMany({
    where: buildRecipientWhere(ownerIds, {
      companyId: company.companyId,
      name: company.name,
      aliases: company.aliases,
    }),
    select: {
      id: true, ownerId: true, fullName: true, hebrewFirstName: true, currentTitle: true, headline: true,
    },
  });

  // The SQL filter is coarse by necessity — `contains` cannot express a word boundary,
  // so "coo" matches every "Coordinator". Decide seniority precisely here.
  const senior = allContacts.filter((c) => isSeniorTitle(c.currentTitle));

  const contactsByOwner = new Map<string, typeof allContacts>();
  for (const contact of senior) {
    const list = contactsByOwner.get(contact.ownerId);
    if (list) list.push(contact);
    else contactsByOwner.set(contact.ownerId, [contact]);
  }

  let created = 0;
  // Only owners who actually have somebody there cost anything from here on.
  for (const [ownerId, ownerContacts] of contactsByOwner) {
    const contacts = ownerContacts.slice(0, CANDIDATE_CAP);

    const candidates: RecipientCandidate[] = contacts.map((c) => ({
      contactId: c.id,
      fullName: c.fullName,
      hebrewFirstName: c.hebrewFirstName,
      currentTitle: c.currentTitle,
      headline: c.headline,
    }));
    const ranked = await rankRecipients(opportunity.item, candidates);
    const byId = new Map(contacts.map((c) => [c.id, c]));

    for (const pick of ranked) {
      const contact = byId.get(pick.contactId);
      if (!contact) continue;

      // Idempotent on (opportunityId, contactId) so an Inngest retry cannot double-draft.
      const existing = await prisma.techOpportunityDraft.findUnique({
        where: { opportunityId_contactId: { opportunityId: opportunity.id, contactId: contact.id } },
        select: { id: true },
      });
      if (existing) continue;

      // Don't pile messages on one person across separate opportunities.
      const openDrafts = await prisma.techOpportunityDraft.count({
        where: {
          contactId: contact.id,
          status: { in: ["PENDING_REVIEW", "PREPARING", "PREPARED"] },
          createdAt: { gte: new Date(Date.now() - OPEN_DRAFT_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
        },
      });
      if (openDrafts >= MAX_OPEN_DRAFTS_PER_CONTACT) continue;

      const message = await draftTechMessage({
        contactFullName: contact.fullName,
        hebrewFirstName: contact.hebrewFirstName,
        contactTitle: contact.currentTitle,
        companyName: company.name,
        technology: opportunity.item.technology,
        vendor: opportunity.item.vendor,
        // The rationale, not the item summary — this is what makes it specific.
        fitRationale: opportunity.fitRationale,
      });

      await prisma.techOpportunityDraft.create({
        data: {
          opportunityId: opportunity.id,
          ownerId,
          contactId: contact.id,
          draftMessage: message,
          status: "PENDING_REVIEW",
        },
      });
      created += 1;
    }
  }

  if (created > 0) {
    await prisma.techOpportunity.update({
      where: { id: opportunity.id },
      data: { status: "DRAFTED" },
    });
  }
  return { created, owners: owners.length };
}
