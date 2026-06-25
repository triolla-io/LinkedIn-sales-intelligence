import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { classify } from "@/lib/classifier/seniority";
import { getIndustry } from "@/lib/classifier/industry";
import { slugifyCompany } from "@/lib/utils/slug-utils";
import { diffContacts, type IncomingContact } from "@/lib/csv/diff";
import { lookupContact } from "@/lib/hubspot/client";
import { normalizeLinkedinUrl, type ParsedContact } from "@/lib/csv/parse";
import { toIsraeliE164 } from "@/lib/phone/normalize";

const UPSERT_BATCH = 25;

export const importProcess = inngest.createFunction(
  {
    id: "import-process",
    name: "Process CSV import",
    triggers: [{ event: "import.process" as const }],
    concurrency: { limit: 1, key: "event.data.ownerId" },
    retries: 2,
    onFailure: async ({ event }: any) => {
      const importJobId = event?.data?.event?.data?.importJobId as string | undefined;
      const errorMessage: string = event?.data?.error?.message ?? "Import failed after retries";
      console.error("[import-process] onFailure", { importJobId, error: errorMessage, stack: event?.data?.error?.stack });
      if (!importJobId) return;
      await prisma.importJob
        .update({ where: { id: importJobId }, data: { status: "ERROR", error: errorMessage } })
        .catch(() => {});
    },
  },
  async ({ event, step }: any) => {
    const { importJobId } = event.data as { importJobId: string; ownerId: string };

    const job = await step.run("load-job", () =>
      prisma.importJob.findUnique({
        where: { id: importJobId },
        select: { status: true, ownerId: true, updateOnly: true, fileName: true },
      }),
    );
    if (!job) return { skipped: "job-not-found" };
    if (job.status === "DONE") return { skipped: "already-done" };

    const userId: string = job.ownerId;
    const updateOnly: boolean = job.updateOnly;

    // Fetch payload outside a step to avoid bloating step output with thousands of contacts.
    const rawJob = await prisma.importJob.findUnique({ where: { id: importJobId }, select: { payload: true } });
    const contacts = (rawJob?.payload ?? []) as unknown as ParsedContact[];

    const prep = await step.run("prepare-diff", async () => {
      await prisma.importJob.update({
        where: { id: importJobId },
        data: { status: "PROCESSING", stage: "contacts" },
      });

      const existingRows = await prisma.contact.findMany({
        where: { ownerId: userId, removedAt: null },
        select: { linkedinUrn: true, fullName: true, currentTitle: true, currentCompany: true, companySize: true },
      });
      const existingMap = new Map(
        existingRows.map((r) => [r.linkedinUrn, {
          fullName: r.fullName, currentTitle: r.currentTitle, currentCompany: r.currentCompany, companySize: r.companySize,
        }] as const),
      );
      const incoming: IncomingContact[] = contacts.map((c) => ({
        linkedinUrn: c.linkedinUrn, fullName: c.fullName, currentTitle: c.currentTitle,
        currentCompany: c.currentCompany, companySize: c.companySize,
      }));
      const diff = diffContacts(existingMap, incoming);

      const toUpsertCount = contacts.length - diff.unchanged.length;
      await prisma.importJob.update({
        where: { id: importJobId },
        data: { total: toUpsertCount, processed: 0 },
      });

      // Return only counts — large URN arrays and enrichment records would exceed
      // Inngest's step output size limit for big imports.
      return {
        added: diff.added.length,
        updated: diff.updated.length,
        unchanged: diff.unchanged.length,
        removed: diff.removed.length,
      };
    });

    // Re-query enrichment cache outside the step to avoid bloating step output.
    const orgId = (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId ?? null;
    const normalizedUrlList = contacts.map((c) => normalizeLinkedinUrl(c.linkedinUrl));
    const cachedEnrichments = orgId ? await prisma.personEnrichment.findMany({
      where: { orgId, linkedinUrlNormalized: { in: normalizedUrlList } },
      select: { linkedinUrlNormalized: true, email: true, phone: true },
    }) : [];
    const enrichmentCacheMap = new Map<string, { linkedinUrlNormalized: string; email: string | null; phone: string | null }>(
      cachedEnrichments.map((e) => [e.linkedinUrlNormalized, e]),
    );

    for (let i = 0; i < contacts.length; i += UPSERT_BATCH) {
      const batch = contacts.slice(i, i + UPSERT_BATCH);
      await step.run(`upsert-${i}`, async () => {
        await Promise.all(batch.map(async (c) => {
          const classified = classify(c.currentTitle ?? "");
          const seniority = (c.seniorityOverride as typeof classified.seniority | null) ?? classified.seniority;
          const fn = classified.function;
          const industry = c.industry || getIndustry(c.currentCompany ?? "") || undefined;

          const cacheHit = enrichmentCacheMap.get(normalizeLinkedinUrl(c.linkedinUrl));
          const hubspot = (c.email || c.phone || cacheHit?.email) ? null : await lookupContact({
            linkedinUrl: c.linkedinUrl, fullName: c.fullName, company: c.currentCompany ?? undefined,
          });
          const email = c.email ?? cacheHit?.email ?? hubspot?.email ?? null;
          const rawPhone = c.phone ?? cacheHit?.phone ?? hubspot?.phone ?? null;
          const phone = rawPhone ? (toIsraeliE164(rawPhone) ?? rawPhone) : null;
          const enrichmentFields = cacheHit?.email || cacheHit?.phone
            ? { enrichmentSource: "cache", enrichmentRanAt: new Date(), enrichmentError: null }
            : (hubspot?.email || hubspot?.phone)
            ? { enrichmentSource: "hubspot", enrichmentRanAt: new Date(), enrichmentError: null }
            : {};
          const connectedAt = c.connectedAt ? new Date(c.connectedAt) : null;

          await prisma.contact.upsert({
            where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: c.linkedinUrn } },
            create: {
              ownerId: userId, linkedinUrn: c.linkedinUrn, linkedinUrl: c.linkedinUrl, fullName: c.fullName,
              email, phone, currentTitle: c.currentTitle, currentCompany: c.currentCompany, companySize: c.companySize,
              connectedAt, location: c.location, seniority, function: fn, industry, lastSyncedAt: new Date(),
              ...enrichmentFields,
            },
            update: {
              fullName: c.fullName, email: email || undefined, phone: phone || undefined,
              currentTitle: c.currentTitle || undefined, currentCompany: c.currentCompany || undefined,
              companySize: c.companySize ?? undefined, connectedAt: connectedAt ?? undefined,
              location: c.location || undefined, seniority, function: fn, industry: industry || undefined,
              lastSyncedAt: new Date(), removedAt: null, ...enrichmentFields,
            },
          });
        }));
        await prisma.importJob.update({
          where: { id: importJobId },
          data: { processed: { increment: batch.length } },
        });
      });
    }

    if (!updateOnly && prep.removed > 0) {
      const importedUrns = contacts.map((c) => c.linkedinUrn);
      await step.run("soft-remove", () =>
        prisma.contact.updateMany({
          where: { ownerId: userId, linkedinUrn: { notIn: importedUrns }, removedAt: null },
          data: { removedAt: new Date() },
        }),
      );
    }

    const companyResult = await step.run("companies", async () => {
      await prisma.importJob.update({ where: { id: importJobId }, data: { stage: "companies" } });

      const bySlug = new Map<string, { name: string; staffCount: number | null; industry: string | null }>();
      for (const c of contacts) {
        if (!c.currentCompany) continue;
        const slug = slugifyCompany(c.currentCompany);
        if (!slug || bySlug.has(slug)) continue;
        bySlug.set(slug, { name: c.currentCompany, staffCount: c.companySize, industry: getIndustry(c.currentCompany) || null });
      }

      let newCompanies = 0;
      if (bySlug.size > 0) {
        const existingCompanies = await prisma.company.findMany({
          where: { universalName: { in: [...bySlug.keys()] } }, select: { universalName: true },
        });
        const existingSlugs = new Set(existingCompanies.map((r) => r.universalName));
        newCompanies = [...bySlug.keys()].filter((s) => !existingSlugs.has(s)).length;

        const CHUNK = 50;
        const entries = [...bySlug.entries()];
        for (let i = 0; i < entries.length; i += CHUNK) {
          await prisma.$transaction(entries.slice(i, i + CHUNK).map(([slug, info]) =>
            prisma.company.upsert({
              where: { universalName: slug },
              update: {
                ...(info.staffCount != null ? { staffCount: info.staffCount } : {}),
                ...(info.industry ? { industry: info.industry } : {}),
              },
              create: {
                universalName: slug, name: info.name,
                ...(info.staffCount != null ? { staffCount: info.staffCount } : {}),
                ...(info.industry ? { industry: info.industry } : {}),
              },
            }),
          ));
        }

        const companyRows = await prisma.company.findMany({
          where: { universalName: { in: [...bySlug.keys()] } }, select: { id: true, universalName: true },
        });
        const idBySlug = new Map(companyRows.map((r) => [r.universalName, r.id]));

        for (const c of contacts) {
          if (!c.currentCompany) continue;
          const slug = slugifyCompany(c.currentCompany);
          const companyId = slug ? (idBySlug.get(slug) ?? null) : null;
          if (!companyId) continue;
          await prisma.contact.updateMany({
            where: { ownerId: userId, linkedinUrn: c.linkedinUrn }, data: { companyId },
          });
        }

        const enrichedCompanies = await prisma.company.findMany({
          where: { id: { in: [...idBySlug.values()] }, staffCount: { not: null } }, select: { id: true, staffCount: true },
        });
        for (const co of enrichedCompanies) {
          await prisma.contact.updateMany({
            where: { ownerId: userId, companyId: co.id, companySize: null }, data: { companySize: co.staffCount },
          });
        }
      }
      return { companies: bySlug.size, newCompanies };
    });

    await step.run("finalize", async () => {
      const orgId = (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId ?? null;

      await prisma.import.create({
        data: {
          ownerId: userId, fileName: job.fileName, totalRows: contacts.length,
          added: prep.added, updated: prep.updated,
          removed: updateOnly ? 0 : prep.removed,
          companies: companyResult.companies, newCompanies: companyResult.newCompanies,
        },
      });

      await prisma.importJob.update({
        where: { id: importJobId },
        data: {
          status: "DONE", stage: "done", processed: contacts.length, payload: [],
          added: prep.added, updated: prep.updated,
          removed: updateOnly ? 0 : prep.removed, unchanged: prep.unchanged,
          companies: companyResult.companies, newCompanies: companyResult.newCompanies,
        },
      });

      if (orgId) {
        await inngest.send({ name: "companies.enrich-web" as const, data: { orgId } })
          .catch((e) => console.error("[import-process] enrich-web send failed", e));
      } else {
        console.error("[import-process] no orgId for user", userId, "— skipping company enrichment");
      }
      await inngest.send({ name: "contacts.enrich-hebrew-names" as const, data: { ownerId: userId } })
        .catch((e) => console.error("[import-process] enrich-hebrew-names send failed", e));
    });

    return { processed: contacts.length, companies: companyResult.companies };
  },
);
