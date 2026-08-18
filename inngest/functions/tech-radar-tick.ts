import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

// Weekly: dispatch a scan for every org with the Tech Radar module enabled. Each org's
// scan builds its own canonical query pool from its own tracked companies, so the fan-out
// is per org, not per company — one scan covers the whole list.
//
// Runs an hour after the Fintech Radar tick so the two never contend for news quota.
export const techRadarTick = inngest.createFunction(
  { id: "tech-radar-tick", name: "Tech Radar (weekly)", triggers: [{ cron: "0 6 * * 0" }] },
  async ({ step }) => {
    const orgs = await step.run("enabled-orgs", async () =>
      prisma.organization.findMany({ where: { techRadarEnabled: true }, select: { id: true } })
    );
    if (orgs.length === 0) return { dispatched: 0 };

    await step.sendEvent(
      "dispatch-scan",
      orgs.map((o) => ({ name: "tech-radar.scan" as const, data: { orgId: o.id } }))
    );
    return { dispatched: orgs.length };
  }
);

// Quarterly: re-research tracked companies whose profile has gone stale. Companies do
// not change fast, so this is cheap — and a stale profile silently searches the wrong
// directions, which is worse than paying for a refresh.
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const techRadarRefreshTick = inngest.createFunction(
  { id: "tech-radar-refresh-tick", name: "Tech Radar — quarterly profile refresh", triggers: [{ cron: "0 7 * * 0" }] },
  async ({ step }) => {
    const stale = await step.run("stale-companies", async () =>
      prisma.trackedCompany.findMany({
        where: {
          org: { techRadarEnabled: true },
          status: "ACTIVE",
          researchedAt: { lt: new Date(Date.now() - NINETY_DAYS_MS) },
        },
        select: { id: true },
      })
    );
    if (stale.length === 0) return { refreshed: 0 };

    await step.sendEvent(
      "dispatch-research",
      stale.map((c) => ({ name: "tech-radar.company.research" as const, data: { trackedCompanyId: c.id } }))
    );
    return { refreshed: stale.length };
  }
);
