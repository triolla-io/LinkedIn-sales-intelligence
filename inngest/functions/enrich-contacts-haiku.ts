import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { lookupHebrew } from "@/lib/enrichment/name-lookup";
import { translateNames, type NameInput } from "@/lib/enrichment/gemini-names";

const BATCH = 20;
const GEMINI_BATCH = 50;

export const enrichContactsHaiku = inngest.createFunction(
  {
    id: "enrich-contacts-haiku",
    name: "Enrich contacts — Hebrew names",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "contacts.enrich-haiku" as const }],
  },
  async ({ event, step }: any) => {
    const { ownerId } = event.data as { ownerId: string };

    const contactIds = await step.run("load-contact-ids", () =>
      prisma.contact.findMany({
        where: { ownerId, removedAt: null, hebrewFirstName: null },
        select: { id: true },
      }).then((rows: { id: string }[]) => rows.map((r) => r.id)),
    );

    if (contactIds.length === 0) return { processed: 0 };

    // Build name cache from contacts already translated
    const nameCache: Record<string, string> = await step.run("build-name-cache", async () => {
      const existing = await prisma.contact.findMany({
        where: { ownerId, hebrewFirstName: { not: null } },
        select: { fullName: true, hebrewFirstName: true },
      });
      const cache: Record<string, string> = {};
      for (const c of existing) {
        const fn = c.fullName.trim().split(/\s+/)[0];
        if (fn && c.hebrewFirstName) cache[fn.toLowerCase()] = c.hebrewFirstName;
      }
      return cache;
    });

    let fromLookup = 0;
    let fromGemini = 0;

    for (let i = 0; i < contactIds.length; i += BATCH) {
      const batchIds = contactIds.slice(i, i + BATCH);

      const result = await step.run(`batch-${i}`, async () => {
        const contacts = await prisma.contact.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, fullName: true, hebrewFirstName: true },
        });

        let batchFromLookup = 0;
        const needsGemini: NameInput[] = [];

        for (const c of contacts) {
          if (c.hebrewFirstName) continue;

          const firstName = c.fullName.trim().split(/\s+/)[0];
          const key = firstName.toLowerCase();

          // 1. Check static lookup table
          const fromTable = lookupHebrew(firstName);
          if (fromTable) {
            await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: fromTable } });
            nameCache[key] = fromTable;
            batchFromLookup++;
            continue;
          }

          // 2. Check name cache (previously translated in this run)
          if (nameCache[key]) {
            await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: nameCache[key] } });
            batchFromLookup++;
            continue;
          }

          needsGemini.push({ id: c.id, firstName });
        }

        if (needsGemini.length === 0) return { fromLookup: batchFromLookup, fromGemini: 0 };

        // Translate unknown names in sub-batches of 50
        let batchFromGemini = 0;
        for (let j = 0; j < needsGemini.length; j += GEMINI_BATCH) {
          const chunk = needsGemini.slice(j, j + GEMINI_BATCH);
          const results = await translateNames(chunk);

          for (const r of results) {
            if (!r.hebrewFirstName) continue;
            await prisma.contact.update({
              where: { id: r.id },
              data: { hebrewFirstName: r.hebrewFirstName },
            });
            const input = chunk.find((n) => n.id === r.id);
            if (input) nameCache[input.firstName.toLowerCase()] = r.hebrewFirstName;
            batchFromGemini++;
          }
        }

        return { fromLookup: batchFromLookup, fromGemini: batchFromGemini };
      });

      fromLookup += result.fromLookup;
      fromGemini += result.fromGemini;
    }

    return { processed: contactIds.length, fromLookup, fromGemini };
  },
);
