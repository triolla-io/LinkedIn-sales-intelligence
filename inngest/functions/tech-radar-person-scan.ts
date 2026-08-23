import { inngest } from "@/inngest/client";
import { personScan } from "@/lib/tech-radar/person-scan";

/**
 * The person-outward run. Starts from the axes people subscribe to, so a company with
 * nobody subscribed contributes nothing.
 *
 * Not on a cron. The pilot ascends by hand: a human fires this, reads the drafts, and
 * only then is a schedule worth arguing about.
 */
export const techRadarPersonScan = inngest.createFunction(
  {
    id: "tech-radar-person-scan",
    name: "Relationship Radar — person-outward scan",
    // Serialised per org: two concurrent runs would judge the same (axis, item) pairs
    // twice and race on the AxisMatch unique index.
    concurrency: { limit: 1, key: "event.data.orgId" },
    triggers: [{ event: "radar.person-scan" as const }],
  },
  async ({ event, step }) => {
    const { orgId } = event.data as { orgId: string };
    const report = await step.run("person-scan", () => personScan(orgId));
    console.log(`[radar] person-scan org=${orgId} ${JSON.stringify(report)}`);
    return report;
  }
);
