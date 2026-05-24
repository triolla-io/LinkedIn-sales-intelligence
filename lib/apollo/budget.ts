import { prisma } from "@/lib/prisma";

export function currentMonth(): string {
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
 * Increment the org's enrichment spend by 1 credit for the current month.
 * Uses upsert so it is safe to call even if no spend record exists yet.
 */
export async function incrementBudget(orgId: string): Promise<void> {
  const month = currentMonth();
  await prisma.enrichmentSpend.upsert({
    where: { orgId_month: { orgId, month } },
    create: { orgId, month, credits: 1 },
    update: { credits: { increment: 1 } },
  });
}
