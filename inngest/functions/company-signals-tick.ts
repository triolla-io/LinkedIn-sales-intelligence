import { inngest } from "@/inngest/client";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { prisma } from "@/lib/prisma";

// Daily cap on companies dispatched per tick. Each company costs 3 news-API calls
// (Tavily + GNews + Serper, one each). Sized so total usage stays provably inside
// every provider's free tier — the whole point of running daily instead of one big
// weekly burst, which would have doubled GNews's per-DAY limit:
//   • GNews 100/DAY : 28 (+ radar's 10 on Sundays = 38) — well under 100.
//   • Tavily 1,000/MONTH : 28×31 + radar 10×5 = 868 + 50 = 918 — under 1,000.
//   • Serper is pay-per-query (~$0.001) : 28×31 ≈ $0.87/mo.
// Coverage is ~196/week (28×7), essentially the old weekly cap of 200, just spread out.
const DAILY_CAP = 28;

export const companySignalsTick = inngest.createFunction(
  { id: "company-signals-tick", name: "Company signals (daily)", triggers: [{ cron: "0 4 * * *" }] },
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Companies with ≥1 C-level contact owned by a module-enabled org, not checked in 7 days.
    // detectAndRecordSignals advances lastSignalCheckAt on every success (including no-news),
    // so a company checked today is not re-selected for 7 days — daily runs simply drain the
    // oldest stale companies rather than re-billing news calls on the same ones each day.
    const companies = await prisma.company.findMany({
      where: {
        AND: [
          { OR: [{ lastSignalCheckAt: null }, { lastSignalCheckAt: { lt: cutoff } }] },
          {
            contacts: {
              some: {
                removedAt: null,
                linkedinUrl: { not: "" },
                owner: { org: { companySignalsEnabled: true } },
                ...clevelTitleWhere(),
              },
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { lastSignalCheckAt: "asc" }, // oldest-first, drains evenly
      take: DAILY_CAP,
    });

    if (companies.length === 0) return { dispatched: 0 };

    await inngest.send(
      companies.map((c) => ({ name: "company.signals.detect" as const, data: { companyId: c.id } }))
    );
    return { dispatched: companies.length };
  }
);
