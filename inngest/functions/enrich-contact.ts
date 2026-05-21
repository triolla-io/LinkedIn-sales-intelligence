import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";

export const enrichContact = inngest.createFunction(
  { id: "enrich-contact", triggers: [{ event: "enrich.contact" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId } = event.data as { contactId: string; actorId: string };

    const { contact, orgId, month } = await step.run("load-and-check", async () => {
      const c = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { owner: { include: { org: true } } },
      });
      if (!c) throw new Error(`Contact ${contactId} not found`);

      const orgId = c.owner.orgId;
      const month = new Date().toISOString().slice(0, 7);
      const spend = await prisma.enrichmentSpend.findUnique({
        where: { orgId_month: { orgId, month } },
      });
      const credits = spend?.credits ?? 0;
      if (credits >= c.owner.org.monthlyApolloBudget) {
        throw new Error("BUDGET_EXHAUSTED");
      }

      return { contact: c, orgId, month };
    });

    const result = await step.run("match-person", async () => {
      return matchPerson({
        name: contact.fullName,
        company: contact.currentCompany ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
      });
    });

    await step.run("save-results", async () => {
      const { email, phone, companySize, currentCompany, industry } = result;
      const protected_ = new Set(contact.manualFields as string[]);

      const patch: Record<string, unknown> = {};
      if (!protected_.has("email") && email) patch.email = email;
      if (!protected_.has("phone") && phone) patch.phone = phone;
      if (companySize) patch.companySize = companySize;
      if (!protected_.has("currentCompany") && currentCompany && !contact.currentCompany)
        patch.currentCompany = currentCompany;
      if (!protected_.has("industry") && industry && !contact.industry)
        patch.industry = industry;
      patch.enrichedAt = new Date();
      patch.enrichmentSource = "apollo";

      await prisma.$transaction([
        prisma.contact.update({ where: { id: contactId }, data: patch }),
        prisma.enrichmentSpend.upsert({
          where: { orgId_month: { orgId, month } },
          create: { orgId, month, credits: 1 },
          update: { credits: { increment: 1 } },
        }),
      ]);
    });

    const { email, phone, companySize } = result;
    return { contactId, email, phone, companySize };
  }
);
