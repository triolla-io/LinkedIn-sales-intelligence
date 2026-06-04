import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { lookupHebrew } from "@/lib/enrichment/name-lookup";
import { translateNames, type NameInput } from "@/lib/enrichment/gemini-names";

const BATCH = 20;
const OR_BATCH = 50;

// Nightly cron: find every user with contacts missing hebrewFirstName and fan out
export const enrichContactsHaikuScheduled = inngest.createFunction(
  { id: "enrich-contacts-haiku-scheduled", name: "Enrich contacts — Hebrew names (nightly)", triggers: [{ cron: "0 2 * * *" }] },
  async ({ step }: any) => {
    const users = await step.run("find-users-with-missing-hebrew", () =>
      prisma.user.findMany({
        where: { contacts: { some: { hebrewFirstName: null, removedAt: null } } },
        select: { id: true },
      }),
    );

    await step.run("fan-out-events", () =>
      inngest.send(
        users.map((u: { id: string }) => ({
          name: "contacts.enrich-haiku" as const,
          data: { ownerId: u.id },
        })),
      ),
    );

    return { triggered: users.length };
  },
);

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

    // In-memory cache populated as we go (shared across batches within this run)
    const nameCache: Record<string, string> = {};

    let fromLookup = 0;
    let fromOpenRouter = 0;

    for (let i = 0; i < contactIds.length; i += BATCH) {
      const batchIds = contactIds.slice(i, i + BATCH);

      const result = await step.run(`batch-${i}`, async () => {
        const contacts = await prisma.contact.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, fullName: true, hebrewFirstName: true },
        });

        let batchFromLookup = 0;
        const needsTranslation: NameInput[] = [];

        for (const c of contacts) {
          if (c.hebrewFirstName) continue;

          const firstName = c.fullName.trim().split(/\s+/)[0];
          const key = firstName.toLowerCase();

          // 1. Static lookup table
          const fromTable = lookupHebrew(firstName);
          if (fromTable) {
            await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: fromTable } });
            nameCache[key] = fromTable;
            batchFromLookup++;
            continue;
          }

          // 2. In-memory cache (translations from earlier in this run)
          if (nameCache[key]) {
            await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: nameCache[key] } });
            batchFromLookup++;
            continue;
          }

          // 3. Global DB cache (NameTranslation table — shared across all tenants)
          const dbCached = await prisma.nameTranslation.findUnique({ where: { firstName: key } });
          if (dbCached) {
            await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: dbCached.hebrewFirstName } });
            nameCache[key] = dbCached.hebrewFirstName;
            batchFromLookup++;
            continue;
          }

          needsTranslation.push({ id: c.id, firstName });
        }

        if (needsTranslation.length === 0) return { fromLookup: batchFromLookup, fromOpenRouter: 0 };

        // 4. Translate via OpenRouter in sub-batches
        let batchFromOR = 0;
        for (let j = 0; j < needsTranslation.length; j += OR_BATCH) {
          const chunk = needsTranslation.slice(j, j + OR_BATCH);
          const results = await translateNames(chunk);

          for (const r of results) {
            if (!r.hebrewFirstName) continue;
            const input = chunk.find((n) => n.id === r.id);
            if (!input) continue;
            const key = input.firstName.toLowerCase();

            await prisma.contact.update({
              where: { id: r.id },
              data: { hebrewFirstName: r.hebrewFirstName },
            });
            // Persist to global cache so future runs skip the API call
            await prisma.nameTranslation.upsert({
              where: { firstName: key },
              update: {},
              create: { firstName: key, hebrewFirstName: r.hebrewFirstName },
            });
            nameCache[key] = r.hebrewFirstName;
            batchFromOR++;
          }
        }

        return { fromLookup: batchFromLookup, fromOpenRouter: batchFromOR };
      });

      fromLookup += result.fromLookup;
      fromOpenRouter += result.fromOpenRouter;
    }

    return { processed: contactIds.length, fromLookup, fromOpenRouter };
  },
);
