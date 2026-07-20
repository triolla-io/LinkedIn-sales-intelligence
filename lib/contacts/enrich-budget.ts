import { prisma } from "@/lib/prisma";

type Params = {
  effectiveUserId: string;
  orgId: string;
  monthlyApolloBudget: number;
  contactIds: string[];
};

export async function selectEnrichableContacts(params: Params) {
  const { effectiveUserId, orgId, monthlyApolloBudget, contactIds } = params;

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, ownerId: effectiveUserId },
    select: { id: true },
  });

  const month = new Date().toISOString().slice(0, 7);
  const spend = await prisma.enrichmentSpend.findUnique({
    where: { orgId_month: { orgId, month } },
  });
  const creditsRemaining = monthlyApolloBudget - (spend?.credits ?? 0);
  if (creditsRemaining <= 0) return { budgetExhausted: true as const };

  const validIds = contacts.map((c) => c.id).slice(0, creditsRemaining);
  return {
    validIds,
    skipped: contacts.length - validIds.length,
    creditsRemaining: creditsRemaining - validIds.length,
  };
}
