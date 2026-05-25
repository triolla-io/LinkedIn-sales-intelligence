import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchPerson } from "@/lib/apollo/client";
import { checkBudget, incrementBudget } from "@/lib/apollo/budget";
import { lookupContact } from "@/lib/hubspot/client";

export const enrichContact = inngest.createFunction(
  { id: "enrich-contact", triggers: [{ event: "enrich.contact" as const }] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId } = event.data as { contactId: string; actorId: string };

    const { contact, orgId, monthlyApolloBudget } = await step.run("load-contact", async () => {
      const c = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { owner: { include: { org: true } } },
      });
      if (!c) throw new Error(`Contact ${contactId} not found`);
      return { contact: c, orgId: c.owner.orgId, monthlyApolloBudget: c.owner.org.monthlyApolloBudget };
    });

    // Try HubSpot first — skip Apollo if we already have the data
    const hubspotResult = await step.run("hubspot-lookup", async () => {
      return lookupContact({
        linkedinUrl: contact.linkedinUrl,
        fullName: contact.fullName,
        company: contact.currentCompany ?? undefined,
      });
    });

    if (hubspotResult?.email || hubspotResult?.phone) {
      await step.run("save-hubspot-results", async () => {
        const protected_ = new Set(contact.manualFields as string[]);
        const patch: Record<string, unknown> = {
          enrichedAt: new Date(),
          enrichmentSource: "hubspot",
          enrichmentRanAt: new Date(),
          enrichmentError: null,
          enrichmentLog: null,
        };
        if (!protected_.has("email") && hubspotResult.email)
          patch.email = hubspotResult.email;
        if (!protected_.has("phone") && hubspotResult.phone)
          patch.phone = hubspotResult.phone;
        await prisma.contact.update({ where: { id: contactId }, data: patch });
      });

      return {
        contactId,
        email: hubspotResult.email,
        phone: hubspotResult.phone,
        source: "hubspot",
      };
    }

    // HubSpot had nothing — check Apollo budget before calling Apollo
    await step.run("check-apollo-budget", async () => {
      const budget = await checkBudget(orgId, monthlyApolloBudget);
      if (!budget.allowed) throw new Error("BUDGET_EXHAUSTED");
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
    return { contactId, email, phone, companySize, source: "apollo" };
  }
);
