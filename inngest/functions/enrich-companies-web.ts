import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { matchOrganization } from "@/lib/apollo/client";
import { publish } from "@/lib/linkedin/sse-bus";

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

    // Load companies needing enrichment, sorted by number of contacts
    // (most-connected companies first = most useful data early)
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

    // Capture the set of owners affected by this run so we can notify them via SSE
    const ownerIds = await step.run("load-affected-owners", async () => {
      if (companies.length === 0) return [] as string[];
      const rows = await prisma.contact.findMany({
        where: { companyId: { in: companies.map((c: { id: string }) => c.id) } },
        distinct: ["ownerId"],
        select: { ownerId: true },
      });
      return rows.map((r: { ownerId: string }) => r.ownerId);
    });

    function notify(payload: { processed: number; total: number; done?: boolean }) {
      for (const uid of ownerIds) {
        publish(uid, {
          type: payload.done ? "linkedin:enrich-done" : "linkedin:enrich-progress",
          data: payload,
        });
      }
    }

    notify({ processed: 0, total: companies.length });

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
                const result = await matchOrganization(company.name || company.universalName);
                if (result.staffCount != null || result.industry || result.description) {
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
                if (e?.message?.includes("rate limit")) throw e; // let Inngest retry
                // Other errors (404, timeout) — skip silently
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
      notify({ processed: i + batch.length, total: companies.length });
    }

    notify({ processed: companies.length, total: companies.length, done: true });

    return { enriched: totalEnriched, skipped: totalSkipped, total: companies.length };
  },
);
