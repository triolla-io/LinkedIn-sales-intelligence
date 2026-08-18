import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichContactCore } from "@/lib/enrichment/enrich-contact-core";

export const enrichContact = inngest.createFunction(
  {
    id: "enrich-contact",
    // Serialise per owner. Without this a bulk fan-out runs dozens of enrichments
    // concurrently, all passing the budget check before any of them increments —
    // which lets real spend sail past both the per-user quota and the org pool.
    concurrency: { limit: 1, key: "event.data.ownerId" },
    triggers: [{ event: "enrich.contact" as const }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { contactId } = event.data as { contactId: string; ownerId?: string; actorId: string };

    const { contact, orgId, ownerId, monthlyApolloBudget, perUserMonthlyApolloCredits } =
      await step.run("load-contact", async () => {
        const c = await prisma.contact.findUnique({
          where: { id: contactId },
          include: { owner: { include: { org: true } } },
        });
        if (!c) throw new Error(`Contact ${contactId} not found`);
        // Charge the contact's owner, not whoever triggered the run, so an admin
        // enriching on someone's behalf spends that person's quota.
        return {
          contact: c,
          orgId: c.owner.orgId,
          ownerId: c.ownerId,
          monthlyApolloBudget: c.owner.org.monthlyApolloBudget,
          perUserMonthlyApolloCredits: c.owner.org.perUserMonthlyApolloCredits,
        };
      });

    // Same cascade as the synchronous drawer route: HubSpot → cache → Apollo,
    // with cache read+write and per-contact error capture. Runs inside a single
    // step so Inngest retries the whole cascade atomically on transient failure.
    const result = await step.run("enrich", () =>
      enrichContactCore({
        contact,
        orgId,
        ownerId,
        monthlyApolloBudget,
        perUserMonthlyApolloCredits,
      })
    );

    if (result.status === "budget_exhausted") {
      return { contactId, source: "none", skipped: "budget_exhausted", blockedBy: result.blockedBy };
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
