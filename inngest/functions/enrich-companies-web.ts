import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichCompanyViaGemini } from "@/lib/enrichment/gemini-search";

const BATCH = 20;       // companies per Inngest step
const CONCURRENCY = 3;  // parallel Apollo calls (respect rate limits)

export const enrichCompaniesWeb = inngest.createFunction(
  {
    id: "enrich-companies-web",
    name: "Enrich companies via Apollo (DB-first cache)",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "companies.enrich-web" as const }],
  },
  async ({ event, step }: any) => {
    const orgId: string | undefined = event.data?.orgId;

    // Load ALL companies needing enrichment, most-connected first
    const companies = await step.run("load-unenriched", () =>
      prisma.company.findMany({
        where: {
          staffCount: null,
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
                select: { staffCount: true },
              });
              if (fresh?.staffCount != null) {
                batchSkipped++;
                return;
              }

              try {
                const result = await enrichCompanyViaGemini(company.name || company.universalName);
                // Only save high/low confidence results — skip "none"
                if (
                  result.confidence !== "none" &&
                  (result.staffCount != null || result.industry || result.description)
                ) {
                  await prisma.company.update({
                    where: { id: company.id },
                    data: {
                      staffCount: result.staffCount ?? undefined,
                      industry: result.industry ?? undefined,
                      website: result.website ?? undefined,
                      description: result.description ?? undefined,
                      lastEnrichedAt: new Date(),
                    },
                  });
                  batchEnriched++;
                }
              } catch (e: any) {
                if (e?.message?.includes("rate limit") || e?.message?.includes("429")) throw e;
                // Other errors (timeout, parse failure) — skip silently
              }
            }),
          );
          // Brief pause between chunks to respect Apollo rate limits
          await new Promise((r) => setTimeout(r, 300));
        }
        return { enriched: batchEnriched, skipped: batchSkipped };
      });

      totalEnriched += enriched;
      totalSkipped += skipped;
    }

    return { enriched: totalEnriched, skipped: totalSkipped, total: companies.length };
  },
);
