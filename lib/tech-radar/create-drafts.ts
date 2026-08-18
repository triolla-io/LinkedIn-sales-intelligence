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
import { buildRecipientWhere, rankRecipients } from "@/lib/tech-radar/recipients";
import { draftTechMessage } from "@/lib/tech-radar/draft";
import type { RecipientCandidate } from "@/lib/tech-radar/types";

/** Candidate pool size per owner before ranking. */
const CANDIDATE_CAP = 25;

export async function createDraftsForOpportunity(
  opportunityId: string
): Promise<{ created: number; owners: number }> {
  const opportunity = await prisma.techOpportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    select: {
      id: true,
      fitRationale: true,
      item: { select: { technology: true, title: true, summary: true, vendor: true } },
      trackedCompany: { select: { id: true, orgId: true, name: true, companyId: true, relationship: true } },
    },
  });

  const company = opportunity.trackedCompany;
  const owners = await prisma.user.findMany({ where: { orgId: company.orgId }, select: { id: true } });

  let created = 0;
  for (const owner of owners) {
    const contacts = await prisma.contact.findMany({
      where: buildRecipientWhere(owner.id, { companyId: company.companyId, name: company.name }),
      take: CANDIDATE_CAP,
      select: { id: true, fullName: true, hebrewFirstName: true, currentTitle: true, headline: true },
    });
    if (contacts.length === 0) continue;

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

      const message = await draftTechMessage({
        contactFullName: contact.fullName,
        hebrewFirstName: contact.hebrewFirstName,
        contactTitle: contact.currentTitle,
        companyName: company.name,
        relationship: company.relationship,
        technology: opportunity.item.technology,
        vendor: opportunity.item.vendor,
        // The rationale, not the item summary — this is what makes it specific.
        fitRationale: opportunity.fitRationale,
      });

      await prisma.techOpportunityDraft.create({
        data: {
          opportunityId: opportunity.id,
          ownerId: owner.id,
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
