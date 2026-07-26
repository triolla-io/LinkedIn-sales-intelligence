import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichCompaniesViaOpenRouter, isOpenRouterConfigured } from "@/lib/enrichment/openrouter-search";

const BATCH = 40;       // companies per Inngest step
const OR_BATCH = 20;    // companies per OpenRouter call (was 1 call per company)

export const enrichCompaniesWeb = inngest.createFunction(
  {
    id: "enrich-companies-web",
    name: "Enrich companies via OpenRouter (DB-first cache)",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "companies.enrich-web" as const }],
  },
  async ({ event, step }: any) => {
    if (!isOpenRouterConfigured()) {
      throw new Error("OPENROUTER_API_KEY not configured — company enrichment cannot run");
    }

    const orgId: string | undefined = event.data?.orgId;

    // Load ALL companies needing enrichment, most-connected first
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const companies = await step.run("load-unenriched", () =>
      prisma.company.findMany({
        where: {
          AND: [
            { OR: [{ staffCount: null }, { industry: null }, { vertical: null }] },
            { OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: staleDate } }] },
          ],
          name: { not: "" },
          ...(orgId ? { contacts: { some: { owner: { orgId } } } } : {}),
        },
        select: {
          id: true,
          universalName: true,
          name: true,
          _count: { select: { contacts: true } },
        },
        orderBy: { contacts: { _count: "desc" } },
      }),
    );

    if (companies.length === 0) return { enriched: 0, total: 0, skipped: 0 };

    let totalEnriched = 0;
    let totalSkipped = 0;

    for (let i = 0; i < companies.length; i += BATCH) {
      const batch = companies.slice(i, i + BATCH);

      const { enriched, skipped } = await step.run(`enrich-batch-${i}`, async () => {
        let batchEnriched = 0;
        let batchSkipped = 0;

        // DB-first: re-check freshness and collect only companies still missing data
        // (another batch/run may have filled them in the meantime).
        const toEnrich: { id: string; name: string }[] = [];
        for (const company of batch as { id: string; name: string; universalName: string }[]) {
          const fresh = await prisma.company.findUnique({
            where: { id: company.id },
            select: { staffCount: true, industry: true, vertical: true },
          });
          if (fresh?.staffCount != null && fresh?.industry != null && fresh?.vertical != null) {
            batchSkipped++;
            continue;
          }
          toEnrich.push({ id: company.id, name: company.name || company.universalName });
        }

        // One OpenRouter call per OR_BATCH companies (was one call per company).
        for (let j = 0; j < toEnrich.length; j += OR_BATCH) {
          const chunk = toEnrich.slice(j, j + OR_BATCH);
          // Throws on 429/5xx → the Inngest step retries instead of marking attempted.
          const results = await enrichCompaniesViaOpenRouter(chunk);

          for (const company of chunk) {
            const result = results.get(company.id);
            if (
              result &&
              result.confidence !== "none" &&
              (result.staffCount != null || result.industry || result.vertical || result.description)
            ) {
              const updated = await prisma.company.update({
                where: { id: company.id },
                data: {
                  staffCount: result.staffCount ?? undefined,
                  industry: result.industry ?? undefined,
                  vertical: result.vertical ?? undefined,
                  website: result.website ?? undefined,
                  description: result.description ?? undefined,
                  lastEnrichedAt: new Date(),
                },
              });
              if (updated.staffCount) {
                await prisma.contact.updateMany({
                  where: { companyId: company.id, companySize: null },
                  data: { companySize: updated.staffCount },
                });
              }
              batchEnriched++;
            } else {
              // Attempted (unknown company, or model omitted it) — mark so it's
              // skipped for 30 days rather than re-queried on every run.
              await prisma.company.update({
                where: { id: company.id },
                data: { lastEnrichedAt: new Date() },
              });
            }
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        return { enriched: batchEnriched, skipped: batchSkipped };
      });

      totalEnriched += enriched;
      totalSkipped += skipped;
    }

    console.log(`[enrich-companies-web] done: enriched=${totalEnriched} skipped=${totalSkipped} total=${companies.length} orgId=${orgId ?? "ALL"}`);
    return { enriched: totalEnriched, skipped: totalSkipped, total: companies.length };
  },
);
