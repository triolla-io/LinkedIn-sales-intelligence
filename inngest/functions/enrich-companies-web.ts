import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { enrichCompanyFromWeb } from "@/lib/enrichment/web-search";

const BATCH = 50;    // companies per step
const CONCURRENCY = 8; // parallel fetches

export const enrichCompaniesWeb = inngest.createFunction(
  {
    id: "enrich-companies-web",
    name: "Enrich companies via web search (DuckDuckGo)",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "companies.enrich-web" as const }],
  },
  async ({ event, step }: any) => {
    // Optional: scope to a specific org, or run for all
    const orgId: string | undefined = event.data?.orgId;

    // Load all companies that still need enrichment
    const companies = await step.run("load-unenriched", () =>
      prisma.company.findMany({
        where: {
          staffCount: null,
          ...(orgId
            ? { contacts: { some: { owner: { orgId } } } }
            : {}),
        },
        select: { id: true, universalName: true, name: true },
      }),
    );

    if (companies.length === 0) return { enriched: 0, total: 0 };

    let totalEnriched = 0;

    // Process in batches to keep steps short
    for (let i = 0; i < companies.length; i += BATCH) {
      const batch = companies.slice(i, i + BATCH);

      const enriched = await step.run(`enrich-batch-${i}`, async () => {
        // Fetch in parallel with concurrency cap
        const results: number[] = [];
        for (let j = 0; j < batch.length; j += CONCURRENCY) {
          const chunk = batch.slice(j, j + CONCURRENCY);
          const fetched = await Promise.all(
            chunk.map(async (company: { id: string; name: string; universalName: string }) => {
              const result = await enrichCompanyFromWeb(company.name || company.universalName);
              // Sanity-check: Postgres Int max is 2,147,483,647; no company has >5M employees
              const safeStaffCount = (result.staffCount && result.staffCount <= 5_000_000)
                ? result.staffCount : null;
              if (safeStaffCount || result.industry || result.description) {
                await prisma.company.update({
                  where: { id: company.id },
                  data: {
                    staffCount: safeStaffCount ?? undefined,
                    industry: result.industry ?? undefined,
                    website: result.website ?? undefined,
                    description: result.description ?? undefined,
                    lastEnrichedAt: new Date(),
                  },
                });
                return 1;
              }
              return 0;
            }),
          );
          fetched.forEach((n: number) => results.push(n));
        }
        return results.reduce((a: number, b: number) => a + b, 0);
      });

      totalEnriched += enriched;
    }

    return { enriched: totalEnriched, total: companies.length };
  },
);
