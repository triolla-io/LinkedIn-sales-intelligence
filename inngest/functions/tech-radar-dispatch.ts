import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

// Kick-on-enable: when an org turns the "Tech Radar" module ON, research any company
// still waiting and scan immediately, instead of waiting for the weekly cron. Mirrors
// the fintech-radar and company-signals dispatch-on-enable functions.
//
// Research is dispatched first; companies that are not yet ACTIVE are simply skipped by
// this scan and picked up by the next one once their profile lands.
export const techRadarDispatchOnEnable = inngest.createFunction(
  { id: "tech-radar-dispatch-on-enable", triggers: [{ event: "tech-radar.enabled" as const }] },
  async ({ event, step }) => {
    const { orgId } = event.data as { orgId: string };

    const unresearched = await step.run("unresearched-companies", async () =>
      prisma.trackedCompany.findMany({
        where: { orgId, status: { in: ["PENDING_RESEARCH", "RESEARCH_FAILED"] } },
        select: { id: true },
      })
    );

    if (unresearched.length > 0) {
      await step.sendEvent(
        "dispatch-research",
        unresearched.map((c) => ({
          name: "tech-radar.company.research" as const,
          data: { trackedCompanyId: c.id },
        }))
      );
    }

    await step.sendEvent("dispatch-scan", [{ name: "tech-radar.scan" as const, data: { orgId } }]);
    return { orgId, research: unresearched.length, scan: 1 };
  }
);
