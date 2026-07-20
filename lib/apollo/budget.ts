import { prisma } from "@/lib/prisma";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

export interface BudgetStatus {
  allowed: boolean;
  creditsUsed: number;
  creditsRemaining: number;
  month: string;
}

/**
 * Check whether the org has budget remaining for this month.
 * Does NOT increment. Call incrementBudget() after a successful API call.
 */
export async function checkBudget(
  orgId: string,
  monthlyLimit: number
): Promise<BudgetStatus> {
  const month = currentMonth();
  const spend = await prisma.enrichmentSpend.findUnique({
    where: { orgId_month: { orgId, month } },
  });
  const creditsUsed = spend?.credits ?? 0;
  const allowed = creditsUsed < monthlyLimit;
  return {
    allowed,
    creditsUsed,
    creditsRemaining: Math.max(0, monthlyLimit - creditsUsed),
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
 * Increment the org's enrichment spend for the current month by the ACTUAL
 * credits consumed (see enrichmentCreditCost). Uses upsert so it is safe to
 * call even if no spend record exists yet.
 */
export async function incrementBudget(orgId: string, credits = 1): Promise<void> {
  const month = currentMonth();
  await prisma.enrichmentSpend.upsert({
    where: { orgId_month: { orgId, month } },
    create: { orgId, month, credits },
    update: { credits: { increment: credits } },
  });
}
