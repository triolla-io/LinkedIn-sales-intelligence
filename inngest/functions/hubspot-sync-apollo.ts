import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { upsertContact } from "@/lib/hubspot/client";

export const hubspotSyncApollo = inngest.createFunction(
  {
    id: "hubspot-sync-apollo",
    name: "Sync Apollo-enriched contacts to HubSpot",
    triggers: [{ cron: "0 3 * * *" }],
  },
  async () => {
    // Fetch apollo-sourced, non-removed contacts where hubspotSyncedAt is null.
    // Prisma 7 does not support column-to-column comparisons in where clauses
    // (prisma.contact.fields.enrichedAt is not a valid filter value), so we use
    // the JS-filter fallback: fetch with hubspotSyncedAt null OR any value, then
    // filter in JS for enrichedAt > hubspotSyncedAt.
    const candidates = await prisma.contact.findMany({
      where: {
        enrichmentSource: "apollo",
        removedAt: null,
      },
      select: {
        id: true,
        linkedinUrl: true,
        email: true,
        phone: true,
        currentCompany: true,
        industry: true,
        enrichedAt: true,
        hubspotSyncedAt: true,
      },
      take: 200,
      orderBy: { enrichedAt: "asc" },
    });

    // JS-filter: keep contacts where hubspotSyncedAt is null OR enrichedAt is more recent
    const contacts = candidates.filter(
      (c) => c.hubspotSyncedAt === null || (c.enrichedAt !== null && c.enrichedAt > c.hubspotSyncedAt)
    );

    let synced = 0;
    let failed = 0;

    for (const c of contacts) {
      const result = await upsertContact({
        linkedinUrl: c.linkedinUrl,
        email: c.email,
        mobilePhone: c.phone,
        company: c.currentCompany,
        industry: c.industry,
      });

      if (result.ok) {
        await prisma.contact.update({ where: { id: c.id }, data: { hubspotSyncedAt: new Date() } });
        synced++;
      } else {
        failed++;
      }
    }

    return { synced, failed };
  }
);
