import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { lookupHebrew } from "@/lib/enrichment/name-lookup";
// Model-based translation (gemini-names.translateNames) is intentionally NOT
// called anymore — every name is resolved from the existing translation corpus,
// and the tiny residue is translated by a human. The `NameInput` type is still
// used to shape the per-batch "needs translation" list.
import { type NameInput } from "@/lib/enrichment/gemini-names";

const BATCH = 200;

// Nightly cron: find every user with contacts missing hebrewFirstName and fan out
export const enrichContactsHebrewNamesScheduled = inngest.createFunction(
  { id: "enrich-contacts-hebrew-names-scheduled", name: "Enrich contacts — Hebrew names (nightly)", triggers: [{ cron: "0 2 * * *" }] },
  async ({ step }: any) => {
    // Seed the shared NameTranslation cache from every translation that already
    // exists on a Contact (any tenant). Many were filled manually or via import
    // and never landed in the cache; this "searches existing users" once per
    // night so downstream runs resolve them for free instead of via the model.
    // Idempotent: only inserts new keys, never touches Contact. Where one name
    // has conflicting translations, the most frequent value wins.
    await step.run("seed-name-cache-from-contacts", () =>
      prisma.$executeRaw`
        INSERT INTO "NameTranslation" ("firstName", "hebrewFirstName")
        SELECT key, hebrew FROM (
          SELECT key, "hebrewFirstName" AS hebrew,
                 row_number() OVER (PARTITION BY key ORDER BY count(*) DESC) AS rn
          FROM (
            SELECT lower((regexp_split_to_array(btrim("fullName"), '\\s+'))[1]) AS key,
                   "hebrewFirstName"
            FROM "Contact"
            WHERE "removedAt" IS NULL
              AND "hebrewFirstName" IS NOT NULL
              AND "hebrewFirstName" <> ''
              AND "fullName" IS NOT NULL
              AND btrim("fullName") <> ''
          ) s
          WHERE key IS NOT NULL AND key <> ''
          GROUP BY key, "hebrewFirstName"
        ) r
        WHERE r.rn = 1
        ON CONFLICT ("firstName") DO NOTHING
      `,
    );

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
    let unresolved = 0;

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

          // 0. The person's own Hebrew spelling wins when the fullName embeds it
          // (e.g. "Irit Filipowicz עירית פיליפוביץ" — her spelling is עירית, not אירית).
          // LinkedIn bilingual names put the Hebrew given name first, so take the
          // first Hebrew token. Not cached: this is a per-person choice, not a rule.
          const hebrewToken = c.fullName.match(/[֐-׿][֐-׿'׳״"-]+/)?.[0];
          if (hebrewToken) {
            await prisma.contact.update({ where: { id: c.id }, data: { hebrewFirstName: hebrewToken } });
            batchFromLookup++;
            continue;
          }

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

        if (needsTranslation.length === 0) return { fromLookup: batchFromLookup, fromUnresolved: 0 };

        // 4. No model call. Any name not resolved by the cache layers above is
        //    genuinely new (never translated on any contact). Record it once in
        //    the global cache with the empty-string sentinel so it is (a) not
        //    re-scanned every night and (b) surfaced as the residue a human
        //    translates manually:
        //      SELECT "firstName" FROM "NameTranslation" WHERE "hebrewFirstName" = ''
        //    Once a human fills it, the next run resolves every dependent contact.
        const seenKeys = new Set<string>();
        let batchUnresolved = 0;
        for (const input of needsTranslation) {
          const key = input.firstName.toLowerCase();
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          await prisma.nameTranslation.upsert({
            where: { firstName: key },
            update: {}, // create-only: never clobber a translation added meanwhile
            create: { firstName: key, hebrewFirstName: "" },
          });
          negativeCache.add(key);
          batchUnresolved++;
        }

        return { fromLookup: batchFromLookup, fromUnresolved: batchUnresolved };
      });

      fromLookup += result.fromLookup;
      unresolved += result.fromUnresolved;
    }

    return { processed: contactIds.length, fromLookup, unresolved };
  },
);
