import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";
import { publish } from "@/lib/linkedin/sse-bus";

export const enrichContact = inngest.createFunction(
  { id: "enrich-contact", triggers: [{ event: "enrich.contact" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId, actorId } = event.data as { contactId: string; actorId: string };

    const contact = await step.run("load-contact", async () => {
      const c = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { owner: { include: { org: true } } },
      });
      if (!c) throw new Error(`Contact ${contactId} not found`);
      return c;
    });

    const orgId = contact.owner.orgId;
    const org = contact.owner.org;
    const month = new Date().toISOString().slice(0, 7);

    await step.run("check-budget", async () => {
      const spend = await prisma.enrichmentSpend.findUnique({
        where: { orgId_month: { orgId, month } },
      });
      const credits = spend?.credits ?? 0;
      if (credits >= org.monthlyApolloBudget) {
        throw new Error("BUDGET_EXHAUSTED");
      }
    });

    const result = await step.run("match-person", async () => {
      return matchPerson({
        name: contact.fullName,
        company: contact.currentCompany ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
      });
    });

    const { email, phone, companySize, currentCompany, industry } = result;

    await step.run("update-contact", async () => {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(companySize ? { companySize } : {}),
          ...(currentCompany && !contact.currentCompany ? { currentCompany } : {}),
          ...(industry && !contact.industry ? { industry } : {}),
          enrichedAt: new Date(),
          enrichmentSource: "apollo",
        },
      });
    });

    await step.run("increment-spend", async () => {
      await prisma.enrichmentSpend.upsert({
        where: { orgId_month: { orgId, month } },
        create: { orgId, month, credits: 1 },
        update: { credits: { increment: 1 } },
      });
    });

    await step.run("publish-sse", async () => {
      publish(contact.ownerId, { type: "contact:enriched", data: { contactId, email, phone, companySize } });
    });

    return { contactId, email, phone, companySize };
  }
);
