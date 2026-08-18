import { inngest } from "@/inngest/client";
import { scanOrg } from "@/lib/tech-radar/scan";
import { findDraftableOpportunityIds } from "@/lib/tech-radar/persist";
import { prisma } from "@/lib/prisma";

// One discovery scan for one org: pooled queries -> shared triage -> shared write-ups
// -> per-company fit -> capped opportunities, then fan out drafting.
//
// Concurrency 1 per org: two overlapping scans would both spend provider quota on the
// same canonical query pool.
export const techRadarScan = inngest.createFunction(
  {
    id: "tech-radar-scan",
    name: "Tech Radar — scan",
    concurrency: { limit: 1, key: "event.data.orgId" },
    triggers: [{ event: "tech-radar.scan" as const }],
  },
  async ({ event, step }) => {
    const { orgId } = event.data as { orgId: string };

    const report = await step.run("scan", () => scanOrg(orgId));

    // Draft fan-out comes from durable state, never from the scan step's return value,
    // so an at-least-once retry of the scan neither duplicates nor drops drafts.
    const opportunityIds = await step.run("find-draftable", async () => {
      const companies = await prisma.trackedCompany.findMany({
        where: { orgId, status: "ACTIVE" },
        select: { id: true },
      });
      const ids: string[] = [];
      for (const c of companies) ids.push(...(await findDraftableOpportunityIds(c.id)));
      return ids;
    });

    if (opportunityIds.length > 0) {
      await step.sendEvent(
        "dispatch-draft",
        opportunityIds.map((opportunityId) => ({
          name: "tech-radar.draft" as const,
          data: { opportunityId },
        }))
      );
    }

    if (report.quotaExhausted) {
      console.warn(`[tech-radar] scan for org ${orgId} was cut short: every provider returned empty (news quota)`);
    }
    return { ...report, drafting: opportunityIds.length };
  }
);
