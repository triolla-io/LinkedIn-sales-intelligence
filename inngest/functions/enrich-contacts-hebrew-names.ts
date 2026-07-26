import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { lookupHebrew } from "@/lib/enrichment/name-lookup";
import { translateNames, type NameInput } from "@/lib/enrichment/gemini-names";

const BATCH = 200;
const OR_BATCH = 50;

// Nightly cron: find every user with contacts missing hebrewFirstName and fan out
export const enrichContactsHebrewNamesScheduled = inngest.createFunction(
  { id: "enrich-contacts-hebrew-names-scheduled", name: "Enrich contacts — Hebrew names (nightly)", triggers: [{ cron: "0 2 * * *" }] },
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
          name: "contacts.enrich-hebrew-names" as const,
          data: { ownerId: u.id },
        })),
      ),
    );

    return { triggered: users.length };
  },
);

export const enrichContactsHebrewNames = inngest.createFunction(
  {
    id: "enrich-contacts-hebrew-names",
    name: "Enrich contacts — Hebrew names",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "contacts.enrich-hebrew-names" as const }],
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
    // Names the model could not transliterate this run — skip re-sending them.
    const negativeCache = new Set<string>();

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

          // 2b. In-memory negative cache — name proved unresolvable earlier this run.
          // Leave hebrewFirstName null and skip the Haiku call.
          if (negativeCache.has(key)) continue;

          // 3. Global DB cache (NameTranslation table — shared across all tenants).
          // Empty string is the "attempted, no transliteration" sentinel: skip the
          // Haiku call and leave hebrewFirstName null (cheap to re-scan, never re-billed).
          const dbCached = await prisma.nameTranslation.findUnique({ where: { firstName: key } });
          if (dbCached) {
            if (dbCached.hebrewFirstName === "") {
              negativeCache.add(key);
              continue;
            }
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

          const translated = new Map<string, string>(); // id -> hebrew (successes only)
          for (const r of results) {
            if (r.hebrewFirstName) translated.set(r.id, r.hebrewFirstName);
          }

          // Pass 1: persist successes. update overwrites any prior sentinel for this name.
          for (const input of chunk) {
            const hebrew = translated.get(input.id);
            if (!hebrew) continue;
            const key = input.firstName.toLowerCase();
            await prisma.contact.update({
              where: { id: input.id },
              data: { hebrewFirstName: hebrew },
            });
            // Persist to global cache so future runs skip the API call
            await prisma.nameTranslation.upsert({
              where: { firstName: key },
              update: { hebrewFirstName: hebrew },
              create: { firstName: key, hebrewFirstName: hebrew },
            });
            nameCache[key] = hebrew;
            batchFromOR++;
          }

          // Pass 2: negative-cache names the model could not transliterate, so tonight's
          // null is not re-sent to Haiku every night. create-only never clobbers a success.
          for (const input of chunk) {
            const key = input.firstName.toLowerCase();
            if (translated.has(input.id) || nameCache[key]) continue;
            await prisma.nameTranslation.upsert({
              where: { firstName: key },
              update: {},
              create: { firstName: key, hebrewFirstName: "" },
            });
            negativeCache.add(key);
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
