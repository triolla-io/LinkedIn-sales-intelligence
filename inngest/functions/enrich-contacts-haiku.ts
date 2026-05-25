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

    const contacts = await step.run("load-contacts-with-gaps", () =>
      prisma.contact.findMany({
        where: {
          ownerId,
          removedAt: null,
          OR: [{ hebrewFirstName: null }, { companySize: null }],
        },
        select: {
          id: true,
          fullName: true,
          currentCompany: true,
          companySize: true,
          companyId: true,
          hebrewFirstName: true,
          company: { select: { id: true, staffCount: true } },
        },
      }),
    );

    if (contacts.length === 0) return { processed: 0 };

    // ── Step 1: fill hebrewFirstName from DB name cache ──────────────────────
    // Build a map of firstName → hebrewFirstName from contacts that already have it
    const existingTranslations = await step.run("load-name-cache", () =>
      prisma.contact.findMany({
        where: { ownerId, hebrewFirstName: { not: null } },
        select: { fullName: true, hebrewFirstName: true },
      }),
    );

    const nameCache = new Map<string, string>();
    for (const c of existingTranslations) {
      const fn = c.fullName.trim().split(/\s+/)[0];
      if (fn && c.hebrewFirstName) nameCache.set(fn, c.hebrewFirstName);
    }

    // ── Step 2: fill companySize from Company.staffCount where possible ───────
    const dbFills: Array<{ id: string; hebrewFirstName?: string; companySize?: number }> = [];

    for (const contact of contacts) {
      const fill: { id: string; hebrewFirstName?: string; companySize?: number } = { id: contact.id };

      if (!contact.hebrewFirstName) {
        const fn = contact.fullName.trim().split(/\s+/)[0];
        const cached = fn ? nameCache.get(fn) : undefined;
        if (cached) fill.hebrewFirstName = cached;
      }

      if (!contact.companySize && contact.company?.staffCount) {
        fill.companySize = contact.company.staffCount;
      }

      if (fill.hebrewFirstName || fill.companySize) dbFills.push(fill);
    }

    if (dbFills.length > 0) {
      await step.run("apply-db-fills", async () => {
        for (const fill of dbFills) {
          await prisma.contact.update({
            where: { id: fill.id },
            data: {
              ...(fill.hebrewFirstName ? { hebrewFirstName: fill.hebrewFirstName } : {}),
              ...(fill.companySize != null ? { companySize: fill.companySize } : {}),
            },
          });
        }
      });
    }

    // Refresh state after DB fills
    type ContactRow = {
      id: string;
      fullName: string;
      currentCompany: string | null;
      companySize: number | null;
      companyId: string | null;
      hebrewFirstName: string | null;
      company: { id: string; staffCount: number | null } | null;
    };

    const dbFillIds = new Set(dbFills.map((f) => f.id));
    const fullyResolved = new Set(
      (contacts as ContactRow[])
        .map((c) => {
          const fill = dbFills.find((f) => f.id === c.id);
          const nowHasHebrew = c.hebrewFirstName || fill?.hebrewFirstName;
          const nowHasSize = c.companySize || fill?.companySize;
          return (!nowHasHebrew || !nowHasSize) ? null : c.id;
        })
        .filter(Boolean),
    );

    const needsHaiku = (contacts as ContactRow[]).filter((c) => !fullyResolved.has(c.id));

    if (needsHaiku.length === 0) return { processed: contacts.length };

    // ── Step 3: Haiku batches ─────────────────────────────────────────────────
    let haikuProcessed = 0;

    for (let i = 0; i < needsHaiku.length; i += BATCH) {
      const batch = needsHaiku.slice(i, i + BATCH);

      await step.run(`haiku-batch-${i}`, async () => {
        const inputs: HaikuInput[] = batch.map((c: ContactRow) => {
          const fill = dbFills.find((f) => f.id === c.id);
          const hasHebrew = !!(c.hebrewFirstName || fill?.hebrewFirstName);
          const hasSize = !!(c.companySize || fill?.companySize);
          const fn = c.fullName.trim().split(/\s+/)[0];
          return {
            id: c.id,
            firstName: fn,
            company: c.currentCompany,
            needsHebrew: !hasHebrew,
            needsSize: !hasSize,
          };
        });

        const results = await enrichBatch(inputs);

        for (const r of results) {
          const contact = batch.find((c: ContactRow) => c.id === r.id);
          if (!contact) continue;

          const midpoint = r.companySizeRange ? sizeRangeToMidpoint(r.companySizeRange) : null;

          await prisma.contact.update({
            where: { id: r.id },
            data: {
              ...(r.hebrewFirstName ? { hebrewFirstName: r.hebrewFirstName } : {}),
              ...(midpoint != null && !contact.companySize ? { companySize: midpoint } : {}),
            },
          });

          // Update Company.staffCount if contact has a company and it's missing
          if (midpoint != null && contact.companyId && !contact.company?.staffCount) {
            await prisma.company.updateMany({
              where: { id: contact.companyId, staffCount: null },
              data: { staffCount: midpoint },
            });
          }
        }

        haikuProcessed += results.length;
      });
    }

    return { processed: contacts.length, fromDb: dbFills.length, fromHaiku: haikuProcessed };
  },
);
