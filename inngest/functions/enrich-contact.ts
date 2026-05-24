import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";
import { checkBudget, incrementBudget } from "@/lib/apollo/budget";

export const enrichContact = inngest.createFunction(
  { id: "enrich-contact", triggers: [{ event: "enrich.contact" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId } = event.data as { contactId: string; actorId: string };

    const { contact, orgId } = await step.run("load-and-check", async () => {
      const c = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { owner: { include: { org: true } } },
      });
      if (!c) throw new Error(`Contact ${contactId} not found`);

      const orgId = c.owner.orgId;
      const budget = await checkBudget(orgId, c.owner.org.monthlyApolloBudget);
      if (!budget.allowed) throw new Error("BUDGET_EXHAUSTED");

      return { contact: c, orgId };
    });

    const result = await step.run("match-person", async () => {
      return matchPerson({
        name: contact.fullName,
        company: contact.currentCompany ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
      });
    });

    await step.run("save-results", async () => {
      const { email, phone, companySize, currentCompany, industry, raw } = result;
      const protected_ = new Set(contact.manualFields as string[]);

      const patch: Record<string, unknown> = {
        enrichedAt: new Date(),
        enrichmentSource: "apollo",
        enrichmentRanAt: new Date(),
        enrichmentError: null,
        enrichmentLog: raw ?? null,
      };
      if (!protected_.has("email") && email) patch.email = email;
      if (!protected_.has("phone") && phone) patch.phone = phone;
      if (companySize) patch.companySize = companySize;
      if (!protected_.has("currentCompany") && currentCompany && !contact.currentCompany)
        patch.currentCompany = currentCompany;
      if (!protected_.has("industry") && industry && !contact.industry)
        patch.industry = industry;

      await prisma.contact.update({ where: { id: contactId }, data: patch });
      await incrementBudget(orgId);
    });

    const { email, phone, companySize } = result;
    return { contactId, email, phone, companySize };
  }
);
