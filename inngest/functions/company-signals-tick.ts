import { inngest } from "@/inngest/client";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { prisma } from "@/lib/prisma";

/** Cap on companies dispatched per tick — bounds free-tier news-API usage (esp. GNews 100/day). */
const WEEKLY_CAP = 200;

export const companySignalsTick = inngest.createFunction(
  { id: "company-signals-tick", name: "Company signals (weekly)", triggers: [{ cron: "0 4 * * 0" }] },
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Companies with ≥1 C-level contact owned by a module-enabled org, not checked in 7 days.
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
      take: WEEKLY_CAP,
    });

    if (companies.length === 0) return { dispatched: 0 };

    await inngest.send(
      companies.map((c) => ({ name: "company.signals.detect" as const, data: { companyId: c.id } }))
    );
    return { dispatched: companies.length };
  }
);
