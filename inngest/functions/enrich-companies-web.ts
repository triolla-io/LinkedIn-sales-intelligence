import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichCompanyViaOpenRouter, isOpenRouterConfigured } from "@/lib/enrichment/openrouter-search";

const BATCH = 40;       // companies per Inngest step
const CONCURRENCY = 8;  // parallel OpenRouter calls

export const enrichCompaniesWeb = inngest.createFunction(
  {
    id: "enrich-companies-web",
    name: "Enrich companies via Apollo (DB-first cache)",
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

        for (let j = 0; j < batch.length; j += CONCURRENCY) {
          const chunk = batch.slice(j, j + CONCURRENCY);
          await Promise.all(
            chunk.map(async (company: { id: string; name: string; universalName: string }) => {
              // DB-first: re-check in case another batch already enriched it
              const fresh = await prisma.company.findUnique({
                where: { id: company.id },
                select: { staffCount: true, industry: true, vertical: true },
              });
              if (fresh?.staffCount != null && fresh?.industry != null && fresh?.vertical != null) {
                batchSkipped++;
                return;
              }

              try {
                const result = await enrichCompanyViaOpenRouter(company.name || company.universalName);
                if (
                  result.confidence !== "none" &&
                  (result.staffCount != null || result.industry || result.vertical || result.description)
                ) {
                  const result_data = await prisma.company.update({
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
                  if (result_data.staffCount) {
                    await prisma.contact.updateMany({
                      where: { companyId: company.id, companySize: null },
                      data: { companySize: result_data.staffCount },
                    });
                  }
                  batchEnriched++;
                } else {
                  // Mark as attempted so it's skipped for 30 days
                  await prisma.company.update({
                    where: { id: company.id },
                    data: { lastEnrichedAt: new Date() },
                  });
                }
              } catch (e: any) {
                if (e?.message?.includes("rate limit") || e?.message?.includes("429")) throw e;
                console.error(`[enrich-companies-web] "${company.name}" failed:`, (e as Error)?.message);
              }
            }),
          );
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
