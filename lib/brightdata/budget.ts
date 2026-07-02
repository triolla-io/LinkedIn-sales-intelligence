import { prisma } from "@/lib/prisma";

export const BRIGHTDATA_MONTHLY_LIMIT = 5000;

function brightDataMonthKey(): string {
  return `${new Date().toISOString().slice(0, 7)}:brightdata`; // "YYYY-MM:brightdata"
}

export async function brightDataRemaining(orgId: string): Promise<number> {
  const month = brightDataMonthKey();
  const spend = await prisma.enrichmentSpend.findUnique({
    where: { orgId_month: { orgId, month } },
  });
  const used = spend?.credits ?? 0;
  return Math.max(0, BRIGHTDATA_MONTHLY_LIMIT - used);
}

export async function addBrightDataSpend(orgId: string, count: number): Promise<void> {
  const month = brightDataMonthKey();
  await prisma.enrichmentSpend.upsert({
    where: { orgId_month: { orgId, month } },
    create: { orgId, month, credits: count },
    update: { credits: { increment: count } },
  });
}
