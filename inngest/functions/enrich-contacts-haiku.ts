import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichBatch, sizeRangeToMidpoint, type HaikuInput } from "@/lib/enrichment/haiku-enrichment";

const BATCH = 20;

export const enrichContactsHaiku = inngest.createFunction(
  {
    id: "enrich-contacts-haiku",
    name: "Enrich contacts via Haiku (Hebrew names + company size)",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "contacts.enrich-haiku" as const }],
  },
  async ({ event, step }: any) => {
    const { ownerId } = event.data as { ownerId: string };

    // Return only IDs to stay under Inngest step output size limit
    const contactIds = await step.run("load-contact-ids", () =>
      prisma.contact.findMany({
        where: { ownerId, removedAt: null, OR: [{ hebrewFirstName: null }, { companySize: null }] },
        select: { id: true },
      }).then((rows: { id: string }[]) => rows.map((r) => r.id)),
    );

    if (contactIds.length === 0) return { processed: 0 };

    // Build name cache: firstName → hebrewFirstName (also IDs only passed via step)
    const nameCache: Record<string, string> = await step.run("build-name-cache", async () => {
      const existing = await prisma.contact.findMany({
        where: { ownerId, hebrewFirstName: { not: null } },
        select: { fullName: true, hebrewFirstName: true },
      });
      const cache: Record<string, string> = {};
      for (const c of existing) {
        const fn = c.fullName.trim().split(/\s+/)[0];
        if (fn && c.hebrewFirstName) cache[fn] = c.hebrewFirstName;
      }
      return cache;
    });

    // Process in batches — each batch loads its own data fresh from DB
    let fromDb = 0;
    let fromHaiku = 0;

    for (let i = 0; i < contactIds.length; i += BATCH) {
      const batchIds = contactIds.slice(i, i + BATCH);

      const batchResult = await step.run(`batch-${i}`, async () => {
        const contacts = await prisma.contact.findMany({
          where: { id: { in: batchIds } },
          select: {
            id: true,
            fullName: true,
            currentCompany: true,
            companySize: true,
            companyId: true,
            hebrewFirstName: true,
            company: { select: { id: true, staffCount: true } },
          },
        });

        let batchFromDb = 0;
        let batchFromHaiku = 0;

        // Fill from DB first (name cache + Company.staffCount)
        const needsHaiku: typeof contacts = [];

        for (const c of contacts) {
          const dbPatch: { hebrewFirstName?: string; companySize?: number } = {};

          if (!c.hebrewFirstName) {
            const fn = c.fullName.trim().split(/\s+/)[0];
            if (fn && nameCache[fn]) dbPatch.hebrewFirstName = nameCache[fn];
          }

          if (!c.companySize && c.company?.staffCount) {
            dbPatch.companySize = c.company.staffCount;
          }

          if (Object.keys(dbPatch).length > 0) {
            await prisma.contact.update({ where: { id: c.id }, data: dbPatch });
            batchFromDb++;
          }

          const nowHasHebrew = c.hebrewFirstName || dbPatch.hebrewFirstName;
          const nowHasSize = c.companySize || dbPatch.companySize;
          if (!nowHasHebrew || !nowHasSize) needsHaiku.push(c);
        }

        if (needsHaiku.length === 0) return { fromDb: batchFromDb, fromHaiku: 0 };

        // Call Haiku for remaining gaps
        const inputs: HaikuInput[] = needsHaiku.map((c) => ({
          id: c.id,
          firstName: c.fullName.trim().split(/\s+/)[0],
          company: c.currentCompany,
          needsHebrew: !c.hebrewFirstName,
          needsSize: !c.companySize,
        }));

        const results = await enrichBatch(inputs);

        for (const r of results) {
          const contact = needsHaiku.find((c) => c.id === r.id);
          if (!contact) continue;

          const midpoint = r.companySizeRange ? sizeRangeToMidpoint(r.companySizeRange) : null;

          await prisma.contact.update({
            where: { id: r.id },
            data: {
              ...(r.hebrewFirstName ? { hebrewFirstName: r.hebrewFirstName } : {}),
              ...(midpoint != null && !contact.companySize ? { companySize: midpoint } : {}),
            },
          });

          if (midpoint != null && contact.companyId && !contact.company?.staffCount) {
            await prisma.company.updateMany({
              where: { id: contact.companyId, staffCount: null },
              data: { staffCount: midpoint },
            });
          }

          batchFromHaiku++;
        }

        return { fromDb: batchFromDb, fromHaiku: batchFromHaiku };
      });

      fromDb += batchResult.fromDb;
      fromHaiku += batchResult.fromHaiku;
    }

    return { processed: contactIds.length, fromDb, fromHaiku };
  },
);
