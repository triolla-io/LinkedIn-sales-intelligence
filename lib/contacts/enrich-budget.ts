import { prisma } from "@/lib/prisma";
import { checkEnrichmentBudget } from "@/lib/apollo/budget";

type Params = {
  effectiveUserId: string;
  orgId: string;
  monthlyApolloBudget: number;
  perUserMonthlyApolloCredits: number;
  contactIds: string[];
};

/**
 * Pick which of the requested contacts may be queued for paid enrichment.
 *
 * The slice below is an OPTIMISTIC pre-filter (1 contact ≈ 1 credit) so a bulk
 * click doesn't queue hundreds of jobs that would all bail on budget. A full
 * reveal actually costs up to 9, so the real hard stop is the per-contact check
 * inside enrichContactCore, which re-reads both ceilings before every spend.
 */
export async function selectEnrichableContacts(params: Params) {
  const { effectiveUserId, orgId, monthlyApolloBudget, perUserMonthlyApolloCredits, contactIds } =
    params;

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, ownerId: effectiveUserId },
    select: { id: true },
  });

  const budget = await checkEnrichmentBudget({
    orgId,
    userId: effectiveUserId,
    orgLimit: monthlyApolloBudget,
    userLimit: perUserMonthlyApolloCredits,
  });
  if (budget.blockedBy) return { budgetExhausted: true as const, blockedBy: budget.blockedBy };

  // creditsRemaining is already min(org pool left, this user's quota left).
  const validIds = contacts.map((c) => c.id).slice(0, budget.creditsRemaining);
  return {
    validIds,
    skipped: contacts.length - validIds.length,
    creditsRemaining: budget.creditsRemaining - validIds.length,
  };
}
