import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichContactCore } from "@/lib/enrichment/enrich-contact-core";

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

    // Same cascade as the synchronous drawer route: HubSpot → cache → Apollo,
    // with cache read+write and per-contact error capture. Runs inside a single
    // step so Inngest retries the whole cascade atomically on transient failure.
    const result = await step.run("enrich", () =>
      enrichContactCore({ contact, orgId, monthlyApolloBudget })
    );

    if (result.status === "budget_exhausted") {
      return { contactId, source: "none", skipped: "budget_exhausted" };
    }
    if (result.status === "apollo_error") {
      // Error is persisted to contact.enrichmentError by the core and surfaces
      // in the contact drawer; return it so it shows in the Inngest run log too.
      return { contactId, source: "error", error: result.error };
    }

    return {
      contactId,
      source: result.source,
      email: result.email,
      phone: result.phone,
      companySize: result.companySize,
    };
  }
);
