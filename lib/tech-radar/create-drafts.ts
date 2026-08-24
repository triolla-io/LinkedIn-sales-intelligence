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
import { companyMatchWhere, rankRecipients } from "@/lib/tech-radar/recipients";
import { draftTechMessage } from "@/lib/tech-radar/draft";
import { suggestContactRole } from "@/lib/tech-radar/suggest-contact";
import { isUsableProfile, type RecipientCandidate, type TechRadarProfile } from "@/lib/tech-radar/types";

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

/**
 * How many people at ONE company may receive the SAME item, over the item's lifetime.
 *
 * One. Not three, which is the cross-company cap.
 *
 * The first person-first run (2026-08-20) sent one AWS item to three founders of
 * 365Scores — CEO, COO and VP-R&D — and an earlier run sent one Fen-AI item to two
 * people at Bank Hapoalim with a byte-identical body. Colleagues in the same corridor
 * do not merely *might* compare notes; they will, and two of them holding the same
 * "I thought of you" message is a demonstration that nobody thought of anyone.
 *
 * An opportunity is already @@unique([trackedCompanyId, itemId]), so "one recipient per
 * company per item" is exactly "one draft per opportunity" — which is also why this is
 * org-wide rather than per owner. The recipients talk to each other regardless of which
 * of our users sent it.
 */
const MAX_RECIPIENTS_PER_ITEM_PER_COMPANY = 1;

/**
 * Statuses that mean a person is holding, or has held, this item. A draft the human
 * dismissed reached nobody, so it frees the slot for someone else on a later run.
 */
const CLAIMS_A_RECIPIENT_SLOT = ["PENDING_REVIEW", "PREPARING", "PREPARED", "SENT"] as const;
const OPEN_DRAFT_WINDOW_DAYS = 7;

/**
 * Why an opportunity ended up with nobody to send to. The screen used to say "you have
 * no senior contact here" for all of these, which was false in three of them.
 */
export type DraftBlockReason =
  | "no_senior_contact"      // nobody senior at this company at all
  | "no_role_match"          // contacts exist, none owns this kind of decision
  | "contacts_at_capacity"   // right people, already holding enough open drafts
  | "recipient_cap_reached"; // somebody at this company already has this item

/**
 * The article to forward. `TechItem.sources` is JSON (`[{url,title,publishedAt}]`), not a
 * column, and an item synthesized from a snippet can arrive with none — the v2 message
 * carries a link, so this is the one place that decides which one.
 */
export function firstSourceUrl(sources: unknown): string | null {
  if (!Array.isArray(sources)) return null;
  for (const s of sources) {
    const url = (s as { url?: unknown })?.url;
    if (typeof url === "string" && /^https?:\/\//i.test(url.trim())) return url.trim();
  }
  return null;
}

export async function createDraftsForOpportunity(
  opportunityId: string
): Promise<{ created: number; owners: number; blockedBy: DraftBlockReason | null }> {
  const opportunity = await prisma.techOpportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    select: {
      id: true,
      fitRationale: true,
      item: { select: { technology: true, title: true, summary: true, vendor: true, sources: true } },
      trackedCompany: {
        select: { id: true, orgId: true, name: true, aliases: true, companyId: true, profile: true },
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
    where: companyMatchWhere(ownerIds, {
      companyId: company.companyId,
      name: company.name,
      aliases: company.aliases,
    }),
    select: {
      id: true, ownerId: true, fullName: true, hebrewFirstName: true, currentTitle: true,
      headline: true, radarInclude: true,
    },
  });

  // Hand-marked contacts WIN when any exist at this company, and they bypass the
  // seniority gate. `radarInclude` is a deliberate human choice, so it overrides the
  // automatic rule exactly the way judgeCohort's opt_in does — the whole point of
  // marking someone is that the automatic rule would not have chosen them.
  //
  // This is what makes a person-first smoke test possible: mark the people you want,
  // and the run drafts to them instead of to whoever the ranker considers senior here.
  // An explicit opt-out is honoured before anything else. radarInclude === false means
  // "never contact this person", and the seniority path must not smuggle them back in —
  // judgeCohort already respects this, and the two must not disagree.
  const eligible = allContacts.filter((c) => c.radarInclude !== false);
  const marked = eligible.filter((c) => c.radarInclude === true);
  // Without marks, fall back to the automatic rule. The SQL filter cannot express a
  // word boundary — "coo" matches every "Coordinator" — so seniority is decided here.
  const senior = marked.length > 0 ? marked : eligible.filter((c) => isSeniorTitle(c.currentTitle));

  /** Ask which role they are missing, and record it. Never fails the caller. */
  async function recordSuggestion(): Promise<void> {
    const profile = company.profile;
    if (!isUsableProfile(profile)) return;
    const suggestion = await suggestContactRole({
      companyName: company.name,
      profile: profile as TechRadarProfile,
      technology: opportunity.item.technology,
      vendor: opportunity.item.vendor,
      fitRationale: opportunity.fitRationale,
    });
    if (suggestion) {
      await prisma.techOpportunity.update({
        where: { id: opportunity.id },
        data: { contactSuggestion: suggestion },
      });
    }
  }

  /** Record the reason so the screen can state it instead of guessing. */
  async function block(reason: DraftBlockReason) {
    await prisma.techOpportunity.update({
      where: { id: opportunity.id },
      data: { blockReason: reason },
    });
    return { created: 0, owners: owners.length, blockedBy: reason };
  }

  // Nobody senior anywhere in the org at this company.
  if (senior.length === 0) {
    await recordSuggestion();
    return block("no_senior_contact");
  }

  // Checked before any ranking or drafting, because the LLM calls below are the
  // expensive part and a company that already has its one recipient needs none of them.
  const alreadyRecipients = await prisma.techOpportunityDraft.count({
    where: { opportunityId: opportunity.id, status: { in: [...CLAIMS_A_RECIPIENT_SLOT] } },
  });
  if (alreadyRecipients >= MAX_RECIPIENTS_PER_ITEM_PER_COMPANY) {
    return block("recipient_cap_reached");
  }
  let recipientSlots = MAX_RECIPIENTS_PER_ITEM_PER_COMPANY - alreadyRecipients;

  const contactsByOwner = new Map<string, typeof allContacts>();
  for (const contact of senior) {
    const list = contactsByOwner.get(contact.ownerId);
    if (list) list.push(contact);
    else contactsByOwner.set(contact.ownerId, [contact]);
  }

  let created = 0;
  // Distinguishing "no role match" from "everyone is full" is the whole point of the
  // recommendation: the first is a gap in their contact list, the second is not.
  let anyRanked = false;
  let anyCapped = false;

  // Only owners who actually have somebody there cost anything from here on.
  for (const [ownerId, ownerContacts] of contactsByOwner) {
    if (recipientSlots <= 0) break;
    const contacts = ownerContacts.slice(0, CANDIDATE_CAP);

    const candidates: RecipientCandidate[] = contacts.map((c) => ({
      contactId: c.id,
      fullName: c.fullName,
      hebrewFirstName: c.hebrewFirstName,
      currentTitle: c.currentTitle,
      headline: c.headline,
    }));
    const ranked = await rankRecipients(opportunity.item, candidates);
    if (ranked.length > 0) anyRanked = true;
    const byId = new Map(contacts.map((c) => [c.id, c]));

    for (const pick of ranked) {
      if (recipientSlots <= 0) break;
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
      if (openDrafts >= MAX_OPEN_DRAFTS_PER_CONTACT) {
        anyCapped = true;
        continue;
      }

      const message = await draftTechMessage({
        contactFullName: contact.fullName,
        hebrewFirstName: contact.hebrewFirstName,
        contactTitle: contact.currentTitle,
        companyName: company.name,
        technology: opportunity.item.technology,
        vendor: opportunity.item.vendor,
        // The rationale, not the item summary — this is what makes it specific.
        fitRationale: opportunity.fitRationale,
        sourceUrl: firstSourceUrl(opportunity.item.sources),
        itemText: `${opportunity.item.title}\n${opportunity.item.summary ?? ""}`,
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
      recipientSlots -= 1;
    }
  }

  if (created > 0) {
    await prisma.techOpportunity.update({
      where: { id: opportunity.id },
      data: { status: "DRAFTED", blockReason: null },
    });
    return { created, owners: owners.length, blockedBy: null };
  }

  // Nothing was drafted. If the ranker found nobody suitable, the company is missing a
  // role and knowing which one is worth more than the opportunity itself. If it did find
  // people and they were merely full, their contact list is fine — recommending a role
  // there would be noise.
  if (!anyRanked) {
    await recordSuggestion();
    return block("no_role_match");
  }
  return block(anyCapped ? "contacts_at_capacity" : "no_role_match");
}
