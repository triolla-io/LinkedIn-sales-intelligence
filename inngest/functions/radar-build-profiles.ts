import { inngest } from "@/inngest/client";
import { buildProfilesForMarked } from "@/lib/tech-radar/build-profiles";

/**
 * Build the person model and STOP. No search, no triage, no drafting.
 *
 * This exists because the first live build produced 33 axes for 6 people with one
 * subscriber each, and the only reason no search money was spent is that a human
 * happened to be watching and deleted the axes before the next step ran. Relying on
 * winning that race is not a control. The number of axes decides the entire search
 * bill, so there has to be a way to see it before paying it.
 */
export const radarBuildProfiles = inngest.createFunction(
  {
    id: "radar-build-profiles",
    name: "Relationship Radar — build the person model only",
    concurrency: { limit: 1, key: "event.data.orgId" },
    triggers: [{ event: "radar.build-profiles" as const }],
  },
  async ({ event, step }) => {
    const { orgId, ownerId } = event.data as { orgId: string; ownerId: string };
    const report = await step.run("build-person-profiles", () =>
      buildProfilesForMarked({ orgId, ownerId })
    );
    console.log(`[radar] build-profiles org=${orgId} ${JSON.stringify(report)}`);
    // Deliberately dispatches nothing. The scan is a separate, explicit decision.
    return report;
  }
);
