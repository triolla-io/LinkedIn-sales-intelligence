import { inngest } from "@/inngest/client";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { prisma } from "@/lib/prisma";

/** Cap on companies dispatched per kick — mirrors companySignalsTick's WEEKLY_CAP. */
const CAP = 200;

// Kick-on-enable: when an org turns the "Company signals" module ON, dispatch a first batch
// of detect events immediately (scoped to that org) so it starts working right away instead
// of waiting for the weekly cron. Mirrors company-signals-tick, filtered to the one org.
export const companySignalsDispatchOnEnable = inngest.createFunction(
  { id: "company-signals-dispatch-on-enable", triggers: [{ event: "company.signals.enabled" as const }] },
  async ({ event }) => {
    const { orgId } = event.data as { orgId: string };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Companies with ≥1 C-level contact owned by this org, not checked in 7 days.
    const companies = await prisma.company.findMany({
      where: {
        AND: [
          { OR: [{ lastSignalCheckAt: null }, { lastSignalCheckAt: { lt: cutoff } }] },
          {
            contacts: {
              some: {
                removedAt: null,
                linkedinUrl: { not: "" },
                owner: { orgId },
                ...clevelTitleWhere(),
              },
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { lastSignalCheckAt: "asc" }, // oldest-first, drains evenly
      take: CAP,
    });

    if (companies.length === 0) return { orgId, dispatched: 0 };

    await inngest.send(
      companies.map((c) => ({ name: "company.signals.detect" as const, data: { companyId: c.id } }))
    );
    return { orgId, dispatched: companies.length };
  }
);
