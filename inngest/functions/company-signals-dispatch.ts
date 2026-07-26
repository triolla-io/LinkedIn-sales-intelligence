import { inngest } from "@/inngest/client";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { prisma } from "@/lib/prisma";

// First-batch cap on module-enable. Kept low so the enable-day burst can't blow GNews's
// 100/DAY free limit even when it lands on the same day as the daily tick (28) and the
// Sunday radar (10): 60 + 28 + 10 = 98 < 100. The daily company-signals-tick drains any
// remaining uncovered companies over the following days (they stay lastSignalCheckAt=null).
const CAP = 60;

// Kick-on-enable: when an org turns the "Company signals" module ON, dispatch a first batch
// of detect events immediately (scoped to that org) so it starts working right away instead
// of waiting for the daily cron. Mirrors company-signals-tick, filtered to the one org.
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
