import { prisma } from "@/lib/prisma";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

export interface BudgetStatus {
  allowed: boolean;
  /** Which ceiling stopped this call. `org` wins when both are exhausted. */
  blockedBy: "org" | "user" | null;
  /** Credits the whole org has burned this month (the shared pool). */
  creditsUsed: number;
  /** Effective headroom: min(org pool left, this user's quota left). */
  creditsRemaining: number;
  orgRemaining: number;
  userRemaining: number;
  month: string;
}

/**
 * Check whether an enrichment may run, against BOTH ceilings:
 *   - the shared monthly org pool (Organization.monthlyApolloBudget), and
 *   - the per-user monthly quota (Organization.perUserMonthlyApolloCredits),
 * so a single user cannot drain the pool everyone shares.
 *
 * Does NOT increment. Call incrementBudget() after a successful API call.
 */
export async function checkEnrichmentBudget(params: {
  orgId: string;
  userId: string;
  orgLimit: number;
  userLimit: number;
}): Promise<BudgetStatus> {
  const { orgId, userId, orgLimit, userLimit } = params;
  const month = currentMonth();

  const [orgSpend, userSpend] = await Promise.all([
    prisma.enrichmentSpend.findUnique({ where: { orgId_month: { orgId, month } } }),
    prisma.userEnrichmentSpend.findUnique({ where: { userId_month: { userId, month } } }),
  ]);

  const creditsUsed = orgSpend?.credits ?? 0;
  const userUsed = userSpend?.credits ?? 0;
  const orgRemaining = Math.max(0, orgLimit - creditsUsed);
  const userRemaining = Math.max(0, userLimit - userUsed);

  // Report the org as the blocker when both are out: it affects every user and
  // is the one an admin has to act on.
  const blockedBy = orgRemaining <= 0 ? "org" : userRemaining <= 0 ? "user" : null;

  return {
    allowed: blockedBy === null,
    blockedBy,
    creditsUsed,
    creditsRemaining: Math.min(orgRemaining, userRemaining),
    orgRemaining,
    userRemaining,
    month,
  };
}

/**
 * Real Apollo credit cost of an enrichment result. A people/match email reveal
 * costs ~1 credit; a revealed mobile ("Waterfall Enriched Mobile Number") costs
 * 8 more. The old counter always charged 1, which let real spend run ~9x past
 * the configured monthly budget. A match that returned nothing still costs 1.
 */
export function enrichmentCreditCost(r: { email?: string | null; phone?: string | null }): number {
  const emailCost = r.email ? 1 : 0;
  const phoneCost = r.phone ? 8 : 0;
  return Math.max(1, emailCost + phoneCost);
}

/**
 * Charge the ACTUAL credits consumed (see enrichmentCreditCost) to both the org
 * pool and the spending user, in ONE transaction so the two counters can never
 * drift apart. Credits are charged to the contact's OWNER, not an acting admin.
 * Upserts, so it is safe to call before any spend row exists.
 */
export async function incrementBudget(params: {
  orgId: string;
  userId: string;
  credits?: number;
}): Promise<void> {
  const { orgId, userId, credits = 1 } = params;
  const month = currentMonth();
  await prisma.$transaction([
    prisma.enrichmentSpend.upsert({
      where: { orgId_month: { orgId, month } },
      create: { orgId, month, credits },
      update: { credits: { increment: credits } },
    }),
    prisma.userEnrichmentSpend.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, orgId, month, credits },
      update: { credits: { increment: credits } },
    }),
  ]);
}
